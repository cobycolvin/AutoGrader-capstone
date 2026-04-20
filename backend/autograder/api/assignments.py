import hashlib
import io
import json
import base64
import mimetypes
import os
import re
import textwrap
import uuid
import zipfile

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.db.models import Max, Prefetch
from django.http import FileResponse
from django.utils.text import slugify
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..grader.runner import (
    get_assignment_console_spec,
    get_assignment_file_run_spec,
    run_assignment_bundle_console,
    run_assignment_bundle_file_preview,
)
from ..models import (
    Assignment,
    AssignmentGroup,
    AssignmentGroupMode,
    AssignmentInstructionAsset,
    ClassExecutionRun,
    Course,
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    Group,
    GroupMember,
    IntegrityFinding,
    IntegrityScan,
    IntegrityScanProvider,
    IntegrityScanType,
    ProgrammingLanguage,
    RubricAttachment,
    Rubric,
    RubricCriterion,
    RubricCriterionLevel,
    RubricVersion,
    TestSuiteExecutionMode,
    TestSuite,
    TestSuiteVisibility,
    TestSuiteVersion,
    Submission,
    SubmissionDraft,
    SubmissionStatus,
)
from ..serializers.assignments import AssignmentInstructionAssetSerializer, AssignmentSerializer
from ..serializers.integrity import (
    IntegrityFindingSerializer,
    IntegrityScanRunSerializer,
    IntegrityScanSerializer,
)
from ..serializers.rubrics import (
    RubricAttachmentSerializer,
    RubricVersionInputSerializer,
    RubricVersionSerializer,
)
from ..serializers.submissions import SubmissionConsoleRunSerializer, SubmissionFileRunSerializer, SubmissionSerializer
from ..serializers.testsuites import TestSuiteBuildInputSerializer, TestSuiteVersionSerializer
from ..serializers.workspace import SubmissionDraftUpdateSerializer
from ..services import (
    build_class_execution_run_payload,
    build_class_execution_run_summary,
    create_assignment_rubric_version,
    create_class_execution_run,
    run_assignment_plagiarism_scan,
)
from ..services.workspace import (
    default_workspace_files,
    load_workspace_draft_files,
    save_workspace_draft,
)

MAX_TEST_SUITE_PREVIEW_BYTES = 5 * 1024 * 1024
MAX_ASSIGNMENT_INSTRUCTION_PREVIEW_BYTES = 5 * 1024 * 1024
TEXT_PREVIEW_EXTENSIONS = {
    '.py', '.java', '.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.txt', '.yaml', '.yml',
    '.xml', '.csv', '.sql', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.kt', '.swift',
    '.sh', '.html', '.css',
}
INTEGRITY_SOURCE_EXTENSIONS = {
    '.py', '.java', '.c', '.cc', '.cpp', '.cs', '.go', '.h', '.hpp', '.js', '.jsx', '.kt',
    '.m', '.php', '.rb', '.rs', '.scala', '.swift', '.ts', '.tsx',
}
JAVA_MAIN_METHOD_RE = re.compile(
    r'\b(?:public\s+)?static\s+void\s+main\s*\(\s*String(?:\s*\[\s*\]\s*\w+|\s+\w+\s*\[\s*\]|\s*\.\.\.\s*\w+|\s*\[\s*\])?',
    re.MULTILINE,
)
JAVA_PACKAGE_RE = re.compile(r'^\s*package\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;', re.MULTILINE)


def _zip_bytes(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
        for name, content in files.items():
            zip_ref.writestr(name, content)
    return buffer.getvalue()


def _safe_relative_module_path(path):
    normalized = (path or '').replace('\\', '/').strip()
    if not normalized:
        return False
    if os.path.isabs(normalized):
        return False
    parts = [part for part in normalized.split('/') if part not in {'', '.'}]
    if any(part == '..' for part in parts):
        return False
    return True


def _safe_archive_entry_name(path):
    normalized = (path or '').replace('\\', '/').strip()
    if not normalized:
        return ''
    if normalized.startswith('/'):
        return ''
    parts = [part for part in normalized.split('/') if part not in {'', '.'}]
    if not parts or any(part == '..' for part in parts):
        return ''
    return '/'.join(parts)


def _derive_java_main_class_from_source(path, content):
    relative_path = _safe_archive_entry_name(path)
    if not relative_path or not relative_path.lower().endswith('.java'):
        return ''
    source = content or ''
    if not JAVA_MAIN_METHOD_RE.search(source):
        return ''
    class_name = os.path.splitext(os.path.basename(relative_path))[0]
    if not class_name:
        return ''
    package_match = JAVA_PACKAGE_RE.search(source)
    if package_match:
        return f"{package_match.group(1)}.{class_name}"
    return class_name


def _collect_java_main_candidates(grading_files):
    candidates = []
    for fixture in grading_files or []:
        path = fixture.get('path')
        main_class = _derive_java_main_class_from_source(path, fixture.get('content', ''))
        if not main_class:
            continue
        candidates.append(
            {
                'path': path,
                'main_class': main_class,
            }
        )
    return candidates


def _is_text_like_file(name, mime_type):
    ext = os.path.splitext(name or '')[1].lower()
    if ext in TEXT_PREVIEW_EXTENSIONS:
        return True
    normalized_mime = (mime_type or '').lower()
    return (
        normalized_mime.startswith('text/')
        or 'json' in normalized_mime
        or normalized_mime in {'application/xml', 'application/javascript'}
    )


def _read_submission_text_file(submission, file_path):
    normalized = _safe_archive_entry_name(file_path)
    if not normalized:
        return ''
    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    try:
        source_path = storage.path(submission.source_bundle_key)
    except Exception:
        return ''
    if not zipfile.is_zipfile(source_path):
        return ''
    try:
        with zipfile.ZipFile(source_path, 'r') as zip_ref:
            return zip_ref.read(normalized).decode('utf-8', errors='replace')
    except Exception:
        return ''


def _normalize_integrity_excluded_paths(paths):
    normalized = []
    seen = set()
    for path in paths or []:
        item = str(path or '').replace('\\', '/').strip().lstrip('./')
        if not item:
            continue
        lowered = item.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(item)
    return normalized


def _load_zip_json(bundle_key, entry_name):
    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    try:
        source_path = storage.path(bundle_key)
    except Exception:
        return {}
    if not zipfile.is_zipfile(source_path):
        return {}
    try:
        with zipfile.ZipFile(source_path, 'r') as zip_ref:
            return json.loads(zip_ref.read(entry_name).decode('utf-8'))
    except Exception:
        return {}


def _list_zip_source_entries(file_key):
    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    try:
        source_path = storage.path(file_key)
    except Exception:
        return []
    if not zipfile.is_zipfile(source_path):
        return []

    entries = []
    with zipfile.ZipFile(source_path, 'r') as zip_ref:
        for member in zip_ref.infolist():
            if member.is_dir():
                continue
            name = _safe_archive_entry_name(member.filename)
            if not name:
                continue
            if os.path.splitext(name)[1].lower() not in INTEGRITY_SOURCE_EXTENSIONS:
                continue
            entries.append(name)
    return entries


def _collect_active_suite_auto_excluded_paths(assignment):
    test_suite = (
        TestSuite.objects.filter(assignment=assignment)
        .select_related('active_version')
        .first()
    )
    if not test_suite or not test_suite.active_version_id:
        return []
    tests_payload = _load_zip_json(test_suite.active_version.bundle_key, 'tests.json')
    grading_files = tests_payload.get('grading_files') or []
    return _normalize_integrity_excluded_paths(
        fixture.get('path')
        for fixture in grading_files
        if isinstance(fixture, dict) and fixture.get('path')
    )


def _collect_instruction_asset_auto_excluded_paths(assignment):
    assets = AssignmentInstructionAsset.objects.filter(assignment=assignment).only('original_name', 'file_key')
    candidates = []
    for asset in assets:
        original_name = os.path.basename((asset.original_name or '').replace('\\', '/').strip())
        ext = os.path.splitext(original_name)[1].lower()
        if ext == '.zip':
            candidates.extend(_list_zip_source_entries(asset.file_key))
            continue
        if ext in INTEGRITY_SOURCE_EXTENSIONS:
            candidates.append(original_name)
    return _normalize_integrity_excluded_paths(candidates)


def _collect_assignment_auto_excluded_paths(assignment):
    return _normalize_integrity_excluded_paths(
        _collect_active_suite_auto_excluded_paths(assignment)
        + _collect_instruction_asset_auto_excluded_paths(assignment)
    )


def _build_integrity_settings_payload(assignment, config=None):
    current = dict(config or assignment.integrity_config_json or {})
    manual_excluded_paths = _normalize_integrity_excluded_paths(current.get('excluded_paths') or [])
    auto_excluded_paths = _collect_assignment_auto_excluded_paths(assignment)
    effective_excluded_paths = _normalize_integrity_excluded_paths(manual_excluded_paths + auto_excluded_paths)
    return {
        'threshold': float(current.get('threshold', 35)),
        'latest_only': bool(current.get('latest_only', True)),
        'excluded_paths': manual_excluded_paths,
        'manual_excluded_paths': manual_excluded_paths,
        'auto_excluded_paths': auto_excluded_paths,
        'effective_excluded_paths': effective_excluded_paths,
    }


def _serialize_rubric_version(version):
    criteria = list(
        RubricCriterion.objects.filter(rubric_version=version).order_by('order_index', 'created_at')
    )
    attachments = list(
        RubricAttachment.objects.filter(rubric_version=version)
        .select_related('uploaded_by', 'rubric_version__rubric')
        .order_by('display_order', 'created_at')
    )
    criterion_ids = [c.id for c in criteria]
    levels_by_criterion_id = {}
    if criterion_ids:
        for level in RubricCriterionLevel.objects.filter(criterion_id__in=criterion_ids).order_by('-max_points'):
            levels_by_criterion_id.setdefault(level.criterion_id, []).append(level)

    data = RubricVersionSerializer(version).data
    data['criteria'] = [
        {
            'id': criterion.id,
            'name': criterion.name,
            'max_points': criterion.max_points,
            'weight': criterion.weight,
            'order_index': criterion.order_index,
            'levels': [
                {
                    'id': str(level.id),
                    'label': level.label,
                    'min_points': level.min_points,
                    'max_points': level.max_points,
                    'description': level.description,
                    'order_index': level.order_index,
                }
                for level in levels_by_criterion_id.get(criterion.id, [])
            ],
        }
        for criterion in criteria
    ]
    data['attachments'] = RubricAttachmentSerializer(attachments, many=True).data
    data['total_points'] = sum(float(criterion.max_points) for criterion in criteria)
    data['total_weight'] = sum(float(criterion.weight or 0) for criterion in criteria)
    return data


def _language_family(language_obj):
    if not language_obj or not language_obj.name:
        return ''
    lowered = language_obj.name.strip().lower()
    if 'python' in lowered:
        return 'python'
    if 'java' in lowered:
        return 'java'
    return ''


def _build_python_io_runner_script():
    return textwrap.dedent(
        """
        import json
        import os
        import subprocess
        import sys
        import time

        def write_results(workspace, tests):
            path = os.path.join(workspace, "results.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"tests": tests}, handle, indent=2)

        def _as_ms(value):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def _preview(value, limit=400):
            text = value if isinstance(value, str) else str(value or "")
            if len(text) <= limit:
                return text
            return text[:limit] + "..."

        def _result(name, status, time_ms, message="", summary="", failure_kind="", details=None):
            payload = {
                "name": name,
                "status": status,
                "time_ms": time_ms,
                "message": message or "",
            }
            if summary:
                payload["summary"] = summary
            if failure_kind:
                payload["failure_kind"] = failure_kind
            if details:
                payload["details"] = details
            return payload

        def main():
            if len(sys.argv) < 3:
                print("Usage: python run_tests.py <submission_dir> <workspace>")
                return 1
            submission_dir = sys.argv[1]
            workspace = sys.argv[2]
            tests_path = os.path.join(os.path.dirname(__file__), "tests.json")
            with open(tests_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            tests = []
            default_timeout = _as_ms(payload.get("timeout_ms"))
            main_path = os.path.join(submission_dir, "main.py")
            if not os.path.exists(main_path):
                tests.append(
                    _result(
                        "main.py exists",
                        "FAIL",
                        0,
                        message="main.py not found in submission",
                        summary="Submission entry file main.py was not found.",
                        failure_kind="MISSING_ENTRYPOINT",
                        details={"target": "main.py"},
                    )
                )
                write_results(workspace, tests)
                return 0
            for test in payload.get("tests", []):
                start = time.time()
                timeout = _as_ms(test.get("timeout_ms")) or default_timeout
                case_name = test.get("name") or "case"
                input_text = test.get("input", "")
                expected_text = test.get("expected", "")
                try:
                    proc = subprocess.run(
                        [sys.executable, main_path],
                        input=input_text,
                        text=True,
                        capture_output=True,
                        timeout=(timeout / 1000) if timeout else None,
                    )
                    actual_output = proc.stdout or ""
                    expected = expected_text.strip()
                    output = actual_output.strip()
                    passed = proc.returncode == 0 and output == expected
                    details = {
                        "input_preview": _preview(input_text),
                        "expected_preview": _preview(expected_text),
                        "actual_preview": _preview(actual_output),
                        "stderr_preview": _preview(proc.stderr or ""),
                        "expected_exit_code": 0,
                        "actual_exit_code": proc.returncode,
                    }
                    if passed:
                        tests.append(
                            _result(
                                case_name,
                                "PASS",
                                int((time.time() - start) * 1000),
                                summary="Output matched the expected result.",
                                details=details,
                            )
                        )
                    else:
                        failure_kind = "RUNTIME_ERROR" if proc.returncode != 0 else "STDOUT_MISMATCH"
                        summary = (
                            "Program exited with a non-zero status."
                            if proc.returncode != 0
                            else "Output did not match the expected result."
                        )
                        tests.append(
                            _result(
                                case_name,
                                "FAIL",
                                int((time.time() - start) * 1000),
                                message=(proc.stderr or "").strip() or f"expected={expected!r} actual={output!r}",
                                summary=summary,
                                failure_kind=failure_kind,
                                details=details,
                            )
                        )
                except subprocess.TimeoutExpired:
                    tests.append(
                        _result(
                            case_name,
                            "FAIL",
                            int((time.time() - start) * 1000),
                            message=f"Timeout after {timeout} ms" if timeout else "Timeout",
                            summary="Execution exceeded the time limit.",
                            failure_kind="TIMEOUT",
                            details={
                                "input_preview": _preview(input_text),
                                "expected_preview": _preview(expected_text),
                                "timeout_ms": timeout,
                            },
                        )
                    )
                except Exception as exc:  # noqa: BLE001
                    tests.append(
                        _result(
                            case_name,
                            "FAIL",
                            int((time.time() - start) * 1000),
                            message=str(exc),
                            summary="Execution failed before output could be compared.",
                            failure_kind="RUNTIME_ERROR",
                            details={
                                "input_preview": _preview(input_text),
                                "expected_preview": _preview(expected_text),
                                "error": str(exc),
                            },
                        )
                    )
            write_results(workspace, tests)
            return 0

        if __name__ == "__main__":
            raise SystemExit(main())
        """
    ).strip() + "\n"


def _build_java_io_runner_script():
    return textwrap.dedent(
        """
        import json
        import os
        import pathlib
        import subprocess
        import sys
        import time

        def write_results(workspace, tests):
            path = os.path.join(workspace, "results.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"tests": tests}, handle, indent=2)

        def _as_ms(value):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def _preview(value, limit=400):
            text = value if isinstance(value, str) else str(value or "")
            if len(text) <= limit:
                return text
            return text[:limit] + "..."

        def _result(name, status, time_ms, message="", summary="", failure_kind="", details=None):
            payload = {
                "name": name,
                "status": status,
                "time_ms": time_ms,
                "message": message or "",
            }
            if summary:
                payload["summary"] = summary
            if failure_kind:
                payload["failure_kind"] = failure_kind
            if details:
                payload["details"] = details
            return payload

        def main():
            if len(sys.argv) < 3:
                print("Usage: python run_tests.py <submission_dir> <workspace>")
                return 1
            submission_dir = sys.argv[1]
            workspace = sys.argv[2]
            tests_path = os.path.join(os.path.dirname(__file__), "tests.json")
            with open(tests_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)

            tests = []
            default_timeout = _as_ms(payload.get("timeout_ms"))
            main_class = (payload.get("main_class") or "Main").strip() or "Main"
            java_files = [str(path) for path in pathlib.Path(submission_dir).rglob("*.java")]
            if not java_files:
                tests.append(
                    _result(
                        "java_files_exist",
                        "FAIL",
                        0,
                        message="No .java files found in submission",
                        summary="No Java source files were found in the submission.",
                        failure_kind="MISSING_SOURCE_FILES",
                    )
                )
                write_results(workspace, tests)
                return 0

            classes_dir = os.path.join(workspace, ".io-classes")
            os.makedirs(classes_dir, exist_ok=True)
            compile_start = time.time()
            compile_proc = subprocess.run(
                ["javac", "-d", classes_dir, *java_files],
                cwd=submission_dir,
                text=True,
                capture_output=True,
            )
            compile_elapsed = int((time.time() - compile_start) * 1000)
            if compile_proc.returncode != 0:
                tests.append(
                    _result(
                        "compile",
                        "FAIL",
                        compile_elapsed,
                        message=(compile_proc.stderr or compile_proc.stdout or "Compilation failed").strip(),
                        summary="Java compilation failed before the program could run.",
                        failure_kind="COMPILE_ERROR",
                        details={
                            "stderr_preview": _preview(compile_proc.stderr or compile_proc.stdout or "Compilation failed"),
                        },
                    )
                )
                write_results(workspace, tests)
                return 0

            for test in payload.get("tests", []):
                start = time.time()
                timeout = _as_ms(test.get("timeout_ms")) or default_timeout
                case_name = test.get("name") or "case"
                input_text = test.get("input", "")
                expected_text = test.get("expected", "")
                try:
                    proc = subprocess.run(
                        ["java", "-cp", classes_dir, main_class],
                        cwd=submission_dir,
                        input=input_text,
                        text=True,
                        capture_output=True,
                        timeout=(timeout / 1000) if timeout else None,
                    )
                    actual_output = proc.stdout or ""
                    output = actual_output.strip()
                    expected = expected_text.strip()
                    passed = proc.returncode == 0 and output == expected
                    details = {
                        "input_preview": _preview(input_text),
                        "expected_preview": _preview(expected_text),
                        "actual_preview": _preview(actual_output),
                        "stderr_preview": _preview(proc.stderr or ""),
                        "expected_exit_code": 0,
                        "actual_exit_code": proc.returncode,
                    }
                    if passed:
                        tests.append(
                            _result(
                                case_name,
                                "PASS",
                                int((time.time() - start) * 1000),
                                summary="Output matched the expected result.",
                                details=details,
                            )
                        )
                    else:
                        failure_kind = "RUNTIME_ERROR" if proc.returncode != 0 else "STDOUT_MISMATCH"
                        summary = (
                            "Program exited with a non-zero status."
                            if proc.returncode != 0
                            else "Output did not match the expected result."
                        )
                        tests.append(
                            _result(
                                case_name,
                                "FAIL",
                                int((time.time() - start) * 1000),
                                message="" if passed else ((proc.stderr or "").strip() or f"expected={expected!r} actual={output!r}"),
                                summary=summary,
                                failure_kind=failure_kind,
                                details=details,
                            )
                        )
                except subprocess.TimeoutExpired:
                    tests.append(
                        _result(
                            case_name,
                            "FAIL",
                            int((time.time() - start) * 1000),
                            message=f"Timeout after {timeout} ms" if timeout else "Timeout",
                            summary="Execution exceeded the time limit.",
                            failure_kind="TIMEOUT",
                            details={
                                "input_preview": _preview(input_text),
                                "expected_preview": _preview(expected_text),
                                "timeout_ms": timeout,
                            },
                        )
                    )
                except Exception as exc:  # noqa: BLE001
                    tests.append(
                        _result(
                            case_name,
                            "FAIL",
                            int((time.time() - start) * 1000),
                            message=str(exc),
                            summary="Execution failed before output could be compared.",
                            failure_kind="RUNTIME_ERROR",
                            details={
                                "input_preview": _preview(input_text),
                                "expected_preview": _preview(expected_text),
                                "error": str(exc),
                            },
                        )
                    )
            write_results(workspace, tests)
            return 0

        if __name__ == "__main__":
            raise SystemExit(main())
        """
    ).strip() + "\n"


def _build_python_oop_runner_script():
    return textwrap.dedent(
        """
        import importlib.util
        import json
        import os
        import subprocess
        import sys
        import time

        def write_results(workspace, tests):
            path = os.path.join(workspace, "results.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"tests": tests}, handle, indent=2)

        def _as_ms(value):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def _load_module(module_path):
            spec = importlib.util.spec_from_file_location("student_module", module_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module

        def _run_class_case(module, case, timeout_ms):
            start = time.time()
            name = case.get("name") or "class-case"
            try:
                class_name = case.get("class_name")
                cls = getattr(module, class_name)
                instance = cls(*list(case.get("constructor_args", [])))
                for step in case.get("steps", []):
                    step_name = step.get("method")
                    step_args = list(step.get("args", []))
                    getattr(instance, step_name)(*step_args)
                assert_name = case.get("assert_method")
                assert_args = list(case.get("assert_args", []))
                actual = getattr(instance, assert_name)(*assert_args)
                expected = case.get("expected")
                passed = actual == expected
                return {
                    "name": name,
                    "status": "PASS" if passed else "FAIL",
                    "time_ms": int((time.time() - start) * 1000),
                    "message": "" if passed else f"expected={expected!r} actual={actual!r}",
                }
            except Exception as exc:  # noqa: BLE001
                return {
                    "name": name,
                    "status": "FAIL",
                    "time_ms": int((time.time() - start) * 1000),
                    "message": str(exc),
                }

        def _run_main_case(script_path, case, timeout_ms):
            start = time.time()
            name = case.get("name") or "main-case"
            case_timeout = _as_ms(case.get("timeout_ms")) or timeout_ms
            try:
                proc = subprocess.run(
                    [sys.executable, script_path],
                    input=case.get("input", ""),
                    text=True,
                    capture_output=True,
                    timeout=(case_timeout / 1000) if case_timeout else None,
                )
                output = (proc.stdout or "").strip()
                expected = (case.get("expected") or "").strip()
                passed = output == expected
                return {
                    "name": name,
                    "status": "PASS" if passed else "FAIL",
                    "time_ms": int((time.time() - start) * 1000),
                    "message": "" if passed else ((proc.stderr or "").strip() or f"expected={expected!r} actual={output!r}"),
                }
            except subprocess.TimeoutExpired:
                return {
                    "name": name,
                    "status": "FAIL",
                    "time_ms": int((time.time() - start) * 1000),
                    "message": f"Timeout after {case_timeout} ms" if case_timeout else "Timeout",
                }
            except Exception as exc:  # noqa: BLE001
                return {
                    "name": name,
                    "status": "FAIL",
                    "time_ms": int((time.time() - start) * 1000),
                    "message": str(exc),
                }

        def main():
            if len(sys.argv) < 3:
                print("Usage: python run_tests.py <submission_dir> <workspace>")
                return 1
            submission_dir = sys.argv[1]
            workspace = sys.argv[2]
            tests_path = os.path.join(os.path.dirname(__file__), "tests.json")
            with open(tests_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)

            module_path = payload.get("module_path") or "main.py"
            target_script = os.path.join(submission_dir, module_path)
            results = []

            if not os.path.exists(target_script):
                results.append({
                    "name": "submission module exists",
                    "status": "FAIL",
                    "time_ms": 0,
                    "message": f"{module_path} not found in submission",
                })
                write_results(workspace, results)
                return 0

            timeout_ms = _as_ms(payload.get("timeout_ms"))
            try:
                module = _load_module(target_script)
            except Exception as exc:  # noqa: BLE001
                results.append({
                    "name": "load module",
                    "status": "FAIL",
                    "time_ms": 0,
                    "message": str(exc),
                })
                write_results(workspace, results)
                return 0

            for case in payload.get("class_tests", []):
                results.append(_run_class_case(module, case, timeout_ms))

            for case in payload.get("main_tests", []):
                results.append(_run_main_case(target_script, case, timeout_ms))

            write_results(workspace, results)
            return 0

        if __name__ == "__main__":
            raise SystemExit(main())
        """
    ).strip() + "\n"


def _is_java_scalar(value):
    return isinstance(value, (str, int, float, bool)) and not isinstance(value, complex)


def _java_escape(value):
    return str(value).replace('\\', '\\\\').replace('"', '\\"')


def _java_literal(value):
    if isinstance(value, bool):
        return 'Boolean.TRUE' if value else 'Boolean.FALSE'
    if isinstance(value, int) and not isinstance(value, bool):
        return f'Integer.valueOf({value})'
    if isinstance(value, float):
        return f'Double.valueOf({value})'
    return f"\"{_java_escape(value)}\""


def _java_type_literal(value):
    if isinstance(value, bool):
        return 'boolean.class'
    if isinstance(value, int) and not isinstance(value, bool):
        return 'int.class'
    if isinstance(value, float):
        return 'double.class'
    return 'String.class'


def _build_java_case_method(case, index):
    case_name = _java_escape(case.get('name') or f'class-case-{index + 1}')
    class_name = _java_escape(case.get('class_name'))
    ctor_args = case.get('constructor_args', [])
    assert_args = case.get('assert_args', [])
    expected = case.get('expected')
    steps = case.get('steps', [])

    ctor_types = ', '.join(_java_type_literal(value) for value in ctor_args)
    ctor_values = ', '.join(_java_literal(value) for value in ctor_args)
    assert_types = ', '.join(_java_type_literal(value) for value in assert_args)
    assert_values = ', '.join(_java_literal(value) for value in assert_args)
    expected_literal = _java_literal(expected)
    assert_method = _java_escape(case.get('assert_method'))

    step_lines = []
    for step in steps:
        step_args = step.get('args', [])
        step_types = ', '.join(_java_type_literal(value) for value in step_args)
        step_values = ', '.join(_java_literal(value) for value in step_args)
        step_name = _java_escape(step.get('method'))
        step_lines.append(
            f'            invoke(instance, "{step_name}", new Class<?>[]{{{step_types}}}, new Object[]{{{step_values}}});'
        )
    steps_code = '\n'.join(step_lines) if step_lines else '            // no pre-assert steps'

    return textwrap.dedent(
        f"""
        private static void runCase{index}() {{
            String caseName = "{case_name}";
            long start = System.currentTimeMillis();
            try {{
                Class<?> clazz = Class.forName("{class_name}");
                Object instance = clazz.getDeclaredConstructor(new Class<?>[]{{{ctor_types}}})
                    .newInstance(new Object[]{{{ctor_values}}});
{steps_code}
                Object actual = invoke(instance, "{assert_method}", new Class<?>[]{{{assert_types}}}, new Object[]{{{assert_values}}});
                Object expected = {expected_literal};
                boolean passed = valueEquals(actual, expected);
                emit(caseName, passed, System.currentTimeMillis() - start,
                    passed ? "" : ("expected=" + String.valueOf(expected) + " actual=" + String.valueOf(actual)));
            }} catch (Throwable t) {{
                emit(caseName, false, System.currentTimeMillis() - start, rootMessage(t));
            }}
        }}
        """
    ).strip()


def _build_java_generated_harness(class_tests):
    methods = []
    method_calls = []
    for index, case in enumerate(class_tests):
        methods.append(_build_java_case_method(case, index))
        method_calls.append(f'        runCase{index}();')
    method_calls_code = '\n'.join(method_calls) if method_calls else '        // no class tests'
    methods_code = '\n\n'.join(methods)
    return textwrap.dedent(
        f"""
        import java.lang.reflect.InvocationTargetException;
        import java.lang.reflect.Method;

        public class GeneratedHarness {{
            private static final String PREFIX = "GF_RESULT\\t";

            public static void main(String[] args) {{
{method_calls_code}
            }}

            private static Object invoke(Object target, String methodName, Class<?>[] types, Object[] values) throws Exception {{
                Method method = target.getClass().getMethod(methodName, types);
                return method.invoke(target, values);
            }}

            private static String rootMessage(Throwable throwable) {{
                Throwable current = throwable;
                while (current instanceof InvocationTargetException && ((InvocationTargetException) current).getCause() != null) {{
                    current = ((InvocationTargetException) current).getCause();
                }}
                String message = current.getMessage();
                if (message == null || message.isEmpty()) {{
                    message = current.getClass().getSimpleName();
                }}
                return message.replace("\\n", " ").replace("\\r", " ").replace("\\t", " ");
            }}

            private static boolean valueEquals(Object actual, Object expected) {{
                if (actual == null && expected == null) {{
                    return true;
                }}
                if (actual == null || expected == null) {{
                    return false;
                }}
                if (actual instanceof Number && expected instanceof Number) {{
                    double a = ((Number) actual).doubleValue();
                    double b = ((Number) expected).doubleValue();
                    return Double.compare(a, b) == 0;
                }}
                return actual.equals(expected);
            }}

            private static void emit(String name, boolean passed, long timeMs, String message) {{
                String status = passed ? "PASS" : "FAIL";
                if (message == null) {{
                    message = "";
                }}
                String normalized = message.replace("\\n", " ").replace("\\r", " ").replace("\\t", " ");
                System.out.println(PREFIX + name + "\\t" + status + "\\t" + timeMs + "\\t" + normalized);
            }}

{methods_code}
        }}
        """
    ).strip() + "\n"


def _build_java_oop_runner_script():
    return textwrap.dedent(
        """
        import json
        import os
        import pathlib
        import subprocess
        import sys
        import time

        RESULT_PREFIX = "GF_RESULT\\t"

        def write_results(workspace, tests):
            path = os.path.join(workspace, "results.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"tests": tests}, handle, indent=2)

        def _as_ms(value):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def _parse_harness_lines(stdout):
            rows = []
            for line in (stdout or "").splitlines():
                if not line.startswith(RESULT_PREFIX):
                    continue
                parts = line.split("\\t", 4)
                if len(parts) < 5:
                    continue
                _, name, status, time_ms, message = parts
                try:
                    time_value = int(time_ms)
                except (TypeError, ValueError):
                    time_value = 0
                rows.append({
                    "name": name,
                    "status": status if status in {"PASS", "FAIL", "SKIP"} else "FAIL",
                    "time_ms": time_value,
                    "message": message,
                })
            return rows

        def _run_main_case(submission_dir, payload, case):
            start = time.time()
            timeout_ms = _as_ms(case.get("timeout_ms")) or _as_ms(payload.get("timeout_ms"))
            class_name = (case.get("main_class") or payload.get("main_class") or "Main").strip() or "Main"
            try:
                proc = subprocess.run(
                    ["java", "-cp", submission_dir, class_name],
                    input=case.get("input", ""),
                    text=True,
                    capture_output=True,
                    timeout=(timeout_ms / 1000) if timeout_ms else None,
                )
                output = (proc.stdout or "").strip()
                expected = (case.get("expected") or "").strip()
                passed = output == expected
                return {
                    "name": case.get("name") or f"main:{class_name}",
                    "status": "PASS" if passed else "FAIL",
                    "time_ms": int((time.time() - start) * 1000),
                    "message": "" if passed else ((proc.stderr or "").strip() or f"expected={expected!r} actual={output!r}"),
                }
            except subprocess.TimeoutExpired:
                return {
                    "name": case.get("name") or f"main:{class_name}",
                    "status": "FAIL",
                    "time_ms": int((time.time() - start) * 1000),
                    "message": f"Timeout after {timeout_ms} ms" if timeout_ms else "Timeout",
                }
            except Exception as exc:  # noqa: BLE001
                return {
                    "name": case.get("name") or f"main:{class_name}",
                    "status": "FAIL",
                    "time_ms": int((time.time() - start) * 1000),
                    "message": str(exc),
                }

        def main():
            if len(sys.argv) < 3:
                print("Usage: python run_tests.py <submission_dir> <workspace>")
                return 1
            submission_dir = sys.argv[1]
            workspace = sys.argv[2]
            tests_dir = os.path.dirname(__file__)
            tests_path = os.path.join(tests_dir, "tests.json")
            with open(tests_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)

            results = []
            java_files = [str(path) for path in pathlib.Path(submission_dir).glob("*.java")]
            if not java_files:
                results.append({
                    "name": "java_files_exist",
                    "status": "FAIL",
                    "time_ms": 0,
                    "message": "No root-level .java files found.",
                })
                write_results(workspace, results)
                return 0

            for file_path in java_files:
                try:
                    with open(file_path, "r", encoding="utf-8") as handle:
                        content = handle.read()
                    if "package " in content:
                        results.append({
                            "name": "package_check",
                            "status": "FAIL",
                            "time_ms": 0,
                            "message": "Package declarations are not supported in v1.",
                        })
                        write_results(workspace, results)
                        return 0
                except OSError as exc:
                    results.append({
                        "name": "read_java_files",
                        "status": "FAIL",
                        "time_ms": 0,
                        "message": str(exc),
                    })
                    write_results(workspace, results)
                    return 0

            harness_path = os.path.join(tests_dir, "GeneratedHarness.java")
            compile_start = time.time()
            compile_proc = subprocess.run(
                ["javac", "-d", submission_dir, *java_files, harness_path],
                text=True,
                capture_output=True,
            )
            compile_elapsed = int((time.time() - compile_start) * 1000)
            if compile_proc.returncode != 0:
                results.append({
                    "name": "compile",
                    "status": "FAIL",
                    "time_ms": compile_elapsed,
                    "message": (compile_proc.stderr or compile_proc.stdout or "Compilation failed").strip(),
                })
                write_results(workspace, results)
                return 0

            harness_timeout = _as_ms(payload.get("timeout_ms"))
            harness_start = time.time()
            harness_proc = subprocess.run(
                ["java", "-cp", submission_dir, "GeneratedHarness"],
                text=True,
                capture_output=True,
                timeout=(harness_timeout / 1000) if harness_timeout else None,
            )
            harness_elapsed = int((time.time() - harness_start) * 1000)
            harness_results = _parse_harness_lines(harness_proc.stdout)
            if not harness_results and harness_proc.returncode != 0:
                harness_results.append({
                    "name": "oop_harness",
                    "status": "FAIL",
                    "time_ms": harness_elapsed,
                    "message": (harness_proc.stderr or harness_proc.stdout or "Harness execution failed").strip(),
                })
            results.extend(harness_results)

            for main_case in payload.get("main_tests", []):
                results.append(_run_main_case(submission_dir, payload, main_case))

            write_results(workspace, results)
            return 0

        if __name__ == "__main__":
            raise SystemExit(main())
        """
    ).strip() + "\n"


def _build_python_io_bundle_bytes(tests, timeout_ms=None):
    tests_payload = {'type': 'IO', 'language': 'python', 'tests': tests}
    if timeout_ms:
        tests_payload['timeout_ms'] = int(timeout_ms)
    files = {
        'README.md': (
            '# Python I/O tests (builder)\n\n'
            'Generated by the assignment builder.\n'
            'Student submissions should include main.py.\n'
        ),
        'tests.json': json.dumps(tests_payload, indent=2),
        'run_tests.py': _build_python_io_runner_script(),
    }
    return _zip_bytes(files)


def _build_java_io_bundle_bytes(main_class, tests, timeout_ms=None):
    tests_payload = {
        'type': 'IO',
        'language': 'java',
        'main_class': main_class,
        'tests': tests,
    }
    if timeout_ms:
        tests_payload['timeout_ms'] = int(timeout_ms)
    files = {
        'README.md': (
            '# Java I/O tests (builder)\n\n'
            'Generated by the assignment builder.\n'
            'Student submissions should include .java files and the configured main class.\n'
        ),
        'tests.json': json.dumps(tests_payload, indent=2),
        'run_tests.py': _build_java_io_runner_script(),
    }
    return _zip_bytes(files)


def _build_python_oop_bundle_bytes(module_path, class_tests, main_tests, timeout_ms=None):
    tests_payload = {
        'type': 'OOP',
        'language': 'python',
        'module_path': module_path,
        'class_tests': class_tests,
        'main_tests': main_tests,
    }
    if timeout_ms:
        tests_payload['timeout_ms'] = int(timeout_ms)
    files = {
        'README.md': (
            '# Python OOP tests (builder)\n\n'
            'Generated by the assignment builder.\n'
            'This suite executes class-method contract checks and optional main-flow checks.\n'
        ),
        'tests.json': json.dumps(tests_payload, indent=2),
        'run_tests.py': _build_python_oop_runner_script(),
    }
    return _zip_bytes(files)


def _build_java_oop_bundle_bytes(class_tests, main_tests, timeout_ms=None):
    tests_payload = {
        'type': 'OOP',
        'language': 'java',
        'class_tests': class_tests,
        'main_tests': main_tests,
    }
    if timeout_ms:
        tests_payload['timeout_ms'] = int(timeout_ms)
    files = {
        'README.md': (
            '# Java OOP tests (builder)\n\n'
            'Generated by the assignment builder.\n'
            'v1 requires root-level .java files with no package declarations.\n'
        ),
        'tests.json': json.dumps(tests_payload, indent=2),
        'GeneratedHarness.java': _build_java_generated_harness(class_tests),
        'run_tests.py': _build_java_oop_runner_script(),
    }
    return _zip_bytes(files)


def _build_file_io_runner_script():
    return textwrap.dedent(
        """
        import importlib.util
        import json
        import os
        import shutil
        import subprocess
        import sys
        import tempfile
        import time

        def write_results(workspace, tests):
            path = os.path.join(workspace, "results.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"tests": tests}, handle, indent=2)

        def _as_ms(value):
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        def _preview(value, limit=200):
            if isinstance(value, bytes):
                text = value.decode("utf-8", errors="replace")
            else:
                text = value if isinstance(value, str) else str(value)
            if len(text) <= limit:
                return text
            return text[:limit] + "..."

        def _result(name, status, time_ms, message="", summary="", failure_kind="", details=None):
            payload = {
                "name": name,
                "status": status,
                "time_ms": time_ms,
                "message": message or "",
            }
            if summary:
                payload["summary"] = summary
            if failure_kind:
                payload["failure_kind"] = failure_kind
            if details:
                payload["details"] = details
            return payload

        def _issue(kind, summary, **details):
            payload = {"kind": kind, "summary": summary}
            for key, value in details.items():
                if value is None or value == "":
                    continue
                payload[key] = value
            return payload

        def _failure_response(issues, fallback_message=""):
            issues = [issue for issue in (issues or []) if issue]
            if not issues:
                return False, {
                    "summary": fallback_message or "Verification failed.",
                    "failure_kind": "UNKNOWN_FAILURE",
                    "details": {},
                    "message": fallback_message or "Verification failed.",
                }
            if len(issues) == 1:
                issue = issues[0]
                details = {key: value for key, value in issue.items() if key not in {"kind", "summary"}}
                return False, {
                    "summary": issue.get("summary", fallback_message or "Verification failed."),
                    "failure_kind": issue.get("kind", "UNKNOWN_FAILURE"),
                    "details": details,
                    "message": issue.get("summary", fallback_message or "Verification failed."),
                }
            return False, {
                "summary": f"{len(issues)} verification checks failed.",
                "failure_kind": "MULTIPLE_FAILURES",
                "details": {"issues": issues},
                "message": " | ".join(issue.get("summary", "") for issue in issues if issue.get("summary")),
            }

        def _safe_join(base, *parts):
            candidate = os.path.normpath(os.path.join(base, *parts))
            base_norm = os.path.normpath(base)
            if os.path.commonpath([base_norm, candidate]) != base_norm:
                raise ValueError("Unsafe path access")
            return candidate

        def _read_text(path):
            with open(path, "r", encoding="utf-8") as handle:
                return handle.read()

        def _read_json(path):
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)

        def _list_files(base_dir):
            results = []
            for root, dir_names, file_names in os.walk(base_dir):
                dir_names[:] = [name for name in dir_names if name != ".classes"]
                for file_name in file_names:
                    absolute = os.path.join(root, file_name)
                    results.append(os.path.relpath(absolute, base_dir).replace("\\\\", "/"))
            return sorted(results)

        def _normalize_whitespace(value):
            return " ".join((value or "").split())

        def _normalize_lines(value):
            return sorted([(line or "").rstrip() for line in (value or "").splitlines()])

        def _compare_text(actual, expected, mode, tolerance=None):
            actual = actual or ""
            expected = expected or ""
            mode = (mode or "EXACT").upper()
            try:
                if mode == "EXACT":
                    passed = actual == expected
                elif mode == "TRIMMED":
                    passed = actual.strip() == expected.strip()
                elif mode == "NORMALIZED_WHITESPACE":
                    passed = _normalize_whitespace(actual) == _normalize_whitespace(expected)
                elif mode == "UNORDERED_LINES":
                    passed = _normalize_lines(actual) == _normalize_lines(expected)
                elif mode == "JSON_EQ":
                    passed = json.loads(actual) == json.loads(expected)
                elif mode == "NUMERIC_TOLERANCE":
                    if tolerance is None:
                        return False, "numeric_tolerance is required."
                    passed = abs(float(actual.strip()) - float(expected.strip())) <= float(tolerance)
                else:
                    return False, f"Unsupported comparison mode: {mode}"
            except Exception as exc:  # noqa: BLE001
                return False, f"{mode} comparison failed: {exc}"

            if passed:
                return True, ""
            return False, f"{mode} mismatch. expected={_preview(expected)!r} actual={_preview(actual)!r}"

        def _prepare_case_dir(submission_dir, case_dir):
            shutil.copytree(submission_dir, case_dir, dirs_exist_ok=True)

        def _write_grading_files(tests_dir, case_dir, payload):
            for fixture in payload.get("grading_files", []):
                source = _safe_join(tests_dir, fixture.get("source", ""))
                destination = _safe_join(case_dir, fixture.get("path", ""))
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                shutil.copyfile(source, destination)

        def _write_input_fixtures(tests_dir, case_dir, case):
            for fixture in case.get("input_files", []):
                source = _safe_join(tests_dir, fixture.get("source", ""))
                destination = _safe_join(case_dir, fixture.get("path", ""))
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                shutil.copyfile(source, destination)

        def _load_validator(tests_dir):
            validator_path = os.path.join(tests_dir, "validator.py")
            if not os.path.exists(validator_path):
                return None
            spec = importlib.util.spec_from_file_location("suite_validator", validator_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            validate_case = getattr(module, "validate_case", None)
            if not callable(validate_case):
                raise RuntimeError("validator.py must define validate_case(case, context)")
            return validate_case

        def _build_validator_context(case_dir, submission_dir, stdout, stderr, exit_code):
            return {
                "case_dir": case_dir,
                "submission_dir": submission_dir,
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": exit_code,
                "read_text": lambda path: _read_text(_safe_join(case_dir, path)),
                "read_json": lambda path: _read_json(_safe_join(case_dir, path)),
                "list_files": lambda: _list_files(case_dir),
            }

        def _run_python_case(payload, case_dir, case, timeout_ms):
            entry_path = payload.get("entry_path")
            target = _safe_join(case_dir, entry_path)
            if not os.path.exists(target):
                return {
                    "returncode": -1,
                    "stdout": "",
                    "stderr": f"{entry_path} not found in submission",
                    "timed_out": False,
                    "error_kind": "MISSING_ENTRYPOINT",
                    "error_summary": f"Entry script {entry_path} was not found in the submission.",
                    "details": {
                        "target": entry_path,
                    },
                }
            proc = subprocess.run(
                [sys.executable, target, *list(case.get("args", []))],
                cwd=case_dir,
                input=case.get("stdin", ""),
                text=True,
                capture_output=True,
                timeout=(timeout_ms / 1000) if timeout_ms else None,
            )
            return {
                "returncode": proc.returncode,
                "stdout": proc.stdout or "",
                "stderr": proc.stderr or "",
                "timed_out": False,
            }

        def _collect_java_sources(case_dir):
            sources = []
            for root, dir_names, file_names in os.walk(case_dir):
                dir_names[:] = [name for name in dir_names if name != ".classes"]
                for file_name in file_names:
                    if file_name.endswith(".java"):
                        sources.append(os.path.join(root, file_name))
            return sorted(sources)

        def _run_java_case(payload, case_dir, case, timeout_ms):
            classes_dir = os.path.join(case_dir, ".classes")
            os.makedirs(classes_dir, exist_ok=True)
            source_files = _collect_java_sources(case_dir)
            if not source_files:
                return {
                    "returncode": -1,
                    "stdout": "",
                    "stderr": "No .java files found in submission",
                    "timed_out": False,
                    "error_kind": "MISSING_SOURCE_FILES",
                    "error_summary": "No Java source files were found in the submission.",
                    "details": {},
                }

            compile_proc = subprocess.run(
                ["javac", "-d", classes_dir, *source_files],
                cwd=case_dir,
                text=True,
                capture_output=True,
            )
            if compile_proc.returncode != 0:
                return {
                    "returncode": compile_proc.returncode,
                    "stdout": compile_proc.stdout or "",
                    "stderr": (compile_proc.stderr or compile_proc.stdout or "Compilation failed").strip(),
                    "timed_out": False,
                    "error_kind": "COMPILE_ERROR",
                    "error_summary": "Java compilation failed before the program could run.",
                    "details": {
                        "stderr_preview": _preview(compile_proc.stderr or compile_proc.stdout or "Compilation failed"),
                    },
                }

            proc = subprocess.run(
                ["java", "-cp", classes_dir, payload.get("main_class"), *list(case.get("args", []))],
                cwd=case_dir,
                input=case.get("stdin", ""),
                text=True,
                capture_output=True,
                timeout=(timeout_ms / 1000) if timeout_ms else None,
            )
            return {
                "returncode": proc.returncode,
                "stdout": proc.stdout or "",
                "stderr": proc.stderr or "",
                "timed_out": False,
            }

        def _run_case(payload, case_dir, case, timeout_ms):
            language = (payload.get("language") or "").lower()
            if language == "python":
                return _run_python_case(payload, case_dir, case, timeout_ms)
            if language == "java":
                return _run_java_case(payload, case_dir, case, timeout_ms)
            return {
                "returncode": -1,
                "stdout": "",
                "stderr": f"Unsupported language: {language}",
                "timed_out": False,
                "error_kind": "UNSUPPORTED_LANGUAGE",
                "error_summary": f"Unsupported language for file-based execution: {language or 'unknown'}.",
                "details": {
                    "language": language,
                },
            }

        def _execution_issue(execution, expected_exit_code):
            error_kind = execution.get("error_kind")
            if error_kind:
                details = dict(execution.get("details") or {})
                details.setdefault("actual_exit_code", execution.get("returncode"))
                details.setdefault("stdout_preview", _preview(execution.get("stdout", "")))
                details.setdefault("stderr_preview", _preview(execution.get("stderr", "")))
                return _issue(
                    error_kind,
                    execution.get("error_summary") or "Execution failed before verification could complete.",
                    **details,
                )

            actual_exit_code = execution.get("returncode")
            if actual_exit_code != expected_exit_code:
                failure_kind = "RUNTIME_ERROR" if expected_exit_code == 0 else "EXIT_CODE_MISMATCH"
                summary = (
                    "The program exited with an error before completing the check."
                    if failure_kind == "RUNTIME_ERROR"
                    else f"Expected exit code {expected_exit_code}, but process returned {actual_exit_code}."
                )
                return _issue(
                    failure_kind,
                    summary,
                    expected_exit_code=expected_exit_code,
                    actual_exit_code=actual_exit_code,
                    stdout_preview=_preview(execution.get("stdout", "")),
                    stderr_preview=_preview(execution.get("stderr", "")),
                )

            return None

        def _validate_built_in(tests_dir, case_dir, case, execution):
            issues = []
            expected_exit_code = int(case.get("expected_exit_code", 0))
            execution_issue = _execution_issue(execution, expected_exit_code)
            if execution_issue:
                return _failure_response([execution_issue])

            expected_stdout = case.get("expected_stdout")
            if expected_stdout is not None:
                ok, message = _compare_text(
                    execution.get("stdout", ""),
                    expected_stdout.get("content", ""),
                    expected_stdout.get("comparison_mode"),
                    expected_stdout.get("numeric_tolerance"),
                )
                if not ok:
                    issues.append(
                        _issue(
                            "STDOUT_MISMATCH",
                            "Stdout did not match the expected output.",
                            comparison_mode=expected_stdout.get("comparison_mode"),
                            expected_preview=_preview(expected_stdout.get("content", "")),
                            actual_preview=_preview(execution.get("stdout", "")),
                            comparison_message=message,
                        )
                    )

            expected_stderr = case.get("expected_stderr")
            if expected_stderr is not None:
                ok, message = _compare_text(
                    execution.get("stderr", ""),
                    expected_stderr.get("content", ""),
                    expected_stderr.get("comparison_mode"),
                    expected_stderr.get("numeric_tolerance"),
                )
                if not ok:
                    issues.append(
                        _issue(
                            "STDERR_MISMATCH",
                            "Stderr did not match the expected output.",
                            comparison_mode=expected_stderr.get("comparison_mode"),
                            expected_preview=_preview(expected_stderr.get("content", "")),
                            actual_preview=_preview(execution.get("stderr", "")),
                            comparison_message=message,
                        )
                    )

            for expected_file in case.get("expected_files", []):
                target_path = _safe_join(case_dir, expected_file.get("path", ""))
                if not os.path.exists(target_path):
                    issues.append(
                        _issue(
                            "MISSING_OUTPUT_FILE",
                            f"Expected output file {expected_file.get('path')} was not created.",
                            target=expected_file.get("path"),
                        )
                    )
                    continue
                try:
                    actual_content = _read_text(target_path)
                except Exception as exc:  # noqa: BLE001
                    issues.append(
                        _issue(
                            "OUTPUT_READ_ERROR",
                            f"Could not read output file {expected_file.get('path')}.",
                            target=expected_file.get("path"),
                            error=str(exc),
                        )
                    )
                    continue

                expected_source = _safe_join(tests_dir, expected_file.get("source", ""))
                expected_content = _read_text(expected_source)
                ok, message = _compare_text(
                    actual_content,
                    expected_content,
                    expected_file.get("comparison_mode"),
                    expected_file.get("numeric_tolerance"),
                )
                if not ok:
                    issues.append(
                        _issue(
                            "OUTPUT_MISMATCH",
                            f"Output file {expected_file.get('path')} did not match the expected content.",
                            target=expected_file.get("path"),
                            comparison_mode=expected_file.get("comparison_mode"),
                            expected_preview=_preview(expected_content),
                            actual_preview=_preview(actual_content),
                            comparison_message=message,
                        )
                    )

            if issues:
                return _failure_response(issues)
            return True, {
                "summary": "All built-in checks passed.",
                "failure_kind": "",
                "details": {
                    "args": list(case.get("args", [])),
                    "input_preview": _preview(case.get("stdin", "")),
                    "expected_stdout_preview": _preview((expected_stdout or {}).get("content", "")) if expected_stdout is not None else "",
                    "actual_stdout_preview": _preview(execution.get("stdout", "")),
                    "stderr_preview": _preview(execution.get("stderr", "")),
                    "expected_exit_code": expected_exit_code,
                    "actual_exit_code": execution.get("returncode"),
                    "produced_files": _list_files(case_dir),
                },
                "message": "",
            }

        def _validate_custom(validate_case, case, case_dir, submission_dir, execution):
            expected_exit_code = int(case.get("expected_exit_code", 0))
            execution_issue = _execution_issue(execution, expected_exit_code)
            if execution_issue:
                return _failure_response([execution_issue])
            issues = []

            context = _build_validator_context(
                case_dir,
                submission_dir,
                execution.get("stdout", ""),
                execution.get("stderr", ""),
                execution.get("returncode"),
            )
            result = validate_case(case, context)
            if not isinstance(result, dict):
                raise RuntimeError("validate_case must return a dict")
            validator_passed = bool(result.get("passed"))
            validator_message = str(result.get("message", "") or "").strip()
            if not validator_passed:
                issues.append(
                    _issue(
                        "VALIDATOR_FAILED",
                        validator_message or "Custom validator reported a failure.",
                        validator_message=validator_message,
                        stdout_preview=_preview(execution.get("stdout", "")),
                        stderr_preview=_preview(execution.get("stderr", "")),
                    )
                )
            if issues:
                return _failure_response(issues, validator_message)
            return True, {
                "summary": "Custom validator accepted the submission output.",
                "failure_kind": "",
                "details": {
                    "expected_exit_code": expected_exit_code,
                    "actual_exit_code": execution.get("returncode"),
                },
                "message": validator_message,
            }

        def main():
            if len(sys.argv) < 3:
                print("Usage: python run_tests.py <submission_dir> <workspace>")
                return 1

            submission_dir = sys.argv[1]
            workspace = sys.argv[2]
            tests_dir = os.path.dirname(__file__)
            tests_path = os.path.join(tests_dir, "tests.json")
            with open(tests_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)

            results = []
            default_timeout = _as_ms(payload.get("timeout_ms"))
            validator = None
            validator_error = ""
            if any((case.get("validation_mode") or "BUILT_IN") == "CUSTOM" for case in payload.get("cases", [])):
                try:
                    validator = _load_validator(tests_dir)
                except Exception as exc:  # noqa: BLE001
                    validator_error = str(exc)

            for index, case in enumerate(payload.get("cases", []), start=1):
                case_name = case.get("name") or f"case-{index}"
                case_timeout = _as_ms(case.get("timeout_ms")) or default_timeout
                started_at = time.time()
                case_dir = tempfile.mkdtemp(prefix=f"case_{index}_", dir=workspace)
                try:
                    _prepare_case_dir(submission_dir, case_dir)
                    _write_grading_files(tests_dir, case_dir, payload)
                    _write_input_fixtures(tests_dir, case_dir, case)
                    try:
                        execution = _run_case(payload, case_dir, case, case_timeout)
                    except subprocess.TimeoutExpired as exc:
                        results.append(
                            _result(
                                case_name,
                                "FAIL",
                                int((time.time() - started_at) * 1000),
                                message=f"Timeout after {case_timeout} ms" if case_timeout else "Timeout",
                                summary="Execution exceeded the time limit.",
                                failure_kind="TIMEOUT",
                                details={
                                    "timeout_ms": case_timeout,
                                    "stdout_preview": _preview(getattr(exc, "stdout", "") or ""),
                                    "stderr_preview": _preview(getattr(exc, "stderr", "") or ""),
                                },
                            )
                        )
                        continue
                    except FileNotFoundError as exc:
                        results.append(
                            _result(
                                case_name,
                                "FAIL",
                                int((time.time() - started_at) * 1000),
                                message=str(exc),
                                summary="Required execution tool is not available on the grader worker.",
                                failure_kind="EXECUTION_TOOL_MISSING",
                                details={"error": str(exc)},
                            )
                        )
                        continue

                    validation_mode = (case.get("validation_mode") or "BUILT_IN").upper()
                    if validation_mode == "CUSTOM":
                        if validator_error:
                            passed = False
                            feedback = {
                                "summary": "Custom validator could not be loaded.",
                                "failure_kind": "VALIDATOR_ERROR",
                                "details": {"error": validator_error},
                                "message": validator_error,
                            }
                        elif validator is None:
                            passed = False
                            feedback = {
                                "summary": "Custom validator is missing from the test bundle.",
                                "failure_kind": "VALIDATOR_ERROR",
                                "details": {},
                                "message": "validator.py not available",
                            }
                        else:
                            try:
                                passed, feedback = _validate_custom(
                                    validator,
                                    case,
                                    case_dir,
                                    submission_dir,
                                    execution,
                                )
                            except Exception as exc:  # noqa: BLE001
                                passed = False
                                feedback = {
                                    "summary": "Custom validator raised an exception.",
                                    "failure_kind": "VALIDATOR_ERROR",
                                    "details": {"error": str(exc)},
                                    "message": f"Custom validator failed: {exc}",
                                }
                    else:
                        passed, feedback = _validate_built_in(tests_dir, case_dir, case, execution)

                    results.append(
                        _result(
                            case_name,
                            "PASS" if passed else "FAIL",
                            int((time.time() - started_at) * 1000),
                            message=(feedback.get("message") or execution.get("stderr", "").strip()),
                            summary=feedback.get("summary", ""),
                            failure_kind=feedback.get("failure_kind", ""),
                            details=feedback.get("details") or {},
                        )
                    )
                finally:
                    shutil.rmtree(case_dir, ignore_errors=True)

            write_results(workspace, results)
            return 0

        if __name__ == "__main__":
            raise SystemExit(main())
        """
    ).strip() + "\n"


def _build_file_io_bundle_bytes(
    language,
    cases,
    timeout_ms=None,
    entry_path='',
    main_class='',
    validator_code='',
    grading_files=None,
    primary_grading_file='',
):
    tests_payload = {
        'type': 'FILE_IO',
        'language': language,
        'cases': [],
        'grading_files': [],
    }
    if timeout_ms:
        tests_payload['timeout_ms'] = int(timeout_ms)
    if entry_path:
        tests_payload['entry_path'] = entry_path
    if main_class:
        tests_payload['main_class'] = main_class
    if primary_grading_file:
        tests_payload['primary_grading_file'] = primary_grading_file

    files = {
        'README.md': (
            f'# {language.title()} file I/O tests (builder)\n\n'
            'Generated by the assignment builder.\n'
            'Each case provides file fixtures, command-line arguments, and output expectations.\n'
            'Optional grading files are merged into the execution workspace before each case runs.\n'
        ),
        'run_tests.py': _build_file_io_runner_script(),
    }

    for fixture in grading_files or []:
        source = f"grading/{fixture['path']}"
        files[source] = fixture.get('content', '')
        tests_payload['grading_files'].append({
            'path': fixture['path'],
            'source': source,
        })

    for case in cases:
        payload_case = {
            'name': case.get('name'),
            'args': list(case.get('args') or []),
            'stdin': case.get('stdin', ''),
            'expected_exit_code': int(case.get('expected_exit_code', 0)),
            'validation_mode': case.get('validation_mode', 'BUILT_IN'),
            'input_files': [],
            'expected_files': [],
        }
        case_timeout = case.get('timeout_ms')
        if case_timeout:
            payload_case['timeout_ms'] = int(case_timeout)

        expected_stdout = case.get('expected_stdout')
        if expected_stdout is not None:
            payload_case['expected_stdout'] = expected_stdout
        expected_stderr = case.get('expected_stderr')
        if expected_stderr is not None:
            payload_case['expected_stderr'] = expected_stderr

        for fixture in case.get('input_files', []):
            source = fixture['source']
            files[source] = fixture.get('content', '')
            payload_case['input_files'].append({
                'path': fixture['path'],
                'source': source,
            })

        for fixture in case.get('expected_files', []):
            source = fixture['source']
            files[source] = fixture.get('content', '')
            payload_case['expected_files'].append({
                'path': fixture['path'],
                'source': source,
                'comparison_mode': fixture.get('comparison_mode', 'EXACT'),
                'numeric_tolerance': fixture.get('numeric_tolerance'),
            })

        tests_payload['cases'].append(payload_case)

    if validator_code.strip():
        files['validator.py'] = validator_code.rstrip() + "\n"

    files['tests.json'] = json.dumps(tests_payload, indent=2)
    return _zip_bytes(files)


class AssignmentViewSet(viewsets.ModelViewSet):
    serializer_class = AssignmentSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_queryset(self):
        qs = (
            Assignment.objects.select_related('course', 'language', 'group_set')
            .prefetch_related(
                Prefetch(
                    'assignmentgroup_set',
                    queryset=AssignmentGroup.objects.select_related('group', 'group__group_set').order_by('group__name'),
                    to_attr='prefetched_assignment_groups',
                )
            )
            .order_by('due_at', 'title')
        )
        course_id = self.request.query_params.get('course_id')
        user = self.request.user

        if course_id:
            if self._is_course_member(user, course_id) or user.is_superuser:
                return qs.filter(course_id=course_id)
            return Assignment.objects.none()

        if user.is_superuser:
            return qs

        course_ids = Enrollment.objects.filter(
            user=user,
            status=EnrollmentStatus.ACTIVE,
        ).values_list('course_id', flat=True)
        return qs.filter(course_id__in=course_ids)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        course_id = serializer.validated_data.get('course_id')
        course = Course.objects.filter(id=course_id).first()
        if not course:
            return Response({'detail': 'Course not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not self._can_manage_assignments(request.user, course):
            raise PermissionDenied('Not authorized to create assignments for this course.')
        serializer.save(course=course, created_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        assignment = serializer.instance
        if not self._can_manage_assignments(self.request.user, assignment.course):
            raise PermissionDenied('Not authorized to update assignments for this course.')
        serializer.save()

    def perform_destroy(self, instance):
        if not self._can_manage_assignments(self.request.user, instance.course):
            raise PermissionDenied('Not authorized to delete assignments for this course.')
        instance.delete()

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='submission-groups',
    )
    def submission_groups(self, request, pk=None):
        assignment = self.get_object()
        course = assignment.course
        if not self._is_course_member(request.user, course.id) and not request.user.is_superuser:
            raise PermissionDenied('Not authorized to view this assignment.')

        payload = {
            'assignment_id': str(assignment.id),
            'allow_groups': bool(assignment.allow_groups),
            'group_mode': assignment.group_mode,
            'group_set_id': str(assignment.group_set_id) if assignment.group_set_id else None,
            'group_set_name': assignment.group_set.name if assignment.group_set_id else '',
            'assignment_groups': [
                {
                    'id': str(link.group_id),
                    'name': link.group.name,
                    'member_usernames': sorted(
                        member.user.username
                        for member in link.group.groupmember_set.all()
                        if member.user_id
                    ),
                }
                for link in getattr(assignment, 'prefetched_assignment_groups', [])
                if getattr(link, 'group', None) is not None
            ],
            'groups': [],
        }

        if not assignment.allow_groups:
            payload['reason'] = 'This assignment only accepts individual submissions.'
            return Response(payload, status=status.HTTP_200_OK)

        if assignment.group_mode == AssignmentGroupMode.REUSABLE_SET:
            if not assignment.group_set_id:
                payload['reason'] = 'This assignment does not have a reusable group set configured yet.'
                return Response(payload, status=status.HTTP_200_OK)
            groups_qs = Group.objects.filter(
                group_set_id=assignment.group_set_id,
                groupmember__user=request.user,
            )
        else:
            configured_group_ids = [
                link.group_id
                for link in getattr(assignment, 'prefetched_assignment_groups', [])
                if getattr(link, 'group_id', None) is not None
            ]
            if not configured_group_ids:
                payload['reason'] = 'This assignment does not have any groups configured yet.'
                return Response(payload, status=status.HTTP_200_OK)
            groups_qs = Group.objects.filter(
                id__in=configured_group_ids,
                groupmember__user=request.user,
            )

        groups = list(
            groups_qs.select_related('group_set')
            .prefetch_related('groupmember_set__user')
            .distinct()
            .order_by('name')
        )
        payload['groups'] = [
            {
                'id': str(group.id),
                'name': group.name,
                'member_usernames': sorted(
                    member.user.username
                    for member in group.groupmember_set.all()
                    if member.user_id
                ),
            }
            for group in groups
        ]
        return Response(payload, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get', 'put'],
        permission_classes=[IsAuthenticated],
        url_path='workspace',
    )
    def workspace(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_submit_assignment(request.user, assignment.course):
            raise PermissionDenied('Not authorized to use this assignment workspace.')
        self._ensure_workspace_submission_enabled(assignment)

        selected_group_id = request.query_params.get('group_id') or request.data.get('group_id')
        owner_state = self._resolve_workspace_owner_state(
            assignment,
            request.user,
            requested_group_id=selected_group_id,
            allow_unselected=request.method == 'GET',
        )
        if assignment.allow_groups and (owner_state['requires_group_selection'] or (owner_state['reason'] and not owner_state['group'])):
            return Response(
                self._build_workspace_payload(
                    assignment=assignment,
                    user=request.user,
                    groups=owner_state['groups'],
                    group=None,
                    requires_group_selection=owner_state['requires_group_selection'],
                    draft=None,
                    files=[],
                    reason=owner_state['reason'],
                ),
                status=status.HTTP_200_OK,
            )

        draft = self._get_or_create_workspace_draft(assignment, request.user, owner_state['group'])
        if request.method == 'GET':
            files = load_workspace_draft_files(draft, assignment)
            return Response(
                self._build_workspace_payload(
                    assignment=assignment,
                    user=request.user,
                    groups=owner_state['groups'],
                    group=owner_state['group'],
                    requires_group_selection=owner_state['requires_group_selection'],
                    draft=draft,
                    files=files,
                    reason=owner_state['reason'],
                ),
                status=status.HTTP_200_OK,
            )

        input_serializer = SubmissionDraftUpdateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        expected_revision = input_serializer.validated_data.get('expected_revision')
        if expected_revision is not None and expected_revision != draft.revision:
            return Response(
                {
                    'detail': 'This draft has changed. Reload the workspace and try again.',
                    'latest_revision': draft.revision,
                },
                status=status.HTTP_409_CONFLICT,
            )

        draft, files = save_workspace_draft(draft, assignment, input_serializer.validated_data['files'])
        return Response(
            self._build_workspace_payload(
                assignment=assignment,
                user=request.user,
                groups=owner_state['groups'],
                group=owner_state['group'],
                requires_group_selection=False,
                draft=draft,
                files=files,
                reason='',
            ),
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='workspace-run',
    )
    def workspace_run(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_submit_assignment(request.user, assignment.course):
            raise PermissionDenied('Not authorized to run this assignment workspace.')
        self._ensure_workspace_submission_enabled(assignment)

        selected_group_id = request.query_params.get('group_id') or request.data.get('group_id')
        owner_state = self._resolve_workspace_owner_state(
            assignment,
            request.user,
            requested_group_id=selected_group_id,
            allow_unselected=False,
        )
        draft = self._get_or_create_workspace_draft(assignment, request.user, owner_state['group'])
        if not draft.source_bundle_key:
            raise ValidationError({'detail': 'Save your draft before running it.'})

        file_spec = get_assignment_file_run_spec(assignment)
        console_spec = get_assignment_console_spec(assignment)

        if file_spec.get('available'):
            input_serializer = SubmissionFileRunSerializer(data=request.data)
            input_serializer.is_valid(raise_exception=True)
            payload = input_serializer.validated_data
            result = run_assignment_bundle_file_preview(
                assignment=assignment,
                bundle_key=draft.source_bundle_key,
                args=payload.get('args', []),
                input_files=payload.get('input_files', []),
                stdin_text=payload.get('stdin', ''),
                timeout_seconds=(payload.get('timeout_ms') or 5000) / 1000,
            )
            return Response(
                {
                    'kind': 'file',
                    'entry_label': result.get('entry_label') or file_spec.get('entry_label') or '',
                    'command_preview': result.get('command_preview') or file_spec.get('command_preview') or '',
                    'stdout': result.get('stdout') or '',
                    'stderr': result.get('stderr') or '',
                    'stdout_truncated': bool(result.get('stdout_truncated')),
                    'stderr_truncated': bool(result.get('stderr_truncated')),
                    'exit_status': result.get('exit_status'),
                    'returncode': result.get('returncode'),
                    'duration_ms': result.get('duration_ms'),
                    'produced_files': result.get('produced_files') or [],
                },
                status=status.HTTP_200_OK,
            )

        if console_spec.get('available'):
            input_serializer = SubmissionConsoleRunSerializer(data=request.data)
            input_serializer.is_valid(raise_exception=True)
            payload = input_serializer.validated_data
            result = run_assignment_bundle_console(
                assignment=assignment,
                bundle_key=draft.source_bundle_key,
                stdin_text=payload.get('stdin', ''),
                timeout_seconds=(payload.get('timeout_ms') or 5000) / 1000,
            )
            return Response(
                {
                    'kind': 'console',
                    'entry_label': result.get('entry_label') or console_spec.get('entry_label') or '',
                    'command_preview': result.get('command_preview') or console_spec.get('command_preview') or '',
                    'stdout': result.get('stdout') or '',
                    'stderr': result.get('stderr') or '',
                    'stdout_truncated': bool(result.get('stdout_truncated')),
                    'stderr_truncated': bool(result.get('stderr_truncated')),
                    'exit_status': result.get('exit_status'),
                    'returncode': result.get('returncode'),
                    'duration_ms': result.get('duration_ms'),
                },
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                'detail': file_spec.get('reason') or console_spec.get('reason') or 'Interactive execution is not available for this assignment.',
            },
            status=status.HTTP_409_CONFLICT,
        )

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='workspace-submit',
    )
    def workspace_submit(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_submit_assignment(request.user, assignment.course):
            raise PermissionDenied('Not authorized to submit for this course.')
        self._ensure_workspace_submission_enabled(assignment)

        selected_group_id = request.query_params.get('group_id') or request.data.get('group_id')
        owner_state = self._resolve_workspace_owner_state(
            assignment,
            request.user,
            requested_group_id=selected_group_id,
            allow_unselected=False,
        )
        draft = self._get_or_create_workspace_draft(assignment, request.user, owner_state['group'])
        if not draft.source_bundle_key:
            raise ValidationError({'detail': 'Save your draft before submitting.'})

        attempt_number, attempts_used, attempts_remaining = self._get_workspace_attempt_state(
            assignment,
            request.user,
            owner_state['group'],
            consume_attempt=True,
        )
        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            with storage.open(draft.source_bundle_key, 'rb') as handle:
                bundle_bytes = handle.read()
        except Exception as exc:  # noqa: BLE001
            return Response({'detail': f'Unable to load draft bundle: {exc}'}, status=status.HTTP_400_BAD_REQUEST)

        owner_segment = f'groups/{owner_state["group"].id}' if owner_state['group'] else str(request.user.id)
        stored_path = storage.save(
            os.path.join('submissions', str(assignment.id), owner_segment, f'{uuid.uuid4().hex}_submission.zip'),
            ContentFile(bundle_bytes, name='submission.zip'),
        )
        submission = Submission.objects.create(
            assignment=assignment,
            submitted_by=request.user,
            group=owner_state['group'],
            attempt_number=attempt_number,
            status=SubmissionStatus.QUEUED,
            source_bundle_key=stored_path,
            starter_code_version=draft.starter_code_version,
            created_by=request.user,
        )
        payload = SubmissionSerializer(submission).data
        payload['attempts_used'] = attempts_used
        payload['attempts_remaining'] = attempts_remaining
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[IsAuthenticated],
        url_path='integrity-scans',
    )
    def integrity_scans(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to manage assignment integrity scans.')

        if request.method == 'GET':
            scans = (
                IntegrityScan.objects.filter(assignment=assignment, scan_type=IntegrityScanType.PLAGIARISM)
                .select_related('created_by')
                .order_by('-created_at')
            )
            serializer = IntegrityScanSerializer(scans, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)

        input_serializer = IntegrityScanRunSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        config = input_serializer.validated_data
        settings_payload = _build_integrity_settings_payload(
            assignment,
            {
                'threshold': config.get('threshold', 35),
                'latest_only': config.get('latest_only', True),
                'excluded_paths': list(config.get('excluded_paths') or []),
            },
        )
        assignment.integrity_config_json = {
            'threshold': settings_payload['threshold'],
            'latest_only': settings_payload['latest_only'],
            'excluded_paths': settings_payload['manual_excluded_paths'],
        }
        assignment.save(update_fields=['integrity_config_json', 'updated_at'])
        scan = IntegrityScan.objects.create(
            assignment=assignment,
            scan_type=IntegrityScanType.PLAGIARISM,
            provider=IntegrityScanProvider.LOCAL,
            status='PENDING',
            config_json={
                'threshold': settings_payload['threshold'],
                'latest_only': settings_payload['latest_only'],
                'excluded_paths': settings_payload['effective_excluded_paths'],
                'manual_excluded_paths': settings_payload['manual_excluded_paths'],
                'auto_excluded_paths': settings_payload['auto_excluded_paths'],
            },
            algorithm_version='local-v1',
            created_by=request.user,
        )
        run_assignment_plagiarism_scan(scan)
        serializer = IntegrityScanSerializer(scan)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['get', 'put'],
        permission_classes=[IsAuthenticated],
        url_path='integrity-settings',
    )
    def integrity_settings(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to manage assignment integrity settings.')

        if request.method == 'GET':
            return Response(_build_integrity_settings_payload(assignment), status=status.HTTP_200_OK)

        input_serializer = IntegrityScanRunSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        config = input_serializer.validated_data
        assignment.integrity_config_json = {
            'threshold': config.get('threshold', 35),
            'latest_only': config.get('latest_only', True),
            'excluded_paths': list(config.get('excluded_paths') or []),
        }
        assignment.save(update_fields=['integrity_config_json', 'updated_at'])
        return Response(_build_integrity_settings_payload(assignment), status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path=r'integrity-scans/(?P<scan_id>[^/.]+)/findings',
    )
    def integrity_scan_findings(self, request, pk=None, scan_id=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to manage assignment integrity scans.')

        scan = (
            IntegrityScan.objects.filter(
                id=scan_id,
                assignment=assignment,
                scan_type=IntegrityScanType.PLAGIARISM,
            )
            .select_related('created_by')
            .first()
        )
        if not scan:
            return Response({'detail': 'Integrity scan not found.'}, status=status.HTTP_404_NOT_FOUND)

        findings = (
            IntegrityFinding.objects.filter(scan=scan)
            .select_related('submission__submitted_by', 'submission__group', 'matched_submission__submitted_by', 'matched_submission__group')
            .prefetch_related('submission__group__groupmember_set__user', 'matched_submission__group__groupmember_set__user')
            .order_by('-score', '-created_at')
        )
        serializer = IntegrityFindingSerializer(findings, many=True)
        return Response(
            {
                'scan': IntegrityScanSerializer(scan).data,
                'findings': serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path=r'integrity-scans/(?P<scan_id>[^/.]+)/findings/(?P<finding_id>[^/.]+)/review',
    )
    def integrity_finding_review(self, request, pk=None, scan_id=None, finding_id=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to manage assignment integrity scans.')

        finding = (
            IntegrityFinding.objects.filter(
                id=finding_id,
                scan_id=scan_id,
                scan__assignment=assignment,
                scan__scan_type=IntegrityScanType.PLAGIARISM,
            )
            .select_related('submission__submitted_by', 'submission__group', 'matched_submission__submitted_by', 'matched_submission__group')
            .first()
        )
        if not finding:
            return Response({'detail': 'Integrity finding not found.'}, status=status.HTTP_404_NOT_FOUND)

        matched_files = list((finding.details_json or {}).get('matched_files') or [])
        if not matched_files:
            return Response({'detail': 'No matched files recorded for this finding.'}, status=status.HTTP_404_NOT_FOUND)

        requested_left = _safe_archive_entry_name(request.query_params.get('left_path', ''))
        requested_right = _safe_archive_entry_name(request.query_params.get('right_path', ''))

        selected = None
        for entry in matched_files:
            left_path = _safe_archive_entry_name(entry.get('left_path'))
            right_path = _safe_archive_entry_name(entry.get('right_path'))
            if requested_left and requested_right:
                if left_path == requested_left and right_path == requested_right:
                    selected = entry
                    break
            elif left_path and right_path:
                selected = entry
                break

        if not selected:
            return Response({'detail': 'Matched file pair not found for this finding.'}, status=status.HTTP_404_NOT_FOUND)

        left_path = _safe_archive_entry_name(selected.get('left_path'))
        right_path = _safe_archive_entry_name(selected.get('right_path'))
        left_source = _read_submission_text_file(finding.submission, left_path)
        right_source = _read_submission_text_file(finding.matched_submission, right_path)

        return Response(
            {
                'finding': IntegrityFindingSerializer(finding).data,
                'selected_pair': {
                    'left_path': left_path,
                    'right_path': right_path,
                'score': selected.get('score'),
                'left_token_count': selected.get('left_token_count'),
                'right_token_count': selected.get('right_token_count'),
                'matched_regions': list(selected.get('matched_regions') or []),
            },
            'matched_files': matched_files,
            'left_source': left_source,
                'right_source': right_source,
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[IsAuthenticated],
        url_path='instruction-files',
    )
    def instruction_files(self, request, pk=None):
        assignment = self.get_object()
        if request.method == 'GET':
            if not (self._is_course_member(request.user, assignment.course_id) or request.user.is_superuser):
                raise PermissionDenied('Not authorized to view assignment files.')
            assets = AssignmentInstructionAsset.objects.filter(assignment=assignment).select_related('uploaded_by')
            serializer = AssignmentInstructionAssetSerializer(assets, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)

        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to upload assignment files.')

        upload = request.FILES.get('file')
        upload_files = request.FILES.getlist('files') or request.FILES.getlist('files[]')
        if upload and upload_files:
            return Response({'detail': 'Provide either file or files[], not both.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload:
            upload_files = [upload]
        if not upload_files:
            return Response({'detail': 'File is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(upload_files) > 50:
            return Response({'detail': 'Too many files uploaded. Limit is 50.'}, status=status.HTTP_400_BAD_REQUEST)

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        current_order = (
            AssignmentInstructionAsset.objects.filter(assignment=assignment)
            .aggregate(max_order=Max('display_order'))
            .get('max_order')
            or 0
        )
        created_assets = []
        seen_names = set()

        for index, uploaded in enumerate(upload_files, start=1):
            original_name = os.path.basename((uploaded.name or '').replace('\\', '/').strip())
            if not original_name:
                return Response({'detail': 'Each uploaded file must have a valid name.'}, status=status.HTTP_400_BAD_REQUEST)
            lowered_name = original_name.lower()
            if lowered_name in seen_names:
                return Response({'detail': f'Duplicate file name: {original_name}'}, status=status.HTTP_400_BAD_REQUEST)
            seen_names.add(lowered_name)

            guessed_mime = uploaded.content_type or mimetypes.guess_type(original_name)[0] or 'application/octet-stream'
            filename = f'{uuid.uuid4().hex}_{original_name}'
            path = os.path.join('assignment_files', str(assignment.id), filename)
            stored_path = storage.save(path, uploaded)

            asset = AssignmentInstructionAsset.objects.create(
                assignment=assignment,
                created_by=request.user,
                uploaded_by=request.user,
                original_name=original_name,
                file_key=stored_path,
                mime_type=guessed_mime,
                file_size=getattr(uploaded, 'size', 0) or 0,
                display_order=current_order + index,
            )
            created_assets.append(asset)

        serializer = AssignmentInstructionAssetSerializer(created_assets, many=True)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['delete'],
        permission_classes=[IsAuthenticated],
        url_path=r'instruction-files/(?P<asset_id>[^/.]+)',
    )
    def instruction_file_delete(self, request, pk=None, asset_id=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to delete assignment files.')
        asset = AssignmentInstructionAsset.objects.filter(id=asset_id, assignment=assignment).first()
        if not asset:
            return Response({'detail': 'Assignment file not found.'}, status=status.HTTP_404_NOT_FOUND)
        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            storage.delete(asset.file_key)
        except Exception:
            pass
        asset.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path=r'instruction-files/(?P<asset_id>[^/.]+)/preview',
    )
    def instruction_file_preview(self, request, pk=None, asset_id=None):
        assignment = self.get_object()
        if not (self._is_course_member(request.user, assignment.course_id) or request.user.is_superuser):
            raise PermissionDenied('Not authorized to view assignment files.')
        asset = AssignmentInstructionAsset.objects.filter(id=asset_id, assignment=assignment).first()
        if not asset:
            return Response({'detail': 'Assignment file not found.'}, status=status.HTTP_404_NOT_FOUND)

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            file_path = storage.path(asset.file_key)
        except Exception:
            return Response({'detail': 'Unable to locate assignment file.'}, status=status.HTTP_404_NOT_FOUND)
        if not os.path.exists(file_path):
            return Response({'detail': 'Assignment file missing.'}, status=status.HTTP_404_NOT_FOUND)

        read_limit = MAX_ASSIGNMENT_INSTRUCTION_PREVIEW_BYTES + 1
        with open(file_path, 'rb') as handle:
            raw_content = handle.read(read_limit)
        truncated = len(raw_content) > MAX_ASSIGNMENT_INSTRUCTION_PREVIEW_BYTES
        if truncated:
            raw_content = raw_content[:MAX_ASSIGNMENT_INSTRUCTION_PREVIEW_BYTES]

        mime_type = asset.mime_type or mimetypes.guess_type(asset.original_name)[0] or 'application/octet-stream'
        if _is_text_like_file(asset.original_name, mime_type):
            content = raw_content.decode('utf-8', errors='replace')
            encoding = 'text'
        else:
            content = base64.b64encode(raw_content).decode('ascii')
            encoding = 'base64'

        return Response(
            {
                'id': str(asset.id),
                'name': asset.original_name,
                'mime_type': mime_type,
                'encoding': encoding,
                'content': content,
                'truncated': truncated,
                'size': asset.file_size,
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path=r'instruction-files/(?P<asset_id>[^/.]+)/download',
    )
    def instruction_file_download(self, request, pk=None, asset_id=None):
        assignment = self.get_object()
        if not (self._is_course_member(request.user, assignment.course_id) or request.user.is_superuser):
            raise PermissionDenied('Not authorized to download assignment files.')
        asset = AssignmentInstructionAsset.objects.filter(id=asset_id, assignment=assignment).first()
        if not asset:
            return Response({'detail': 'Assignment file not found.'}, status=status.HTTP_404_NOT_FOUND)

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            file_path = storage.path(asset.file_key)
        except Exception:
            return Response({'detail': 'Unable to locate assignment file.'}, status=status.HTTP_404_NOT_FOUND)
        if not os.path.exists(file_path):
            return Response({'detail': 'Assignment file missing.'}, status=status.HTTP_404_NOT_FOUND)

        response = FileResponse(open(file_path, 'rb'), as_attachment=True, filename=asset.original_name)
        response['Content-Type'] = asset.mime_type or 'application/octet-stream'
        return response

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[IsAuthenticated],
        url_path='class-runs',
    )
    def class_runs(self, request, pk=None):
        assignment = self.get_object()
        if request.method == 'GET':
            if not self._can_review_assignment_runs(request.user, assignment.course):
                raise PermissionDenied('Not authorized to view class execution runs.')
            runs = (
                ClassExecutionRun.objects.filter(assignment=assignment)
                .select_related('test_suite_version', 'triggered_by')
                .order_by('-created_at')
            )
            payload = [build_class_execution_run_summary(run) for run in runs]
            return Response(payload, status=status.HTTP_200_OK)

        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to start class execution runs.')

        version_id = request.data.get('test_suite_version_id')
        selected_version = None
        if version_id:
            selected_version = (
                TestSuiteVersion.objects.filter(id=version_id, test_suite__assignment=assignment)
                .first()
            )
            if not selected_version:
                return Response({'detail': 'Test suite version not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            run = create_class_execution_run(
                assignment=assignment,
                triggered_by=request.user,
                test_suite_version=selected_version,
            )
        except ValueError as exc:
            message = str(exc)
            status_code = status.HTTP_409_CONFLICT if 'already in progress' in message else status.HTTP_400_BAD_REQUEST
            return Response({'detail': message}, status=status_code)

        payload = build_class_execution_run_payload(run)
        return Response(payload, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path=r'class-runs/(?P<run_id>[^/.]+)',
    )
    def class_run_detail(self, request, pk=None, run_id=None):
        assignment = self.get_object()
        if not self._can_review_assignment_runs(request.user, assignment.course):
            raise PermissionDenied('Not authorized to view class execution runs.')

        run = (
            ClassExecutionRun.objects.filter(id=run_id, assignment=assignment)
            .select_related('test_suite_version', 'triggered_by')
            .first()
        )
        if not run:
            return Response({'detail': 'Class execution run not found.'}, status=status.HTTP_404_NOT_FOUND)

        payload = build_class_execution_run_payload(run)
        return Response(payload, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites',
    )
    def test_suites(self, request, pk=None):
        assignment = self.get_object()
        if request.method == 'GET':
            if not (
                self._is_course_member(request.user, assignment.course_id)
                or request.user.is_superuser
                or request.user.groups.filter(name='Instructor').exists()
            ):
                raise PermissionDenied('Not authorized to view test suites.')
            visibility = (request.query_params.get('visibility') or '').strip().upper()
            test_suite = (
                TestSuite.objects.filter(assignment=assignment)
                .select_related('active_version')
                .first()
            )
            qs = TestSuiteVersion.objects.filter(test_suite__assignment=assignment).select_related('test_suite')
            if visibility in TestSuiteVisibility.values:
                qs = qs.filter(visibility=visibility)
            qs = qs.order_by('-created_at')
            serializer = TestSuiteVersionSerializer(
                qs,
                many=True,
                context={'active_version_id': test_suite.active_version_id if test_suite else None},
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to upload test suites.')

        upload = request.FILES.get('file')
        upload_files = request.FILES.getlist('files') or request.FILES.getlist('files[]')
        visibility = (request.data.get('visibility') or TestSuiteVisibility.PRIVATE).upper()
        if visibility not in TestSuiteVisibility.values:
            return Response({'detail': 'Invalid visibility.'}, status=status.HTTP_400_BAD_REQUEST)

        set_active_raw = request.data.get('set_active', True)
        if isinstance(set_active_raw, bool):
            set_active = set_active_raw
        else:
            lowered = str(set_active_raw).strip().lower()
            if lowered in {'1', 'true', 'yes', 'on', ''}:
                set_active = True
            elif lowered in {'0', 'false', 'no', 'off'}:
                set_active = False
            else:
                return Response({'detail': 'Invalid set_active value.'}, status=status.HTTP_400_BAD_REQUEST)

        execution_mode_raw = (request.data.get('execution_mode') or '').strip().upper()
        if execution_mode_raw and execution_mode_raw not in TestSuiteExecutionMode.values:
            return Response({'detail': 'Invalid execution_mode.'}, status=status.HTTP_400_BAD_REQUEST)
        requested_execution_mode = execution_mode_raw or None

        def _uploaded_is_zip(uploaded):
            try:
                if hasattr(uploaded, 'seek'):
                    uploaded.seek(0)
                return zipfile.is_zipfile(uploaded)
            finally:
                if hasattr(uploaded, 'seek'):
                    uploaded.seek(0)

        has_zip_upload = upload is not None
        has_file_uploads = len(upload_files) > 0

        if not has_zip_upload and has_file_uploads:
            zip_flags = [_uploaded_is_zip(file_obj) for file_obj in upload_files]
            zip_count = sum(1 for flag in zip_flags if flag)
            if zip_count == 1 and len(upload_files) == 1:
                upload = upload_files[0]
                upload_files = []
                has_zip_upload = True
                has_file_uploads = False
            elif zip_count > 0:
                return Response(
                    {'detail': 'Upload either one .zip file or raw files, not a mix.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if has_zip_upload and has_file_uploads:
            return Response(
                {'detail': 'Provide either file (.zip) or files[], not both.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not has_zip_upload and not has_file_uploads:
            return Response({'detail': 'File is required.'}, status=status.HTTP_400_BAD_REQUEST)

        test_suite, _ = TestSuite.objects.get_or_create(assignment=assignment)
        current_version = (
            TestSuiteVersion.objects.filter(test_suite=test_suite, visibility=visibility)
            .aggregate(max_version=Max('version_number'))
            .get('max_version')
            or 0
        )
        next_version = current_version + 1

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        if has_zip_upload:
            if not zipfile.is_zipfile(upload):
                return Response({'detail': 'Test suite must be a .zip file.'}, status=status.HTTP_400_BAD_REQUEST)
            if hasattr(upload, 'seek'):
                upload.seek(0)

            hasher = hashlib.sha256()
            for chunk in upload.chunks():
                hasher.update(chunk)
            checksum = hasher.hexdigest()
            if hasattr(upload, 'seek'):
                upload.seek(0)

            filename = f"v{next_version}_{upload.name}"
            path = os.path.join('test_suites', str(assignment.id), visibility.lower(), filename)
            stored_path = storage.save(path, upload)
            execution_mode = requested_execution_mode or TestSuiteExecutionMode.LANGUAGE_TEMPLATE
        else:
            if len(upload_files) > 300:
                return Response(
                    {'detail': 'Too many files uploaded. Limit is 300.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            files_payload = {}
            for uploaded in upload_files:
                raw_name = (uploaded.name or '').replace('\\', '/').strip()
                safe_name = os.path.basename(raw_name)
                if not safe_name:
                    return Response({'detail': 'Each uploaded file must have a valid name.'}, status=status.HTTP_400_BAD_REQUEST)
                if safe_name in files_payload:
                    return Response(
                        {'detail': f'Duplicate file name: {safe_name}'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                files_payload[safe_name] = uploaded.read()

            bundle_bytes = _zip_bytes(files_payload)
            checksum = hashlib.sha256(bundle_bytes).hexdigest()

            suite_name = (request.data.get('name') or 'uploaded-files').strip()
            safe_name = slugify(suite_name) or 'uploaded-files'
            filename = f"v{next_version}_{safe_name}.zip"
            path = os.path.join('test_suites', str(assignment.id), visibility.lower(), filename)
            stored_path = storage.save(path, ContentFile(bundle_bytes))
            auto_mode = (
                TestSuiteExecutionMode.PYTHON_RUNNER
                if 'run_tests.py' in files_payload
                else TestSuiteExecutionMode.LANGUAGE_TEMPLATE
            )
            execution_mode = requested_execution_mode or auto_mode

        version = TestSuiteVersion.objects.create(
            test_suite=test_suite,
            version_number=next_version,
            visibility=visibility,
            execution_mode=execution_mode,
            bundle_key=stored_path,
            checksum=checksum,
        )
        if set_active or not test_suite.active_version_id:
            test_suite.active_version = version
            test_suite.save(update_fields=['active_version'])

        serializer = TestSuiteVersionSerializer(
            version,
            context={'active_version_id': test_suite.active_version_id},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites/build',
    )
    def build_test_suite(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to build test suites.')

        input_serializer = TestSuiteBuildInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        language_obj = assignment.language
        requested_language_id = payload.get('language_id')
        if requested_language_id and not language_obj:
            language_obj = ProgrammingLanguage.objects.filter(id=requested_language_id).first()
            if not language_obj:
                return Response({'detail': 'Language not found.'}, status=status.HTTP_400_BAD_REQUEST)

        family = _language_family(language_obj)
        if not family:
            return Response(
                {'detail': 'Direct builder currently supports Python and Java assignments only.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        suite_type = payload.get('type', 'IO')
        timeout_ms = payload.get('timeout_ms')
        visibility = payload.get('visibility') or TestSuiteVisibility.PRIVATE
        set_active = payload.get('set_active', True)
        suite_name = (payload.get('name') or 'tests').strip()

        if suite_type == 'IO':
            tests = []
            for index, case in enumerate(payload.get('tests', []), start=1):
                name = (case.get('name') or f'case-{index}').strip() or f'case-{index}'
                entry = {
                    'name': name,
                    'input': str(case.get('input', '')),
                    'expected': str(case.get('expected', '')),
                }
                case_timeout_ms = case.get('timeout_ms')
                if case_timeout_ms:
                    entry['timeout_ms'] = int(case_timeout_ms)
                tests.append(entry)
            if not tests:
                return Response({'detail': 'At least one test case is required.'}, status=status.HTTP_400_BAD_REQUEST)

            if family == 'python':
                bundle_bytes = _build_python_io_bundle_bytes(tests, timeout_ms=timeout_ms)
            elif family == 'java':
                main_class = (payload.get('main_class') or '').strip()
                if not main_class:
                    return Response({'detail': 'main_class is required for Java I/O tests.'}, status=status.HTTP_400_BAD_REQUEST)
                bundle_bytes = _build_java_io_bundle_bytes(main_class, tests, timeout_ms=timeout_ms)
            else:
                return Response(
                    {'detail': 'IO builder currently supports Python and Java assignments only.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            execution_mode = TestSuiteExecutionMode.PYTHON_RUNNER
            default_name = 'io-tests'
        elif suite_type == 'OOP':
            class_tests = []
            main_tests = []

            for index, case in enumerate(payload.get('class_tests', []), start=1):
                case_name = (case.get('name') or f'class-case-{index}').strip() or f'class-case-{index}'
                normalized = {
                    'name': case_name,
                    'class_name': (case.get('class_name') or '').strip(),
                    'constructor_args': list(case.get('constructor_args') or []),
                    'steps': list(case.get('steps') or []),
                    'assert_method': (case.get('assert_method') or '').strip(),
                    'assert_args': list(case.get('assert_args') or []),
                    'expected': case.get('expected'),
                }
                case_timeout_ms = case.get('timeout_ms')
                if case_timeout_ms:
                    normalized['timeout_ms'] = int(case_timeout_ms)
                class_tests.append(normalized)

            for index, case in enumerate(payload.get('main_tests', []), start=1):
                case_name = (case.get('name') or f'main-case-{index}').strip() or f'main-case-{index}'
                normalized = {
                    'name': case_name,
                    'input': str(case.get('input', '')),
                    'expected': str(case.get('expected', '')),
                }
                case_timeout_ms = case.get('timeout_ms')
                if case_timeout_ms:
                    normalized['timeout_ms'] = int(case_timeout_ms)
                main_class = (case.get('main_class') or '').strip()
                if main_class:
                    normalized['main_class'] = main_class
                main_tests.append(normalized)

            if not class_tests and not main_tests:
                return Response(
                    {'detail': 'At least one class test or main test is required.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if family == 'python':
                module_path = (payload.get('module_path') or '').strip()
                if not module_path:
                    return Response({'detail': 'module_path is required for Python OOP tests.'}, status=status.HTTP_400_BAD_REQUEST)
                if not _safe_relative_module_path(module_path):
                    return Response({'detail': 'module_path must be a safe relative path.'}, status=status.HTTP_400_BAD_REQUEST)
                if not module_path.endswith('.py'):
                    return Response({'detail': 'module_path must point to a .py file.'}, status=status.HTTP_400_BAD_REQUEST)
                bundle_bytes = _build_python_oop_bundle_bytes(
                    module_path=module_path,
                    class_tests=class_tests,
                    main_tests=main_tests,
                    timeout_ms=timeout_ms,
                )
            elif family == 'java':
                for case in class_tests:
                    scalar_lists = [
                        ('constructor_args', case.get('constructor_args') or []),
                        ('assert_args', case.get('assert_args') or []),
                    ]
                    for step in case.get('steps') or []:
                        scalar_lists.append(('step args', step.get('args') or []))
                    for field_name, values in scalar_lists:
                        if not isinstance(values, list):
                            return Response(
                                {'detail': f'{field_name} must be a JSON array for Java OOP tests.'},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                        if not all(_is_java_scalar(value) for value in values):
                            return Response(
                                {'detail': f'{field_name} must contain only string/number/boolean values for Java OOP tests.'},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                    if not _is_java_scalar(case.get('expected')):
                        return Response(
                            {'detail': 'expected must be string/number/boolean for Java OOP tests.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                bundle_bytes = _build_java_oop_bundle_bytes(
                    class_tests=class_tests,
                    main_tests=main_tests,
                    timeout_ms=timeout_ms,
                )
            else:
                return Response(
                    {'detail': 'OOP builder currently supports Python and Java only.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            execution_mode = TestSuiteExecutionMode.PYTHON_RUNNER
            default_name = 'oop-tests'
        elif suite_type == 'FILE_IO':
            cases = []
            entry_path = ''
            main_class = ''
            validator_code = payload.get('validator_code') or ''
            grading_files = []
            primary_grading_file = (payload.get('primary_grading_file') or '').strip()
            java_main_candidates = []

            for fixture in payload.get('grading_files', []):
                grading_files.append({
                    'path': fixture.get('path'),
                    'content': fixture.get('content', ''),
                })

            if family == 'python':
                entry_path = (payload.get('entry_path') or '').strip()
                if not entry_path:
                    return Response({'detail': 'entry_path is required for Python file I/O tests.'}, status=status.HTTP_400_BAD_REQUEST)
                if not _safe_relative_module_path(entry_path):
                    return Response({'detail': 'entry_path must be a safe relative path.'}, status=status.HTTP_400_BAD_REQUEST)
                if not entry_path.endswith('.py'):
                    return Response({'detail': 'entry_path must point to a .py file.'}, status=status.HTTP_400_BAD_REQUEST)
            elif family == 'java':
                java_main_candidates = _collect_java_main_candidates(grading_files)
                candidate_paths = {item['path'] for item in java_main_candidates}
                main_class = (payload.get('main_class') or '').strip()
                if primary_grading_file and candidate_paths and primary_grading_file not in candidate_paths:
                    return Response(
                        {'detail': 'primary_grading_file must point to an uploaded Java grading file that contains main().'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if not main_class:
                    if len(java_main_candidates) == 1:
                        main_class = java_main_candidates[0]['main_class']
                        if not primary_grading_file:
                            primary_grading_file = java_main_candidates[0]['path']
                    elif len(java_main_candidates) > 1:
                        return Response(
                            {'detail': 'Multiple uploaded Java grading files contain main(). Choose the primary grading file or provide main_class.'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    else:
                        return Response({'detail': 'main_class is required for Java file I/O tests.'}, status=status.HTTP_400_BAD_REQUEST)
            else:
                return Response(
                    {'detail': 'File I/O builder currently supports Python and Java only.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            for index, case in enumerate(payload.get('cases', []), start=1):
                case_name = (case.get('name') or f'case-{index}').strip() or f'case-{index}'
                case_slug = f"case-{index}-{slugify(case_name) or 'file-io'}"
                normalized = {
                    'name': case_name,
                    'args': [str(arg) for arg in (case.get('args') or [])],
                    'stdin': str(case.get('stdin', '')),
                    'expected_exit_code': int(case.get('expected_exit_code', 0)),
                    'validation_mode': case.get('validation_mode') or 'BUILT_IN',
                    'input_files': [],
                    'expected_files': [],
                }
                case_timeout_ms = case.get('timeout_ms')
                if case_timeout_ms:
                    normalized['timeout_ms'] = int(case_timeout_ms)

                for fixture in case.get('input_files', []):
                    normalized['input_files'].append({
                        'path': fixture.get('path'),
                        'content': fixture.get('content', ''),
                        'source': f"cases/{case_slug}/input/{fixture.get('path')}",
                    })

                for fixture in case.get('expected_files', []):
                    normalized['expected_files'].append({
                        'path': fixture.get('path'),
                        'content': fixture.get('content', ''),
                        'comparison_mode': fixture.get('comparison_mode') or 'EXACT',
                        'numeric_tolerance': fixture.get('numeric_tolerance'),
                        'source': f"cases/{case_slug}/expected/{fixture.get('path')}",
                    })

                expected_stdout = case.get('expected_stdout')
                if expected_stdout is not None:
                    normalized['expected_stdout'] = {
                        'content': expected_stdout.get('content', ''),
                        'comparison_mode': expected_stdout.get('comparison_mode') or 'EXACT',
                        'numeric_tolerance': expected_stdout.get('numeric_tolerance'),
                    }

                expected_stderr = case.get('expected_stderr')
                if expected_stderr is not None:
                    normalized['expected_stderr'] = {
                        'content': expected_stderr.get('content', ''),
                        'comparison_mode': expected_stderr.get('comparison_mode') or 'EXACT',
                        'numeric_tolerance': expected_stderr.get('numeric_tolerance'),
                    }

                cases.append(normalized)

            bundle_bytes = _build_file_io_bundle_bytes(
                language=family,
                cases=cases,
                timeout_ms=timeout_ms,
                entry_path=entry_path,
                main_class=main_class,
                validator_code=validator_code,
                grading_files=grading_files,
                primary_grading_file=primary_grading_file,
            )
            execution_mode = TestSuiteExecutionMode.PYTHON_RUNNER
            default_name = 'file-io-tests'
        else:
            return Response({'detail': 'Unsupported builder type.'}, status=status.HTTP_400_BAD_REQUEST)

        if not suite_name:
            suite_name = default_name

        checksum = hashlib.sha256(bundle_bytes).hexdigest()

        test_suite, _ = TestSuite.objects.get_or_create(assignment=assignment)
        current_version = (
            TestSuiteVersion.objects.filter(test_suite=test_suite, visibility=visibility)
            .aggregate(max_version=Max('version_number'))
            .get('max_version')
            or 0
        )
        next_version = current_version + 1

        safe_name = slugify(suite_name) or default_name
        filename = f"v{next_version}_{safe_name}.zip"
        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        path = os.path.join('test_suites', str(assignment.id), visibility.lower(), filename)
        stored_path = storage.save(path, ContentFile(bundle_bytes))

        version = TestSuiteVersion.objects.create(
            test_suite=test_suite,
            version_number=next_version,
            visibility=visibility,
            execution_mode=execution_mode,
            bundle_key=stored_path,
            checksum=checksum,
        )

        if set_active or not test_suite.active_version_id:
            test_suite.active_version = version
            test_suite.save(update_fields=['active_version'])

        serializer = TestSuiteVersionSerializer(
            version,
            context={'active_version_id': test_suite.active_version_id},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites/activate',
    )
    def activate_test_suite(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to update test suites.')
        version_id = request.data.get('version_id')
        if not version_id:
            return Response({'detail': 'version_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        version = TestSuiteVersion.objects.filter(id=version_id, test_suite__assignment=assignment).first()
        if not version:
            return Response({'detail': 'Test suite version not found.'}, status=status.HTTP_404_NOT_FOUND)
        test_suite = version.test_suite
        test_suite.active_version = version
        test_suite.save(update_fields=['active_version'])
        serializer = TestSuiteVersionSerializer(
            version,
            context={'active_version_id': test_suite.active_version_id},
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites/(?P<version_id>[^/.]+)/manifest',
    )
    def test_suite_manifest(self, request, pk=None, version_id=None):
        assignment = self.get_object()
        if not (
            self._is_course_member(request.user, assignment.course_id)
            or request.user.is_superuser
            or request.user.groups.filter(name='Instructor').exists()
        ):
            raise PermissionDenied('Not authorized to view test suites.')
        version = TestSuiteVersion.objects.filter(id=version_id, test_suite__assignment=assignment).first()
        if not version:
            return Response({'detail': 'Test suite version not found.'}, status=status.HTTP_404_NOT_FOUND)
        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            file_path = storage.path(version.bundle_key)
        except Exception:
            return Response({'detail': 'Unable to locate test suite.'}, status=status.HTTP_404_NOT_FOUND)

        if not os.path.exists(file_path):
            return Response({'detail': 'Test suite file missing.'}, status=status.HTTP_404_NOT_FOUND)

        files = []
        total_size = 0
        try:
            with zipfile.ZipFile(file_path, 'r') as zip_ref:
                for info in zip_ref.infolist():
                    is_dir = info.is_dir()
                    entry = {
                        'name': info.filename,
                        'size': info.file_size,
                        'compressed_size': info.compress_size,
                        'is_dir': is_dir,
                    }
                    files.append(entry)
                    if not is_dir:
                        total_size += info.file_size
        except zipfile.BadZipFile:
            return Response({'detail': 'Invalid zip file.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                'version_id': str(version.id),
                'file_count': len(files),
                'total_size': total_size,
                'files': files[:300],
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites/(?P<version_id>[^/.]+)/file',
    )
    def test_suite_file(self, request, pk=None, version_id=None):
        assignment = self.get_object()
        if not (
            self._is_course_member(request.user, assignment.course_id)
            or request.user.is_superuser
            or request.user.groups.filter(name='Instructor').exists()
        ):
            raise PermissionDenied('Not authorized to view test suites.')

        version = TestSuiteVersion.objects.filter(id=version_id, test_suite__assignment=assignment).first()
        if not version:
            return Response({'detail': 'Test suite version not found.'}, status=status.HTTP_404_NOT_FOUND)

        entry_name = _safe_archive_entry_name(request.query_params.get('name'))
        if not entry_name:
            return Response({'detail': 'name query parameter is required.'}, status=status.HTTP_400_BAD_REQUEST)

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            file_path = storage.path(version.bundle_key)
        except Exception:
            return Response({'detail': 'Unable to locate test suite.'}, status=status.HTTP_404_NOT_FOUND)

        if not os.path.exists(file_path):
            return Response({'detail': 'Test suite file missing.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            with zipfile.ZipFile(file_path, 'r') as zip_ref:
                try:
                    info = zip_ref.getinfo(entry_name)
                except KeyError:
                    return Response({'detail': 'File not found in test suite.'}, status=status.HTTP_404_NOT_FOUND)

                if info.is_dir():
                    return Response({'detail': 'Cannot preview directory entries.'}, status=status.HTTP_400_BAD_REQUEST)

                read_limit = MAX_TEST_SUITE_PREVIEW_BYTES + 1
                with zip_ref.open(info, 'r') as entry_handle:
                    raw_content = entry_handle.read(read_limit)
        except zipfile.BadZipFile:
            return Response({'detail': 'Invalid zip file.'}, status=status.HTTP_400_BAD_REQUEST)

        truncated = len(raw_content) > MAX_TEST_SUITE_PREVIEW_BYTES
        if truncated:
            raw_content = raw_content[:MAX_TEST_SUITE_PREVIEW_BYTES]
        mime_type = mimetypes.guess_type(info.filename)[0] or 'application/octet-stream'
        is_text = mime_type.startswith('text/')
        if not is_text:
            text_extensions = {
                '.py', '.json', '.md', '.txt', '.yaml', '.yml', '.xml', '.csv',
                '.java', '.js', '.ts', '.jsx', '.tsx', '.c', '.cpp', '.h', '.hpp',
                '.cs', '.go', '.rs', '.kt', '.swift', '.sh', '.sql',
            }
            ext = os.path.splitext(info.filename)[1].lower()
            is_text = ext in text_extensions and b'\x00' not in raw_content

        if is_text:
            content = raw_content.decode('utf-8', errors='replace')
            encoding = 'utf-8'
        else:
            content = base64.b64encode(raw_content).decode('ascii')
            encoding = 'base64'
        return Response(
            {
                'version_id': str(version.id),
                'name': info.filename,
                'size': info.file_size,
                'truncated': truncated,
                'max_preview_bytes': MAX_TEST_SUITE_PREVIEW_BYTES,
                'mime_type': mime_type,
                'encoding': encoding,
                'is_text': is_text,
                'content': content,
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[IsAuthenticated],
        url_path='rubric',
    )
    def rubric(self, request, pk=None):
        assignment = self.get_object()
        if request.method == 'GET':
            if not (
                self._is_course_member(request.user, assignment.course_id)
                or request.user.is_superuser
                or request.user.groups.filter(name='Instructor').exists()
            ):
                raise PermissionDenied('Not authorized to view this rubric.')
            rubric = Rubric.objects.filter(assignment=assignment).select_related('active_version').first()
            if not rubric or not rubric.active_version:
                return Response(
                    {
                        'version_number': 0,
                        'is_weighted': False,
                        'criteria': [],
                        'attachments': [],
                        'total_points': 0,
                        'total_weight': 0,
                    },
                    status=status.HTTP_200_OK,
                )
            version = rubric.active_version
            data = _serialize_rubric_version(version)
            return Response(data, status=status.HTTP_200_OK)

        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to edit this rubric.')

        input_serializer = RubricVersionInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        rubric, version = create_assignment_rubric_version(
            assignment,
            is_weighted=payload.get('is_weighted', False),
            criteria=payload.get('criteria', []),
            created_by=request.user,
        )

        data = _serialize_rubric_version(version)
        return Response(data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='rubric/versions',
    )
    def rubric_versions(self, request, pk=None):
        assignment = self.get_object()
        if not (
            self._is_course_member(request.user, assignment.course_id)
            or request.user.is_superuser
            or request.user.groups.filter(name='Instructor').exists()
        ):
            raise PermissionDenied('Not authorized to view this rubric.')
        rubric = Rubric.objects.filter(assignment=assignment).select_related('active_version').first()
        if not rubric:
            return Response([], status=status.HTTP_200_OK)
        versions = RubricVersion.objects.filter(rubric=rubric).order_by('-created_at')
        criteria = RubricCriterion.objects.filter(rubric_version__in=versions)
        attachments = RubricAttachment.objects.filter(rubric_version__in=versions)
        totals = {}
        weight_totals = {}
        counts = {}
        attachment_counts = {}
        for criterion in criteria:
            vid = criterion.rubric_version_id
            counts[vid] = counts.get(vid, 0) + 1
            totals[vid] = totals.get(vid, 0) + float(criterion.max_points)
            weight_totals[vid] = weight_totals.get(vid, 0) + float(criterion.weight or 0)
        for attachment in attachments:
            vid = attachment.rubric_version_id
            attachment_counts[vid] = attachment_counts.get(vid, 0) + 1
        data = [
            {
                'id': str(version.id),
                'version_number': version.version_number,
                'created_at': version.created_at,
                'is_weighted': version.is_weighted,
                'criteria_count': counts.get(version.id, 0),
                'total_points': totals.get(version.id, 0),
                'total_weight': weight_totals.get(version.id, 0),
                'attachments_count': attachment_counts.get(version.id, 0),
                'is_active': str(version.id) == str(rubric.active_version_id),
            }
            for version in versions
        ]
        return Response(data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='rubric/activate',
    )
    def rubric_activate(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to edit this rubric.')
        version_id = request.data.get('version_id')
        if not version_id:
            return Response({'detail': 'version_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        rubric = Rubric.objects.filter(assignment=assignment).first()
        if not rubric:
            return Response({'detail': 'Rubric not found.'}, status=status.HTTP_404_NOT_FOUND)
        version = RubricVersion.objects.filter(id=version_id, rubric=rubric).first()
        if not version:
            return Response({'detail': 'Rubric version not found.'}, status=status.HTTP_404_NOT_FOUND)
        rubric.active_version = version
        rubric.save(update_fields=['active_version'])
        return Response({'detail': 'Active rubric version updated.'}, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[IsAuthenticated],
        url_path='rubric-files',
    )
    def rubric_files(self, request, pk=None):
        assignment = self.get_object()
        rubric = Rubric.objects.filter(assignment=assignment).select_related('active_version').first()

        if request.method == 'GET':
            if not (self._is_course_member(request.user, assignment.course_id) or request.user.is_superuser):
                raise PermissionDenied('Not authorized to view rubric files.')
            version_id = request.query_params.get('version_id')
            if version_id:
                version = RubricVersion.objects.filter(id=version_id, rubric=rubric).first() if rubric else None
            else:
                version = getattr(rubric, 'active_version', None)
            if not version:
                return Response([], status=status.HTTP_200_OK)
            assets = (
                RubricAttachment.objects.filter(rubric_version=version)
                .select_related('uploaded_by', 'rubric_version__rubric')
                .order_by('display_order', 'created_at')
            )
            serializer = RubricAttachmentSerializer(assets, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)

        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to upload rubric files.')

        if not rubric or not rubric.active_version:
            return Response({'detail': 'Create a rubric version before uploading files.'}, status=status.HTTP_400_BAD_REQUEST)

        version_id = request.data.get('version_id')
        version = (
            RubricVersion.objects.filter(id=version_id, rubric=rubric).first()
            if version_id else rubric.active_version
        )
        if not version:
            return Response({'detail': 'Rubric version not found.'}, status=status.HTTP_404_NOT_FOUND)

        upload = request.FILES.get('file')
        upload_files = request.FILES.getlist('files') or request.FILES.getlist('files[]')
        if upload and upload_files:
            return Response({'detail': 'Provide either file or files[], not both.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload:
            upload_files = [upload]
        if not upload_files:
            return Response({'detail': 'File is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(upload_files) > 25:
            return Response({'detail': 'Too many files uploaded. Limit is 25.'}, status=status.HTTP_400_BAD_REQUEST)

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        current_order = (
            RubricAttachment.objects.filter(rubric_version=version)
            .aggregate(max_order=Max('display_order'))
            .get('max_order')
            or 0
        )
        created_assets = []
        seen_names = set()

        for index, uploaded in enumerate(upload_files, start=1):
            original_name = os.path.basename((uploaded.name or '').replace('\\', '/').strip())
            if not original_name:
                return Response({'detail': 'Each uploaded file must have a valid name.'}, status=status.HTTP_400_BAD_REQUEST)
            lowered_name = original_name.lower()
            if lowered_name in seen_names:
                return Response({'detail': f'Duplicate file name: {original_name}'}, status=status.HTTP_400_BAD_REQUEST)
            seen_names.add(lowered_name)

            guessed_mime = uploaded.content_type or mimetypes.guess_type(original_name)[0] or 'application/octet-stream'
            filename = f'{uuid.uuid4().hex}_{original_name}'
            path = os.path.join('rubric_files', str(assignment.id), str(version.id), filename)
            stored_path = storage.save(path, uploaded)

            asset = RubricAttachment.objects.create(
                rubric_version=version,
                created_by=request.user,
                uploaded_by=request.user,
                original_name=original_name,
                file_key=stored_path,
                mime_type=guessed_mime,
                file_size=getattr(uploaded, 'size', 0) or 0,
                display_order=current_order + index,
            )
            created_assets.append(asset)

        serializer = RubricAttachmentSerializer(created_assets, many=True)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['delete'],
        permission_classes=[IsAuthenticated],
        url_path=r'rubric-files/(?P<asset_id>[^/.]+)',
    )
    def rubric_file_delete(self, request, pk=None, asset_id=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to delete rubric files.')
        asset = (
            RubricAttachment.objects
            .filter(id=asset_id, rubric_version__rubric__assignment=assignment)
            .first()
        )
        if not asset:
            return Response({'detail': 'Rubric file not found.'}, status=status.HTTP_404_NOT_FOUND)
        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            storage.delete(asset.file_key)
        except Exception:
            pass
        asset.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path=r'rubric-files/(?P<asset_id>[^/.]+)/download',
    )
    def rubric_file_download(self, request, pk=None, asset_id=None):
        assignment = self.get_object()
        if not (self._is_course_member(request.user, assignment.course_id) or request.user.is_superuser):
            raise PermissionDenied('Not authorized to download rubric files.')
        asset = (
            RubricAttachment.objects
            .filter(id=asset_id, rubric_version__rubric__assignment=assignment)
            .first()
        )
        if not asset:
            return Response({'detail': 'Rubric file not found.'}, status=status.HTTP_404_NOT_FOUND)

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            file_path = storage.path(asset.file_key)
        except Exception:
            return Response({'detail': 'Unable to locate rubric file.'}, status=status.HTTP_404_NOT_FOUND)
        if not os.path.exists(file_path):
            return Response({'detail': 'Rubric file missing.'}, status=status.HTTP_404_NOT_FOUND)

        response = FileResponse(open(file_path, 'rb'), as_attachment=True, filename=asset.original_name)
        response['Content-Type'] = asset.mime_type or 'application/octet-stream'
        return response

    def _is_course_member(self, user, course_id):
        return Enrollment.objects.filter(
            course_id=course_id,
            user=user,
            status=EnrollmentStatus.ACTIVE,
        ).exists()

    def _can_submit_assignment(self, user, course):
        if user.is_superuser:
            return True
        if user.groups.filter(name='Instructor').exists():
            return True
        return Enrollment.objects.filter(
            course=course,
            user=user,
            status=EnrollmentStatus.ACTIVE,
            role__in=[EnrollmentRole.STUDENT, EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA],
        ).exists()

    def _ensure_workspace_submission_enabled(self, assignment):
        if not assignment.allows_workspace_submission():
            raise ValidationError(
                {'detail': 'This assignment accepts uploaded files only. Workspace submission is disabled.'}
            )
        if assignment.language_id is None:
            raise ValidationError(
                {'detail': 'Workspace submission is available only for assignments with a programming language.'}
            )

    def _workspace_groups_for_user(self, assignment, user):
        if not assignment.allow_groups:
            return [], ''

        if assignment.group_mode == AssignmentGroupMode.REUSABLE_SET:
            if not assignment.group_set_id:
                return [], 'This assignment does not have a reusable group set configured yet.'
            groups_qs = Group.objects.filter(
                group_set_id=assignment.group_set_id,
                groupmember__user=user,
            )
        else:
            configured_group_ids = list(
                AssignmentGroup.objects.filter(assignment=assignment).values_list('group_id', flat=True)
            )
            if not configured_group_ids:
                return [], 'This assignment does not have any groups configured yet.'
            groups_qs = Group.objects.filter(
                id__in=configured_group_ids,
                groupmember__user=user,
            )

        groups = list(
            groups_qs.prefetch_related('groupmember_set__user')
            .distinct()
            .order_by('name')
        )
        if not groups:
            return [], 'You are not a member of any valid group for this assignment.'
        return groups, ''

    def _resolve_workspace_owner_state(self, assignment, user, requested_group_id=None, allow_unselected=False):
        groups, reason = self._workspace_groups_for_user(assignment, user)
        if not assignment.allow_groups:
            return {
                'groups': [],
                'group': None,
                'requires_group_selection': False,
                'reason': '',
            }

        if reason and not groups:
            return {
                'groups': [],
                'group': None,
                'requires_group_selection': False,
                'reason': reason,
            }

        selected_group = None
        if requested_group_id:
            selected_group = next((group for group in groups if str(group.id) == str(requested_group_id)), None)
            if selected_group is None:
                raise ValidationError({'group_id': 'Selected group does not belong to this assignment.'})
        elif len(groups) == 1:
            selected_group = groups[0]
        elif not allow_unselected:
            raise ValidationError({'group_id': 'Choose your group before using the workspace.'})

        return {
            'groups': groups,
            'group': selected_group,
            'requires_group_selection': selected_group is None,
            'reason': '' if selected_group or groups else reason,
        }

    def _serialize_workspace_groups(self, groups):
        return [
            {
                'id': str(group.id),
                'name': group.name,
                'member_usernames': sorted(
                    member.user.username
                    for member in group.groupmember_set.all()
                    if member.user_id
                ),
            }
            for group in groups
        ]

    def _serialize_workspace_owner(self, user, group):
        if group is not None:
            return {
                'kind': 'group',
                'id': str(group.id),
                'name': group.name,
                'member_usernames': sorted(
                    member.user.username
                    for member in group.groupmember_set.all()
                    if member.user_id
                ),
            }
        return {
            'kind': 'user',
            'id': str(user.id),
            'name': user.username,
            'member_usernames': [user.username],
        }

    def _get_or_create_workspace_draft(self, assignment, user, group):
        filters = {'assignment': assignment, 'group': group} if group else {'assignment': assignment, 'user': user}
        draft = SubmissionDraft.objects.filter(**filters).first()
        if draft is not None:
            return draft

        draft = SubmissionDraft.objects.create(
            assignment=assignment,
            user=None if group else user,
            group=group,
            revision=0,
            created_by=user,
        )
        draft, _files = save_workspace_draft(draft, assignment, default_workspace_files(assignment))
        return draft

    def _get_workspace_attempt_state(self, assignment, user, group, consume_attempt=False):
        query = (
            Submission.objects.filter(assignment=assignment, group=group)
            if group is not None
            else Submission.objects.filter(assignment=assignment, submitted_by=user)
        )
        attempts_used = query.aggregate(max_attempt=Max('attempt_number')).get('max_attempt') or 0
        max_attempts = assignment.submission_max_attempts or 0
        if consume_attempt and max_attempts and attempts_used >= max_attempts:
            raise ValidationError({'detail': 'Maximum submission attempts reached.'})

        next_attempt = attempts_used + 1
        attempts_remaining = None if not max_attempts else max(max_attempts - attempts_used - (1 if consume_attempt else 0), 0)
        return next_attempt, attempts_used, attempts_remaining

    def _build_workspace_payload(
        self,
        *,
        assignment,
        user,
        groups,
        group,
        requires_group_selection,
        draft,
        files,
        reason,
    ):
        if requires_group_selection:
            next_attempt = 1
            attempts_used = 0
            attempts_remaining = assignment.submission_max_attempts or 0
        else:
            next_attempt, attempts_used, attempts_remaining = self._get_workspace_attempt_state(
                assignment,
                user,
                group,
                consume_attempt=False,
            )
        return {
            'assignment': self.get_serializer(assignment).data,
            'groups': self._serialize_workspace_groups(groups),
            'requires_group_selection': requires_group_selection,
            'reason': reason,
            'owner': None if requires_group_selection else self._serialize_workspace_owner(user, group),
            'draft': None
            if draft is None
            else {
                'id': str(draft.id),
                'revision': draft.revision,
                'updated_at': draft.updated_at,
                'manifest': list(draft.manifest_json or []),
                'files': files,
            },
            'console': get_assignment_console_spec(assignment),
            'file_run': get_assignment_file_run_spec(assignment),
            'attempts': {
                'used': attempts_used,
                'next': next_attempt,
                'remaining': attempts_remaining,
                'max': assignment.submission_max_attempts or 0,
            },
        }

    def _can_manage_assignments(self, user, course):
        if user.is_superuser:
            return True
        if user.groups.filter(name='Instructor').exists():
            return True
        return Enrollment.objects.filter(
            course=course,
            user=user,
            status=EnrollmentStatus.ACTIVE,
            role__in=[EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA],
        ).exists()

    def _can_review_assignment_runs(self, user, course):
        if user.is_superuser:
            return True
        if user.groups.filter(name='Instructor').exists():
            return True
        return Enrollment.objects.filter(
            course=course,
            user=user,
            status=EnrollmentStatus.ACTIVE,
            role__in=[EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA, EnrollmentRole.GRADER],
        ).exists()
