import json
import os
import shutil
import tempfile
import time
import zipfile
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
    TestSuite,
    TestSuiteVisibility,
)


RESULTS_FILENAME = 'results.json'


def grade_submission(submission_id, timeout_seconds=30):
    submission = (
        Submission.objects.select_related('assignment', 'assignment__language')
        .get(id=submission_id)
    )
    assignment = submission.assignment
    language = assignment.language

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
            worker_id='local-runner',
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
            if language and language.compile_cmd:
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
                run_cmd = None
                if language and language.run_cmd_template:
                    run_cmd = language.run_cmd_template.format(
                        submission_dir=submission_dir,
                        tests_dir=tests_dir,
                        workspace=workspace,
                    )
                else:
                    candidate = os.path.join(tests_dir, 'run_tests.sh')
                    if os.path.exists(candidate):
                        run_cmd = f"bash {candidate}"

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
        return

    _persist_results(run, submission, results_payload, stdout_key, stderr_key, exit_status, assignment.max_score)


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
        return {
            'status': status,
            'returncode': completed.returncode,
            'stdout': completed.stdout or '',
            'stderr': completed.stderr or '',
            'duration': duration,
        }
    except subprocess.TimeoutExpired as exc:
        duration = time.monotonic() - start
        return {
            'status': GradingExitStatus.TIMEOUT,
            'returncode': -1,
            'stdout': exc.stdout or '',
            'stderr': exc.stderr or 'Execution timed out.',
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
        parts.append(f"[compile]\n{compile_output.get(key, '')}".strip())
    if test_output:
        parts.append(f"[tests]\n{test_output.get(key, '')}".strip())
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

    total_score = Decimal('0')
    total_max = Decimal('0')

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
                max_points = Decimal(str(entry.get('max_points', points)))
                total_score += points
                total_max += max_points
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
                total_score = Decimal(str(max_score))
                total_max = Decimal(str(max_score))
                TestResult.objects.create(
                    grading_run=run,
                    test_name='all',
                    status=TestResultStatus.PASS,
                    points_awarded=total_score,
                    time_ms=None,
                    message='No test breakdown available.',
                )
            else:
                total_score = Decimal('0')
                total_max = Decimal(str(max_score))
                TestResult.objects.create(
                    grading_run=run,
                    test_name='run',
                    status=TestResultStatus.FAIL,
                    points_awarded=total_score,
                    time_ms=None,
                    message='Tests failed to run.',
                )

        grade, _ = Grade.objects.get_or_create(submission=submission)
        grade.latest_grading_run = run
        grade.score = total_score
        grade.max_score = total_max or Decimal(str(max_score))
        grade.save(update_fields=['latest_grading_run', 'score', 'max_score'])

        submission.status = SubmissionStatus.GRADED if exit_status == GradingExitStatus.OK else SubmissionStatus.FAILED
        submission.save(update_fields=['status'])
