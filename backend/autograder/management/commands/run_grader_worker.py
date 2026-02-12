import time

from django.core.management.base import BaseCommand
from django.db import transaction

from autograder.grader.runner import grade_submission
from autograder.models import Submission, SubmissionStatus


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
