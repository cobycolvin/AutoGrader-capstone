import time

from django.core.management.base import BaseCommand
from django.db import transaction

from autograder.grader.runner import grade_submission
from autograder.models import (
    ClassExecutionItem,
    ClassExecutionItemStatus,
    Submission,
    SubmissionStatus,
)
from autograder.services import complete_class_execution_item, fail_class_execution_item, start_class_execution_item


class Command(BaseCommand):
    help = 'Run the local grader worker loop.'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true', help='Process one submission and exit.')
        parser.add_argument('--poll-interval', type=float, default=2.0, help='Seconds between polls.')

    def handle(self, *args, **options):
        once = options['once']
        poll_interval = options['poll_interval']

        self.stdout.write(self.style.SUCCESS('Gradeforge local grader worker started.'))
        while True:
            class_execution_item = self._claim_next_class_execution_item()
            if class_execution_item:
                try:
                    grading_run = grade_submission(
                        class_execution_item.submission_id,
                        test_version_override=class_execution_item.class_execution_run.test_suite_version,
                        worker_id=f'class-run:{class_execution_item.class_execution_run_id}',
                    )
                    complete_class_execution_item(class_execution_item, grading_run)
                except Exception as exc:  # noqa: BLE001
                    fail_class_execution_item(class_execution_item, str(exc))
                    self.stderr.write(self.style.ERROR(f'Class execution failed: {exc}'))

                if once:
                    return
                continue

            submission = self._claim_next_submission()
            if not submission:
                if once:
                    return
                time.sleep(poll_interval)
                continue

            try:
                grade_submission(submission.id)
            except Exception as exc:  # noqa: BLE001
                self.stderr.write(self.style.ERROR(f'Grading failed: {exc}'))

            if once:
                return

    def _claim_next_class_execution_item(self):
        with transaction.atomic():
            item = (
                ClassExecutionItem.objects.select_for_update(skip_locked=True)
                .select_related('class_execution_run', 'class_execution_run__test_suite_version', 'submission')
                .filter(status=ClassExecutionItemStatus.QUEUED)
                .order_by('created_at')
                .first()
            )
            if not item:
                return None
            start_class_execution_item(item)
            return item

    def _claim_next_submission(self):
        with transaction.atomic():
            submission = (
                Submission.objects.select_for_update(skip_locked=True)
                .filter(status=SubmissionStatus.QUEUED)
                .order_by('submitted_at')
                .first()
            )
            if not submission:
                return None
            submission.status = SubmissionStatus.RUNNING
            submission.save(update_fields=['status'])
            return submission
