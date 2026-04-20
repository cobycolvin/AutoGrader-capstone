from collections import Counter

from django.db import transaction
from django.utils import timezone

from ..models import (
    ClassExecutionItem,
    ClassExecutionItemStatus,
    ClassExecutionOutcome,
    ClassExecutionRun,
    ClassExecutionRunStatus,
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    GradingExitStatus,
    Submission,
    SubmissionStatus,
    TestSuite,
    TestResultStatus,
)


ACTIVE_CLASS_RUN_STATUSES = {
    ClassExecutionRunStatus.QUEUED,
    ClassExecutionRunStatus.RUNNING,
}

PROCESS_FAILURE_KINDS = {
    'TIMEOUT',
    'COMPILE_ERROR',
    'RUNTIME_ERROR',
    'MISSING_ENTRYPOINT',
    'MISSING_SOURCE_FILES',
    'EXECUTION_TOOL_MISSING',
    'UNSUPPORTED_LANGUAGE',
}


def _latest_submissions_by_student(assignment, student_ids):
    latest = {}
    queryset = (
        Submission.objects.filter(assignment=assignment, submitted_by_id__in=student_ids)
        .select_related('submitted_by')
        .order_by('submitted_by_id', '-attempt_number', '-submitted_at')
    )
    for submission in queryset:
        latest.setdefault(submission.submitted_by_id, submission)
    return latest


def _selected_test_suite_version(assignment, test_suite_version=None):
    if test_suite_version:
        return test_suite_version
    test_suite = (
        TestSuite.objects.filter(assignment=assignment)
        .select_related('active_version')
        .first()
    )
    return test_suite.active_version if test_suite else None


def create_class_execution_run(assignment, triggered_by, test_suite_version=None):
    if ClassExecutionRun.objects.filter(
        assignment=assignment,
        status__in=ACTIVE_CLASS_RUN_STATUSES,
    ).exists():
        raise ValueError('A class execution run is already in progress for this assignment.')

    selected_version = _selected_test_suite_version(assignment, test_suite_version)
    if not selected_version:
        raise ValueError('An active test suite is required before running the class execution.')

    enrollments = list(
        Enrollment.objects.filter(
            course=assignment.course,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        ).select_related('user')
    )
    if not enrollments:
        raise ValueError('No active students are enrolled in this course.')

    student_ids = [enrollment.user_id for enrollment in enrollments]
    latest_submissions = _latest_submissions_by_student(assignment, student_ids)
    if not latest_submissions:
        raise ValueError('No student submissions are available for this assignment yet.')
    if any(
        submission.status in {SubmissionStatus.QUEUED, SubmissionStatus.RUNNING}
        for submission in latest_submissions.values()
    ):
        raise ValueError('Wait for queued or running submissions to finish before starting a class execution run.')

    total_students = len(enrollments)
    total_submissions = len(latest_submissions)
    missing_submissions = max(total_students - total_submissions, 0)

    with transaction.atomic():
        run = ClassExecutionRun.objects.create(
            assignment=assignment,
            test_suite_version=selected_version,
            triggered_by=triggered_by,
            created_by=triggered_by,
            status=ClassExecutionRunStatus.QUEUED,
            total_students=total_students,
            total_submissions=total_submissions,
            missing_submissions=missing_submissions,
        )
        ClassExecutionItem.objects.bulk_create(
            [
                ClassExecutionItem(
                    class_execution_run=run,
                    submission=submission,
                    student=submission.submitted_by,
                    created_by=triggered_by,
                )
                for submission in latest_submissions.values()
            ]
        )
    return run


def summarize_grading_run(grading_run):
    result_json = grading_run.result_json if isinstance(grading_run.result_json, dict) else {}
    tests = result_json.get('tests') if isinstance(result_json.get('tests'), list) else []
    total_tests = len(tests)
    passed_tests = 0
    summaries = []
    outcome = ClassExecutionOutcome.PASS

    if grading_run.exit_status != GradingExitStatus.OK:
        outcome = ClassExecutionOutcome.INCOMPLETE

    for entry in tests:
        status = (entry.get('status') or '').upper()
        if status == TestResultStatus.PASS:
            passed_tests += 1
        else:
            failure_kind = (entry.get('failure_kind') or '').upper()
            if failure_kind in PROCESS_FAILURE_KINDS or grading_run.exit_status != GradingExitStatus.OK:
                outcome = ClassExecutionOutcome.INCOMPLETE
            elif outcome != ClassExecutionOutcome.INCOMPLETE:
                outcome = ClassExecutionOutcome.FAIL

        summary = entry.get('summary') or entry.get('message') or ''
        if summary:
            summaries.append(summary)

    if total_tests == 0 and grading_run.exit_status != GradingExitStatus.OK:
        return {
            'outcome': ClassExecutionOutcome.INCOMPLETE,
            'passed_tests': 0,
            'total_tests': 0,
            'summary': grading_run.exit_status.replace('_', ' ').title(),
        }

    if total_tests and passed_tests == total_tests and grading_run.exit_status == GradingExitStatus.OK:
        summary = f'All {total_tests} checks passed.'
        outcome = ClassExecutionOutcome.PASS
    else:
        summary = summaries[0] if summaries else ('Checks did not complete.' if outcome == ClassExecutionOutcome.INCOMPLETE else 'Some checks failed.')

    return {
        'outcome': outcome,
        'passed_tests': passed_tests,
        'total_tests': total_tests,
        'summary': summary,
    }


def refresh_class_execution_run(run):
    if not isinstance(run, ClassExecutionRun):
        run = ClassExecutionRun.objects.get(id=run)

    items = list(run.items.all())
    status_counts = Counter(item.status for item in items)
    started_at = min((item.started_at for item in items if item.started_at), default=run.started_at)

    if status_counts[ClassExecutionItemStatus.RUNNING] or (
        status_counts[ClassExecutionItemStatus.QUEUED]
        and (status_counts[ClassExecutionItemStatus.COMPLETED] or status_counts[ClassExecutionItemStatus.FAILED])
    ):
        status_value = ClassExecutionRunStatus.RUNNING
    elif status_counts[ClassExecutionItemStatus.QUEUED]:
        status_value = ClassExecutionRunStatus.QUEUED
    else:
        status_value = ClassExecutionRunStatus.COMPLETED

    finished_at = run.finished_at
    if status_value == ClassExecutionRunStatus.COMPLETED:
        finished_at = max((item.finished_at for item in items if item.finished_at), default=run.finished_at or timezone.now())
    else:
        finished_at = None

    update_fields = []
    if run.status != status_value:
        run.status = status_value
        update_fields.append('status')
    if run.started_at != started_at:
        run.started_at = started_at
        update_fields.append('started_at')
    if run.finished_at != finished_at:
        run.finished_at = finished_at
        update_fields.append('finished_at')

    if update_fields:
        run.save(update_fields=update_fields)
    return run


def start_class_execution_item(item):
    if not isinstance(item, ClassExecutionItem):
        item = ClassExecutionItem.objects.select_related('class_execution_run').get(id=item)

    now = timezone.now()
    item.status = ClassExecutionItemStatus.RUNNING
    item.started_at = now
    item.save(update_fields=['status', 'started_at'])

    submission = item.submission
    if submission.status != SubmissionStatus.RUNNING:
        submission.status = SubmissionStatus.RUNNING
        submission.save(update_fields=['status'])

    run = item.class_execution_run
    if run.status != ClassExecutionRunStatus.RUNNING:
        run.status = ClassExecutionRunStatus.RUNNING
        if not run.started_at:
            run.started_at = now
            run.save(update_fields=['status', 'started_at'])
        else:
            run.save(update_fields=['status'])
    return item


def complete_class_execution_item(item, grading_run):
    if not isinstance(item, ClassExecutionItem):
        item = ClassExecutionItem.objects.select_related('class_execution_run').get(id=item)

    summary = summarize_grading_run(grading_run)
    item.grading_run = grading_run
    item.status = ClassExecutionItemStatus.COMPLETED
    item.outcome = summary['outcome']
    item.passed_tests = summary['passed_tests']
    item.total_tests = summary['total_tests']
    item.summary = summary['summary'][:255]
    item.finished_at = timezone.now()
    item.save(
        update_fields=[
            'grading_run',
            'status',
            'outcome',
            'passed_tests',
            'total_tests',
            'summary',
            'finished_at',
        ]
    )
    refresh_class_execution_run(item.class_execution_run)
    return item


def fail_class_execution_item(item, summary='Execution failed before results were recorded.'):
    if not isinstance(item, ClassExecutionItem):
        item = ClassExecutionItem.objects.select_related('class_execution_run').get(id=item)

    item.status = ClassExecutionItemStatus.FAILED
    item.outcome = ClassExecutionOutcome.INCOMPLETE
    item.summary = (summary or 'Execution failed before results were recorded.')[:255]
    item.finished_at = timezone.now()
    item.save(update_fields=['status', 'outcome', 'summary', 'finished_at'])
    refresh_class_execution_run(item.class_execution_run)
    return item


def build_class_execution_run_summary(run, items=None):
    if not isinstance(run, ClassExecutionRun):
        run = ClassExecutionRun.objects.select_related('test_suite_version').get(id=run)
    if items is None:
        items = list(run.items.all())

    status_counts = Counter(item.status for item in items)
    outcome_counts = Counter(item.outcome for item in items if item.outcome)

    return {
        'id': str(run.id),
        'status': run.status,
        'created_at': run.created_at,
        'started_at': run.started_at,
        'finished_at': run.finished_at,
        'total_students': run.total_students,
        'total_submissions': run.total_submissions,
        'missing_submissions': run.missing_submissions,
        'queued_items': status_counts.get(ClassExecutionItemStatus.QUEUED, 0),
        'running_items': status_counts.get(ClassExecutionItemStatus.RUNNING, 0),
        'completed_items': status_counts.get(ClassExecutionItemStatus.COMPLETED, 0),
        'failed_items': status_counts.get(ClassExecutionItemStatus.FAILED, 0),
        'pass_count': outcome_counts.get(ClassExecutionOutcome.PASS, 0),
        'fail_count': outcome_counts.get(ClassExecutionOutcome.FAIL, 0),
        'incomplete_count': outcome_counts.get(ClassExecutionOutcome.INCOMPLETE, 0),
        'test_suite_version': {
            'id': str(run.test_suite_version_id) if run.test_suite_version_id else '',
            'version_number': getattr(run.test_suite_version, 'version_number', None),
            'visibility': getattr(run.test_suite_version, 'visibility', ''),
        },
        'triggered_by': getattr(run.triggered_by, 'username', '') if run.triggered_by else '',
    }


def build_class_execution_run_payload(run):
    run = (
        ClassExecutionRun.objects.select_related('test_suite_version', 'triggered_by')
        .prefetch_related(
            'items__student',
            'items__submission',
            'items__grading_run',
        )
        .get(id=run.id if isinstance(run, ClassExecutionRun) else run)
    )
    run = refresh_class_execution_run(run)
    items = list(
        run.items.select_related('student', 'submission', 'grading_run')
        .order_by('student__username', 'created_at')
    )

    test_stats = {}
    for item in items:
        grading_run = item.grading_run
        if not grading_run or not isinstance(grading_run.result_json, dict):
            continue
        tests = grading_run.result_json.get('tests') or []
        for entry in tests:
            name = entry.get('name') or 'Check'
            bucket = test_stats.setdefault(
                name,
                {
                    'name': name,
                    'pass_count': 0,
                    'fail_count': 0,
                    'incomplete_count': 0,
                    'observed_count': 0,
                    'total_time_ms': 0,
                },
            )
            status = (entry.get('status') or '').upper()
            failure_kind = (entry.get('failure_kind') or '').upper()
            if status == TestResultStatus.PASS:
                bucket['pass_count'] += 1
            elif failure_kind in PROCESS_FAILURE_KINDS:
                bucket['incomplete_count'] += 1
            else:
                bucket['fail_count'] += 1
            if entry.get('time_ms') is not None:
                bucket['observed_count'] += 1
                bucket['total_time_ms'] += int(entry.get('time_ms') or 0)

    tests_payload = []
    for name in sorted(test_stats.keys()):
        bucket = test_stats[name]
        total = bucket['pass_count'] + bucket['fail_count'] + bucket['incomplete_count']
        tests_payload.append(
            {
                'name': name,
                'pass_count': bucket['pass_count'],
                'fail_count': bucket['fail_count'],
                'incomplete_count': bucket['incomplete_count'],
                'total_results': total,
                'pass_rate': round((bucket['pass_count'] / total) * 100, 1) if total else 0.0,
                'avg_time_ms': round(bucket['total_time_ms'] / bucket['observed_count']) if bucket['observed_count'] else None,
            }
        )

    items_payload = [
        {
            'id': str(item.id),
            'submission_id': str(item.submission_id),
            'student_id': item.student_id,
            'student_username': item.student.username,
            'attempt_number': item.submission.attempt_number,
            'submitted_at': item.submission.submitted_at,
            'status': item.status,
            'outcome': item.outcome,
            'passed_tests': item.passed_tests,
            'total_tests': item.total_tests,
            'summary': item.summary,
            'grading_run_id': str(item.grading_run_id) if item.grading_run_id else '',
        }
        for item in items
    ]

    return {
        'run': build_class_execution_run_summary(run, items),
        'tests': tests_payload,
        'items': items_payload,
    }
