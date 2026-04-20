import base64
import hashlib
import json
import mimetypes
import os
import subprocess
import shlex
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from decimal import Decimal

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import transaction
from django.utils import timezone

from ..models import (
    GradingExitStatus,
    Grade,
    GradingRun,
    Rubric,
    Submission,
    SubmissionStatus,
    TestResult,
    TestResultStatus,
    TestSuiteExecutionMode,
    TestSuite,
    TestSuiteVisibility,
)


RESULTS_FILENAME = 'results.json'
MAX_CONSOLE_PREVIEW_BYTES = 64 * 1024
MAX_FILE_RUN_PREVIEW_FILES = 20


def grade_submission(submission_id, timeout_seconds=30, test_version_override=None, worker_id='local-runner'):
    submission = (
        Submission.objects.select_related('assignment', 'assignment__language')
        .get(id=submission_id)
    )
    assignment = submission.assignment
    language = assignment.language

    if test_version_override is not None:
        test_version = test_version_override
    else:
        test_suite = TestSuite.objects.filter(assignment=assignment).select_related('active_version').first()
        test_version = test_suite.active_version if test_suite else None

    rubric = Rubric.objects.filter(assignment=assignment).select_related('active_version').first()
    rubric_version = rubric.active_version if rubric else None

    storage = FileSystemStorage(location=settings.MEDIA_ROOT)

    with transaction.atomic():
        run = GradingRun.objects.create(
            submission=submission,
            test_suite_version_public=test_version if test_version and test_version.visibility == TestSuiteVisibility.PUBLIC else None,
            test_suite_version_private=test_version if test_version and test_version.visibility == TestSuiteVisibility.PRIVATE else None,
            rubric_version=rubric_version,
            worker_id=worker_id,
            started_at=timezone.now(),
            exit_status=GradingExitStatus.OK,
        )

    stdout_key = ''
    stderr_key = ''
    results_payload = {}
    exit_status = GradingExitStatus.OK

    try:
        with tempfile.TemporaryDirectory(prefix='gradeforge_') as workspace:
            submission_dir = os.path.join(workspace, 'submission')
            tests_dir = os.path.join(workspace, 'tests')
            os.makedirs(submission_dir, exist_ok=True)
            os.makedirs(tests_dir, exist_ok=True)

            _prepare_submission(storage, submission.source_bundle_key, submission_dir)
            if test_version:
                _prepare_tests(storage, test_version.bundle_key, tests_dir)

            env = os.environ.copy()
            env.update({
                'SUBMISSION_DIR': submission_dir,
                'TESTS_DIR': tests_dir,
                'WORKSPACE_DIR': workspace,
            })

            compile_output = None
            should_run_compile = (
                bool(language and language.compile_cmd)
                and not (
                    test_version
                    and test_version.execution_mode == TestSuiteExecutionMode.PYTHON_RUNNER
                )
            )
            if should_run_compile:
                compile_output = _run_command(
                    language.compile_cmd,
                    cwd=workspace,
                    env=env,
                    timeout_seconds=timeout_seconds,
                )
                if compile_output['status'] != GradingExitStatus.OK:
                    exit_status = compile_output['status']
            test_output = None
            if exit_status == GradingExitStatus.OK:
                run_cmd = _resolve_run_command(
                    language=language,
                    test_version=test_version,
                    submission_dir=submission_dir,
                    tests_dir=tests_dir,
                    workspace=workspace,
                )

                if not run_cmd:
                    exit_status = GradingExitStatus.RUNTIME_ERROR
                    test_output = {
                        'status': GradingExitStatus.RUNTIME_ERROR,
                        'stdout': '',
                        'stderr': 'No run command configured.',
                    }
                else:
                    test_output = _run_command(run_cmd, cwd=workspace, env=env, timeout_seconds=timeout_seconds)
                    exit_status = test_output['status']

            results_payload = _load_results(workspace)
            stdout_text = _combine_output(compile_output, test_output, 'stdout')
            stderr_text = _combine_output(compile_output, test_output, 'stderr')
            stdout_key, stderr_key = _store_logs(storage, submission.id, run.id, stdout_text, stderr_text)
    except Exception as exc:  # noqa: BLE001
        run.finished_at = timezone.now()
        run.exit_status = GradingExitStatus.SANDBOX_ERROR
        run.result_json = {'error': str(exc)}
        run.save(update_fields=['finished_at', 'exit_status', 'result_json'])
        submission.status = SubmissionStatus.FAILED
        submission.save(update_fields=['status'])
        return run

    _persist_results(run, submission, results_payload, stdout_key, stderr_key, exit_status, assignment.max_score)
    return run


def get_assignment_console_spec(assignment):
    context = _load_assignment_builder_context(assignment)
    if not context.get('available'):
        return {'available': False, 'reason': context.get('reason') or 'Interactive console is not available.'}

    family = context['family']
    tests_payload = context['tests_payload']
    suite_type = str(tests_payload.get('type') or '').upper()
    if family == 'python':
        if suite_type == 'IO':
            return {
                'available': True,
                'language': 'python',
                'suite_type': suite_type,
                'entry_label': 'main.py',
                'command_preview': 'python main.py',
                'supports_stdin': True,
                'reason': '',
            }
        if suite_type == 'OOP':
            entry_path = tests_payload.get('module_path') or 'main.py'
            return {
                'available': True,
                'language': 'python',
                'suite_type': suite_type,
                'entry_label': entry_path,
                'command_preview': f'python {entry_path}',
                'supports_stdin': True,
                'reason': '',
            }
        return {
            'available': False,
            'reason': 'Interactive console currently supports console-style builder suites, not file-based suites.',
        }

    if family == 'java':
        if suite_type == 'IO':
            main_class = str(tests_payload.get('main_class') or '').strip()
            if not main_class:
                return {
                    'available': False,
                    'reason': 'No Java main class is configured for interactive execution.',
                }
            return {
                'available': True,
                'language': 'java',
                'suite_type': suite_type,
                'entry_label': main_class,
                'command_preview': f'java {main_class}',
                'supports_stdin': True,
                'reason': '',
            }
        if suite_type != 'OOP':
            return {
                'available': False,
                'reason': 'Interactive console currently supports Java main-flow builder suites, not file-based suites.',
            }
        main_class = ''
        for case in tests_payload.get('main_tests', []):
            candidate = str(case.get('main_class') or '').strip()
            if candidate:
                main_class = candidate
                break
        if not main_class:
            return {
                'available': False,
                'reason': 'No Java main class is configured for interactive execution.',
            }
        return {
            'available': True,
            'language': 'java',
            'suite_type': suite_type,
            'entry_label': main_class,
            'command_preview': f'java {main_class}',
            'supports_stdin': True,
            'reason': '',
        }

    return {
        'available': False,
        'reason': 'Interactive console is not supported for this assignment.',
    }


def get_submission_console_spec(submission):
    return get_assignment_console_spec(submission.assignment)


def get_assignment_file_run_spec(assignment):
    context = _load_assignment_builder_context(assignment)
    if not context.get('available'):
        return {'available': False, 'reason': context.get('reason') or 'Try files is not available.'}

    family = context['family']
    tests_payload = context['tests_payload']
    storage = context['storage']
    test_version = context['test_version']
    suite_type = str(tests_payload.get('type') or '').upper()
    if suite_type != 'FILE_IO':
        return {
            'available': False,
            'reason': 'Try files is available only for builder-generated file-based suites.',
        }

    entry_label = tests_payload.get('entry_path') if family == 'python' else tests_payload.get('main_class')
    if not entry_label:
        return {
            'available': False,
            'reason': 'No executable entrypoint is configured for this file-based suite.',
        }

    defaults = _load_file_run_defaults(storage, test_version.bundle_key, tests_payload)
    args = defaults.get('args') or []
    command_preview = _build_command_preview(family, entry_label, args)
    return {
        'available': True,
        'language': family,
        'suite_type': suite_type,
        'entry_label': entry_label,
        'command_preview': command_preview,
        'supports_stdin': True,
        'default_case_name': defaults.get('case_name') or '',
        'default_args': args,
        'default_stdin': defaults.get('stdin') or '',
        'default_input_files': defaults.get('input_files') or [],
        'default_timeout_ms': defaults.get('timeout_ms') or tests_payload.get('timeout_ms') or 5000,
        'reason': '',
    }


def get_submission_file_run_spec(submission):
    return get_assignment_file_run_spec(submission.assignment)


def run_assignment_bundle_console(assignment, bundle_key, stdin_text='', timeout_seconds=5):
    spec = get_assignment_console_spec(assignment)
    if not spec.get('available'):
        raise ValueError(spec.get('reason') or 'Interactive console is not available for this submission.')
    context = _load_assignment_builder_context(assignment)
    if not context.get('available'):
        raise ValueError(context.get('reason') or 'Interactive console is not available for this submission.')

    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    with tempfile.TemporaryDirectory(prefix='submission_console_') as workspace:
        submission_dir = os.path.join(workspace, 'submission')
        os.makedirs(submission_dir, exist_ok=True)
        _prepare_submission(storage, bundle_key, submission_dir)
        _apply_builder_grading_files(
            storage,
            context['test_version'].bundle_key,
            context['tests_payload'],
            submission_dir,
        )

        if spec.get('language') == 'python':
            return _run_python_console_entry(
                submission_dir=submission_dir,
                entry_path=spec.get('entry_label') or 'main.py',
                stdin_text=stdin_text,
                timeout_seconds=timeout_seconds,
                command_preview=spec.get('command_preview') or 'python main.py',
            )

        if spec.get('language') == 'java':
            return _run_java_console_entry(
                submission_dir=submission_dir,
                workspace=workspace,
                main_class=spec.get('entry_label') or '',
                stdin_text=stdin_text,
                timeout_seconds=timeout_seconds,
                command_preview=spec.get('command_preview') or 'java Main',
            )

    raise ValueError('Interactive console is not supported for this submission.')


def run_submission_console(submission_id, stdin_text='', timeout_seconds=5):
    submission = (
        Submission.objects.select_related('assignment', 'assignment__language')
        .get(id=submission_id)
    )
    return run_assignment_bundle_console(
        assignment=submission.assignment,
        bundle_key=submission.source_bundle_key,
        stdin_text=stdin_text,
        timeout_seconds=timeout_seconds,
    )


def run_assignment_bundle_file_preview(assignment, bundle_key, args=None, input_files=None, stdin_text='', timeout_seconds=5):
    spec = get_assignment_file_run_spec(assignment)
    if not spec.get('available'):
        raise ValueError(spec.get('reason') or 'Try files is not available for this submission.')
    context = _load_assignment_builder_context(assignment)
    if not context.get('available'):
        raise ValueError(context.get('reason') or 'Try files is not available for this submission.')

    args = [str(value) for value in (args or [])]
    input_files = input_files or []
    command_preview = _build_command_preview(spec.get('language') or '', spec.get('entry_label') or '', args)

    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    with tempfile.TemporaryDirectory(prefix='submission_file_run_') as workspace:
        submission_dir = os.path.join(workspace, 'submission')
        os.makedirs(submission_dir, exist_ok=True)
        _prepare_submission(storage, bundle_key, submission_dir)
        _apply_builder_grading_files(
            storage,
            context['test_version'].bundle_key,
            context['tests_payload'],
            submission_dir,
        )

        _write_interactive_input_files(submission_dir, input_files)
        baseline = _snapshot_directory(submission_dir)

        if spec.get('language') == 'python':
            result = _run_python_file_entry(
                submission_dir=submission_dir,
                entry_path=spec.get('entry_label') or 'main.py',
                args=args,
                stdin_text=stdin_text,
                timeout_seconds=timeout_seconds,
                command_preview=command_preview,
            )
        elif spec.get('language') == 'java':
            result = _run_java_file_entry(
                submission_dir=submission_dir,
                workspace=workspace,
                main_class=spec.get('entry_label') or '',
                args=args,
                stdin_text=stdin_text,
                timeout_seconds=timeout_seconds,
                command_preview=command_preview,
            )
        else:
            raise ValueError('Try files is not supported for this submission.')

        result['produced_files'] = _collect_file_run_outputs(submission_dir, baseline)
        return result


def run_submission_file_preview(submission_id, args=None, input_files=None, stdin_text='', timeout_seconds=5):
    submission = (
        Submission.objects.select_related('assignment', 'assignment__language')
        .get(id=submission_id)
    )
    return run_assignment_bundle_file_preview(
        assignment=submission.assignment,
        bundle_key=submission.source_bundle_key,
        args=args,
        input_files=input_files,
        stdin_text=stdin_text,
        timeout_seconds=timeout_seconds,
    )


def _load_assignment_builder_context(assignment):
    language = assignment.language
    family = _language_family(language)
    if not family:
        return {
            'available': False,
            'reason': 'Interactive execution is only available for Python and Java assignments.',
        }

    test_suite = TestSuite.objects.filter(assignment=assignment).select_related('active_version').first()
    test_version = test_suite.active_version if test_suite else None
    if not test_version:
        return {
            'available': False,
            'reason': 'No active test suite is available for this assignment.',
        }
    if test_version.execution_mode != TestSuiteExecutionMode.PYTHON_RUNNER:
        return {
            'available': False,
            'reason': 'Interactive execution is available only for builder-generated suites.',
        }

    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    try:
        tests_payload = _load_builder_tests_payload(storage, test_version.bundle_key)
    except Exception as exc:  # noqa: BLE001
        return {
            'available': False,
            'reason': f'Unable to inspect the active test suite: {exc}',
        }

    return {
        'available': True,
        'family': family,
        'storage': storage,
        'test_version': test_version,
        'tests_payload': tests_payload,
    }


def _load_submission_builder_context(submission):
    return _load_assignment_builder_context(submission.assignment)


def _load_file_run_defaults(storage, bundle_key, tests_payload):
    defaults = {
        'case_name': '',
        'args': [],
        'stdin': '',
        'input_files': [],
        'timeout_ms': tests_payload.get('timeout_ms') or 5000,
    }
    first_case = next(iter(tests_payload.get('cases') or []), None)
    if not first_case:
        return defaults

    defaults['case_name'] = first_case.get('name') or ''
    defaults['args'] = [str(value) for value in (first_case.get('args') or [])]
    defaults['stdin'] = first_case.get('stdin') or ''
    defaults['timeout_ms'] = first_case.get('timeout_ms') or defaults['timeout_ms']

    source_path = storage.path(bundle_key)
    if not zipfile.is_zipfile(source_path):
        return defaults

    with zipfile.ZipFile(source_path, 'r') as zip_ref:
        for fixture in first_case.get('input_files') or []:
            source_name = str(fixture.get('source') or '').strip()
            if not source_name:
                continue
            try:
                raw_content = zip_ref.read(source_name)
            except KeyError:
                continue
            defaults['input_files'].append(
                {
                    'path': fixture.get('path') or '',
                    'content': raw_content.decode('utf-8', errors='replace'),
                }
            )
    return defaults


def _resolve_run_command(language, test_version, submission_dir, tests_dir, workspace):
    if test_version and test_version.execution_mode == TestSuiteExecutionMode.PYTHON_RUNNER:
        candidate_py = os.path.join(tests_dir, 'run_tests.py')
        if os.path.exists(candidate_py):
            return ' '.join(
                [
                    shlex.quote(sys.executable),
                    shlex.quote(candidate_py),
                    shlex.quote(submission_dir),
                    shlex.quote(workspace),
                ]
            )

    if language and language.run_cmd_template:
        return language.run_cmd_template.format(
            submission_dir=submission_dir,
            tests_dir=tests_dir,
            workspace=workspace,
        )

    candidate_sh = os.path.join(tests_dir, 'run_tests.sh')
    if os.path.exists(candidate_sh):
        return f"bash {shlex.quote(candidate_sh)}"
    return None


def _prepare_submission(storage, bundle_key, destination):
    source_path = storage.path(bundle_key)
    if zipfile.is_zipfile(source_path):
        with zipfile.ZipFile(source_path, 'r') as zip_ref:
            zip_ref.extractall(destination)
    else:
        filename = os.path.basename(source_path)
        shutil.copy2(source_path, os.path.join(destination, filename))


def _prepare_tests(storage, bundle_key, destination):
    source_path = storage.path(bundle_key)
    with zipfile.ZipFile(source_path, 'r') as zip_ref:
        zip_ref.extractall(destination)


def _load_builder_tests_payload(storage, bundle_key):
    source_path = storage.path(bundle_key)
    if not zipfile.is_zipfile(source_path):
        raise ValueError('Active suite bundle is not a zip archive.')
    with zipfile.ZipFile(source_path, 'r') as zip_ref:
        try:
            raw_payload = zip_ref.read('tests.json')
        except KeyError as exc:
            raise ValueError('tests.json not found in active suite bundle.') from exc
    return json.loads(raw_payload.decode('utf-8'))


def _language_family(language):
    lowered = f'{getattr(language, "name", "")} {getattr(language, "slug", "")}'.lower()
    if 'python' in lowered:
        return 'python'
    if 'java' in lowered:
        return 'java'
    return ''


def _truncate_console_output(text):
    encoded = (text or '').encode('utf-8', errors='replace')
    truncated = len(encoded) > MAX_CONSOLE_PREVIEW_BYTES
    if truncated:
        encoded = encoded[:MAX_CONSOLE_PREVIEW_BYTES]
    return encoded.decode('utf-8', errors='replace'), truncated


def _run_python_console_entry(submission_dir, entry_path, stdin_text, timeout_seconds, command_preview):
    target_script = os.path.join(submission_dir, entry_path)
    if not os.path.exists(target_script):
        return {
            'entry_label': entry_path,
            'command_preview': command_preview,
            'stdout': '',
            'stderr': f'{entry_path} not found in submission.',
            'stdout_truncated': False,
            'stderr_truncated': False,
            'exit_status': GradingExitStatus.RUNTIME_ERROR,
            'returncode': 1,
            'duration_ms': 0,
        }

    start = time.monotonic()
    try:
        completed = subprocess.run(
            [sys.executable, target_script],
            cwd=submission_dir,
            input=stdin_text,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
        )
        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_text, stdout_truncated = _truncate_console_output(completed.stdout or '')
        stderr_text, stderr_truncated = _truncate_console_output(completed.stderr or '')
        return {
            'entry_label': entry_path,
            'command_preview': command_preview,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'stdout_truncated': stdout_truncated,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.OK if completed.returncode == 0 else GradingExitStatus.RUNTIME_ERROR,
            'returncode': completed.returncode,
            'duration_ms': duration_ms,
        }
    except subprocess.TimeoutExpired as exc:
        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_text, stdout_truncated = _truncate_console_output(exc.stdout or '')
        stderr_text, stderr_truncated = _truncate_console_output(exc.stderr or 'Execution timed out.')
        return {
            'entry_label': entry_path,
            'command_preview': command_preview,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'stdout_truncated': stdout_truncated,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.TIMEOUT,
            'returncode': -1,
            'duration_ms': duration_ms,
        }


def _run_java_console_entry(submission_dir, workspace, main_class, stdin_text, timeout_seconds, command_preview):
    java_files = [str(path) for path in Path(submission_dir).rglob('*.java')]
    if not java_files:
        return {
            'entry_label': main_class,
            'command_preview': command_preview,
            'stdout': '',
            'stderr': 'No .java files found in submission.',
            'stdout_truncated': False,
            'stderr_truncated': False,
            'exit_status': GradingExitStatus.RUNTIME_ERROR,
            'returncode': 1,
            'duration_ms': 0,
        }

    classes_dir = os.path.join(workspace, '.console-classes')
    os.makedirs(classes_dir, exist_ok=True)

    compile_start = time.monotonic()
    compile_proc = subprocess.run(
        ['javac', '-d', classes_dir, *java_files],
        cwd=submission_dir,
        text=True,
        capture_output=True,
    )
    if compile_proc.returncode != 0:
        duration_ms = int((time.monotonic() - compile_start) * 1000)
        stderr_text, stderr_truncated = _truncate_console_output(
            compile_proc.stderr or compile_proc.stdout or 'Compilation failed.',
        )
        return {
            'entry_label': main_class,
            'command_preview': command_preview,
            'stdout': '',
            'stderr': stderr_text,
            'stdout_truncated': False,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.RUNTIME_ERROR,
            'returncode': compile_proc.returncode,
            'duration_ms': duration_ms,
        }

    start = time.monotonic()
    try:
        completed = subprocess.run(
            ['java', '-cp', classes_dir, main_class],
            cwd=submission_dir,
            input=stdin_text,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
        )
        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_text, stdout_truncated = _truncate_console_output(completed.stdout or '')
        stderr_text, stderr_truncated = _truncate_console_output(completed.stderr or '')
        return {
            'entry_label': main_class,
            'command_preview': command_preview,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'stdout_truncated': stdout_truncated,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.OK if completed.returncode == 0 else GradingExitStatus.RUNTIME_ERROR,
            'returncode': completed.returncode,
            'duration_ms': duration_ms,
        }
    except subprocess.TimeoutExpired as exc:
        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_text, stdout_truncated = _truncate_console_output(exc.stdout or '')
        stderr_text, stderr_truncated = _truncate_console_output(exc.stderr or 'Execution timed out.')
        return {
            'entry_label': main_class,
            'command_preview': command_preview,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'stdout_truncated': stdout_truncated,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.TIMEOUT,
            'returncode': -1,
            'duration_ms': duration_ms,
        }


def _build_command_preview(language, entry_label, args):
    base = 'python' if language == 'python' else 'java'
    parts = [base, entry_label, *list(args or [])]
    return ' '.join(shlex.quote(str(part)) for part in parts if str(part))


def _safe_interactive_relative_path(path):
    normalized = str(path or '').replace('\\', '/').strip()
    if not normalized or normalized.startswith('/'):
        return ''
    parts = [part for part in normalized.split('/') if part not in {'', '.'}]
    if not parts or any(part == '..' for part in parts):
        return ''
    return '/'.join(parts)


def _write_interactive_input_files(submission_dir, input_files):
    for entry in input_files or []:
        relative_path = _safe_interactive_relative_path(entry.get('path'))
        if not relative_path:
            raise ValueError('Input files must use safe relative paths.')
        target = os.path.join(submission_dir, relative_path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, 'w', encoding='utf-8') as handle:
            handle.write(entry.get('content') or '')


def _apply_builder_grading_files(storage, bundle_key, tests_payload, destination):
    grading_files = tests_payload.get('grading_files') or []
    if not grading_files:
        return

    source_path = storage.path(bundle_key)
    if not zipfile.is_zipfile(source_path):
        return

    with zipfile.ZipFile(source_path, 'r') as zip_ref:
        for entry in grading_files:
            relative_path = _safe_interactive_relative_path(entry.get('path'))
            source_name = str(entry.get('source') or '').strip()
            if not relative_path or not source_name:
                continue
            target = os.path.join(destination, relative_path)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            try:
                raw_content = zip_ref.read(source_name)
            except KeyError:
                continue
            with open(target, 'wb') as handle:
                handle.write(raw_content)


def _snapshot_directory(base_dir):
    snapshot = {}
    for root, dir_names, file_names in os.walk(base_dir):
        dir_names[:] = [name for name in dir_names if name not in {'__pycache__', '.classes'}]
        for file_name in file_names:
            if file_name.endswith('.pyc'):
                continue
            absolute = os.path.join(root, file_name)
            relative = os.path.relpath(absolute, base_dir).replace('\\', '/')
            digest = hashlib.sha256()
            with open(absolute, 'rb') as handle:
                for chunk in iter(lambda: handle.read(64 * 1024), b''):
                    digest.update(chunk)
            snapshot[relative] = {
                'size': os.path.getsize(absolute),
                'digest': digest.hexdigest(),
            }
    return snapshot


def _collect_file_run_outputs(base_dir, baseline):
    changed = []
    for root, dir_names, file_names in os.walk(base_dir):
        dir_names[:] = [name for name in dir_names if name not in {'__pycache__', '.classes'}]
        for file_name in file_names:
            if file_name.endswith('.pyc'):
                continue
            absolute = os.path.join(root, file_name)
            relative = os.path.relpath(absolute, base_dir).replace('\\', '/')
            digest = hashlib.sha256()
            with open(absolute, 'rb') as handle:
                for chunk in iter(lambda: handle.read(64 * 1024), b''):
                    digest.update(chunk)
            current = {
                'size': os.path.getsize(absolute),
                'digest': digest.hexdigest(),
            }
            previous = baseline.get(relative)
            if previous == current:
                continue
            changed.append(_preview_generated_file(absolute, relative, 'modified' if previous else 'new'))

    changed.sort(key=lambda entry: entry.get('name') or '')
    truncated = len(changed) > MAX_FILE_RUN_PREVIEW_FILES
    files = changed[:MAX_FILE_RUN_PREVIEW_FILES]
    for entry in files:
        entry['list_truncated'] = truncated
    return files


def _preview_generated_file(absolute_path, relative_path, kind):
    read_limit = MAX_CONSOLE_PREVIEW_BYTES + 1
    with open(absolute_path, 'rb') as handle:
        raw_content = handle.read(read_limit)

    truncated = len(raw_content) > MAX_CONSOLE_PREVIEW_BYTES
    if truncated:
        raw_content = raw_content[:MAX_CONSOLE_PREVIEW_BYTES]

    mime_type = mimetypes.guess_type(relative_path)[0] or 'application/octet-stream'
    is_text = mime_type.startswith('text/')
    if not is_text:
        text_extensions = {
            '.py', '.json', '.md', '.txt', '.yaml', '.yml', '.xml', '.csv',
            '.java', '.js', '.ts', '.jsx', '.tsx', '.c', '.cpp', '.h', '.hpp',
            '.cs', '.go', '.rs', '.kt', '.swift', '.sh', '.sql',
        }
        ext = os.path.splitext(relative_path)[1].lower()
        is_text = ext in text_extensions and b'\x00' not in raw_content

    if is_text:
        content = raw_content.decode('utf-8', errors='replace')
        encoding = 'utf-8'
    else:
        content = base64.b64encode(raw_content).decode('ascii')
        encoding = 'base64'

    return {
        'name': relative_path,
        'kind': kind,
        'size': os.path.getsize(absolute_path),
        'truncated': truncated,
        'mime_type': mime_type,
        'encoding': encoding,
        'is_text': is_text,
        'content': content,
    }


def _run_python_file_entry(submission_dir, entry_path, args, stdin_text, timeout_seconds, command_preview):
    target_script = os.path.join(submission_dir, entry_path)
    if not os.path.exists(target_script):
        return {
            'entry_label': entry_path,
            'command_preview': command_preview,
            'stdout': '',
            'stderr': f'{entry_path} not found in submission.',
            'stdout_truncated': False,
            'stderr_truncated': False,
            'exit_status': GradingExitStatus.RUNTIME_ERROR,
            'returncode': 1,
            'duration_ms': 0,
        }

    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
    start = time.monotonic()
    try:
        completed = subprocess.run(
            [sys.executable, target_script, *list(args or [])],
            cwd=submission_dir,
            input=stdin_text,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            env=env,
        )
        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_text, stdout_truncated = _truncate_console_output(completed.stdout or '')
        stderr_text, stderr_truncated = _truncate_console_output(completed.stderr or '')
        return {
            'entry_label': entry_path,
            'command_preview': command_preview,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'stdout_truncated': stdout_truncated,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.OK if completed.returncode == 0 else GradingExitStatus.RUNTIME_ERROR,
            'returncode': completed.returncode,
            'duration_ms': duration_ms,
        }
    except subprocess.TimeoutExpired as exc:
        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_text, stdout_truncated = _truncate_console_output(exc.stdout or '')
        stderr_text, stderr_truncated = _truncate_console_output(exc.stderr or 'Execution timed out.')
        return {
            'entry_label': entry_path,
            'command_preview': command_preview,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'stdout_truncated': stdout_truncated,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.TIMEOUT,
            'returncode': -1,
            'duration_ms': duration_ms,
        }


def _collect_java_sources_recursive(submission_dir):
    sources = []
    for root, _dir_names, file_names in os.walk(submission_dir):
        for file_name in file_names:
            if file_name.endswith('.java'):
                sources.append(os.path.join(root, file_name))
    return sorted(sources)


def _run_java_file_entry(submission_dir, workspace, main_class, args, stdin_text, timeout_seconds, command_preview):
    java_files = _collect_java_sources_recursive(submission_dir)
    if not java_files:
        return {
            'entry_label': main_class,
            'command_preview': command_preview,
            'stdout': '',
            'stderr': 'No .java files found in submission.',
            'stdout_truncated': False,
            'stderr_truncated': False,
            'exit_status': GradingExitStatus.RUNTIME_ERROR,
            'returncode': 1,
            'duration_ms': 0,
        }

    classes_dir = os.path.join(workspace, '.console-classes')
    os.makedirs(classes_dir, exist_ok=True)

    compile_start = time.monotonic()
    compile_proc = subprocess.run(
        ['javac', '-d', classes_dir, *java_files],
        cwd=submission_dir,
        text=True,
        capture_output=True,
    )
    if compile_proc.returncode != 0:
        duration_ms = int((time.monotonic() - compile_start) * 1000)
        stderr_text, stderr_truncated = _truncate_console_output(
            compile_proc.stderr or compile_proc.stdout or 'Compilation failed.',
        )
        return {
            'entry_label': main_class,
            'command_preview': command_preview,
            'stdout': '',
            'stderr': stderr_text,
            'stdout_truncated': False,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.RUNTIME_ERROR,
            'returncode': compile_proc.returncode,
            'duration_ms': duration_ms,
        }

    start = time.monotonic()
    try:
        completed = subprocess.run(
            ['java', '-cp', classes_dir, main_class, *list(args or [])],
            cwd=submission_dir,
            input=stdin_text,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
        )
        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_text, stdout_truncated = _truncate_console_output(completed.stdout or '')
        stderr_text, stderr_truncated = _truncate_console_output(completed.stderr or '')
        return {
            'entry_label': main_class,
            'command_preview': command_preview,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'stdout_truncated': stdout_truncated,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.OK if completed.returncode == 0 else GradingExitStatus.RUNTIME_ERROR,
            'returncode': completed.returncode,
            'duration_ms': duration_ms,
        }
    except subprocess.TimeoutExpired as exc:
        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_text, stdout_truncated = _truncate_console_output(exc.stdout or '')
        stderr_text, stderr_truncated = _truncate_console_output(exc.stderr or 'Execution timed out.')
        return {
            'entry_label': main_class,
            'command_preview': command_preview,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'stdout_truncated': stdout_truncated,
            'stderr_truncated': stderr_truncated,
            'exit_status': GradingExitStatus.TIMEOUT,
            'returncode': -1,
            'duration_ms': duration_ms,
        }


def _run_command(command, cwd, env, timeout_seconds):
    import subprocess

    start = time.monotonic()
    try:
        completed = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        duration = time.monotonic() - start
        status = GradingExitStatus.OK if completed.returncode == 0 else GradingExitStatus.RUNTIME_ERROR
        stdout_text = completed.stdout or ''
        stderr_text = completed.stderr or ''
        if status != GradingExitStatus.OK and not stdout_text.strip() and not stderr_text.strip():
            stderr_text = f'Command exited with return code {completed.returncode} and no output.'
        return {
            'status': status,
            'returncode': completed.returncode,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'duration': duration,
        }
    except subprocess.TimeoutExpired as exc:
        duration = time.monotonic() - start
        stdout_text = exc.stdout or ''
        stderr_text = exc.stderr or 'Execution timed out.'
        if isinstance(stdout_text, bytes):
            stdout_text = stdout_text.decode('utf-8', errors='replace')
        if isinstance(stderr_text, bytes):
            stderr_text = stderr_text.decode('utf-8', errors='replace')
        return {
            'status': GradingExitStatus.TIMEOUT,
            'returncode': -1,
            'stdout': stdout_text,
            'stderr': stderr_text,
            'duration': duration,
        }


def _load_results(workspace):
    candidates = [
        os.path.join(workspace, RESULTS_FILENAME),
        os.path.join(workspace, 'tests', RESULTS_FILENAME),
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as handle:
                    return json.load(handle)
            except (OSError, json.JSONDecodeError):
                return {}
    return {}


def _combine_output(compile_output, test_output, key):
    parts = []
    if compile_output:
        content = (compile_output.get(key, '') or '').strip()
        if content:
            parts.append(f"[compile]\n{content}")
    if test_output:
        content = (test_output.get(key, '') or '').strip()
        if content:
            parts.append(f"[tests]\n{content}")
    return "\n\n".join([part for part in parts if part]).strip()


def _store_logs(storage, submission_id, run_id, stdout_text, stderr_text):
    stdout_key = ''
    stderr_key = ''
    if stdout_text:
        stdout_key = os.path.join('grading_runs', str(submission_id), str(run_id), 'stdout.txt')
        storage.save(stdout_key, _to_file(stdout_text))
    if stderr_text:
        stderr_key = os.path.join('grading_runs', str(submission_id), str(run_id), 'stderr.txt')
        storage.save(stderr_key, _to_file(stderr_text))
    return stdout_key, stderr_key


def _to_file(text):
    from django.core.files.base import ContentFile

    return ContentFile(text.encode('utf-8'))


def _persist_results(run, submission, results_payload, stdout_key, stderr_key, exit_status, max_score):
    tests = results_payload.get('tests') if isinstance(results_payload, dict) else None
    test_results = tests if isinstance(tests, list) else []

    all_tests_passed = exit_status == GradingExitStatus.OK

    with transaction.atomic():
        run.finished_at = timezone.now()
        run.exit_status = exit_status
        run.stdout_key = stdout_key or ''
        run.stderr_key = stderr_key or ''
        run.result_json = results_payload if isinstance(results_payload, dict) else {}
        run.save(update_fields=['finished_at', 'exit_status', 'stdout_key', 'stderr_key', 'result_json'])

        TestResult.objects.filter(grading_run=run).delete()
        if test_results:
            for entry in test_results:
                name = entry.get('name') or 'test'
                status = (entry.get('status') or '').upper()
                status = status if status in TestResultStatus.values else TestResultStatus.FAIL
                points = Decimal(str(entry.get('points', 0)))
                if status != TestResultStatus.PASS:
                    all_tests_passed = False
                TestResult.objects.create(
                    grading_run=run,
                    test_name=name,
                    status=status,
                    points_awarded=points,
                    time_ms=entry.get('time_ms'),
                    message=entry.get('message', ''),
                )
        else:
            if exit_status == GradingExitStatus.OK:
                TestResult.objects.create(
                    grading_run=run,
                    test_name='all',
                    status=TestResultStatus.PASS,
                    points_awarded=Decimal('0'),
                    time_ms=None,
                    message='No test breakdown available.',
                )
            else:
                all_tests_passed = False
                TestResult.objects.create(
                    grading_run=run,
                    test_name='run',
                    status=TestResultStatus.FAIL,
                    points_awarded=Decimal('0'),
                    time_ms=None,
                    message='Tests failed to run.',
                )

        # Test execution is pass/fail verification only. Preserve any manual grade
        # already attached to the submission, but do not auto-create or overwrite one.
        grade = Grade.objects.filter(submission=submission).first()
        if grade:
            grade.latest_grading_run = run
            grade.save(update_fields=['latest_grading_run'])

        submission.status = SubmissionStatus.GRADED if all_tests_passed else SubmissionStatus.FAILED
        submission.save(update_fields=['status'])
