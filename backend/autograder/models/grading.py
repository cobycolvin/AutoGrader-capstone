from django.db import models
from django.utils import timezone

from .core import BaseModel, TimeStampedModel


class TestSuiteVisibility(models.TextChoices):
    PUBLIC = 'PUBLIC', 'Public'
    PRIVATE = 'PRIVATE', 'Private'


class GradingExitStatus(models.TextChoices):
    OK = 'OK', 'OK'
    TIMEOUT = 'TIMEOUT', 'Timeout'
    RUNTIME_ERROR = 'RUNTIME_ERROR', 'Runtime error'
    SANDBOX_ERROR = 'SANDBOX_ERROR', 'Sandbox error'


class TestResultStatus(models.TextChoices):
    PASS = 'PASS', 'Pass'
    FAIL = 'FAIL', 'Fail'
    SKIP = 'SKIP', 'Skip'


class TestSuite(BaseModel):
    assignment = models.ForeignKey('autograder.Assignment', on_delete=models.CASCADE)
    active_version = models.ForeignKey(
        'autograder.TestSuiteVersion',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )


class TestSuiteVersion(BaseModel):
    test_suite = models.ForeignKey(TestSuite, on_delete=models.CASCADE)
    version_number = models.PositiveIntegerField()
    visibility = models.CharField(
        max_length=10,
        choices=TestSuiteVisibility.choices,
        default=TestSuiteVisibility.PRIVATE,
    )
    bundle_key = models.CharField(max_length=512)
    checksum = models.CharField(max_length=128)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['test_suite', 'version_number', 'visibility'],
                name='uniq_test_suite_version',
            )
        ]


class Rubric(BaseModel):
    assignment = models.ForeignKey('autograder.Assignment', on_delete=models.CASCADE)
    active_version = models.ForeignKey(
        'autograder.RubricVersion',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )


class RubricVersion(BaseModel):
    rubric = models.ForeignKey(Rubric, on_delete=models.CASCADE)
    version_number = models.PositiveIntegerField()
    is_weighted = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['rubric', 'version_number'],
                name='uniq_rubric_version',
            )
        ]


class RubricCriterion(BaseModel):
    rubric_version = models.ForeignKey(RubricVersion, on_delete=models.CASCADE)
    name = models.CharField(max_length=200)
    max_points = models.DecimalField(max_digits=7, decimal_places=2)
    weight = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    order_index = models.PositiveIntegerField(default=0)


class GradingRun(BaseModel):
    submission = models.ForeignKey('autograder.Submission', on_delete=models.CASCADE)
    test_suite_version_public = models.ForeignKey(
        'autograder.TestSuiteVersion',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='grading_runs_public',
    )
    test_suite_version_private = models.ForeignKey(
        'autograder.TestSuiteVersion',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='grading_runs_private',
    )
    rubric_version = models.ForeignKey(
        'autograder.RubricVersion',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    worker_id = models.CharField(max_length=128)
    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)
    exit_status = models.CharField(
        max_length=20,
        choices=GradingExitStatus.choices,
        default=GradingExitStatus.OK,
    )
    resource_usage_json = models.JSONField(default=dict, blank=True)
    stdout_key = models.CharField(max_length=512, blank=True)
    stderr_key = models.CharField(max_length=512, blank=True)
    result_json = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['submission', 'started_at'], name='idx_grading_run'),
        ]


class Grade(TimeStampedModel):
    submission = models.OneToOneField(
        'autograder.Submission',
        primary_key=True,
        on_delete=models.CASCADE,
        related_name='grade',
    )
    latest_grading_run = models.ForeignKey(
        GradingRun,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    score = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    max_score = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    released_to_student = models.BooleanField(default=False)
    released_at = models.DateTimeField(null=True, blank=True)


class TestResult(BaseModel):
    grading_run = models.ForeignKey(GradingRun, on_delete=models.CASCADE)
    test_name = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=TestResultStatus.choices)
    points_awarded = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    time_ms = models.PositiveIntegerField(null=True, blank=True)
    message = models.CharField(max_length=500, blank=True)


class RubricScore(BaseModel):
    grading_run = models.ForeignKey(GradingRun, on_delete=models.CASCADE)
    rubric_criterion = models.ForeignKey('autograder.RubricCriterion', on_delete=models.CASCADE)
    points_awarded = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    comment = models.TextField(blank=True)
