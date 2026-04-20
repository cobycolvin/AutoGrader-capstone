from django.conf import settings
from django.db import models
from django.utils import timezone

from .core import BaseModel, TimeStampedModel


class TestSuiteVisibility(models.TextChoices):
    PUBLIC = 'PUBLIC', 'Public'
    PRIVATE = 'PRIVATE', 'Private'


class TestSuiteExecutionMode(models.TextChoices):
    LANGUAGE_TEMPLATE = 'LANGUAGE_TEMPLATE', 'Language template'
    PYTHON_RUNNER = 'PYTHON_RUNNER', 'Python runner'


class GradingExitStatus(models.TextChoices):
    OK = 'OK', 'OK'
    TIMEOUT = 'TIMEOUT', 'Timeout'
    RUNTIME_ERROR = 'RUNTIME_ERROR', 'Runtime error'
    SANDBOX_ERROR = 'SANDBOX_ERROR', 'Sandbox error'


class TestResultStatus(models.TextChoices):
    PASS = 'PASS', 'Pass'
    FAIL = 'FAIL', 'Fail'
    SKIP = 'SKIP', 'Skip'


class ClassExecutionRunStatus(models.TextChoices):
    QUEUED = 'QUEUED', 'Queued'
    RUNNING = 'RUNNING', 'Running'
    COMPLETED = 'COMPLETED', 'Completed'


class ClassExecutionItemStatus(models.TextChoices):
    QUEUED = 'QUEUED', 'Queued'
    RUNNING = 'RUNNING', 'Running'
    COMPLETED = 'COMPLETED', 'Completed'
    FAILED = 'FAILED', 'Failed'


class ClassExecutionOutcome(models.TextChoices):
    PASS = 'PASS', 'Pass'
    FAIL = 'FAIL', 'Fail'
    INCOMPLETE = 'INCOMPLETE', 'Incomplete'


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
    execution_mode = models.CharField(
        max_length=30,
        choices=TestSuiteExecutionMode.choices,
        default=TestSuiteExecutionMode.LANGUAGE_TEMPLATE,
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


class RubricTemplateScope(models.TextChoices):
    SYSTEM = 'SYSTEM', 'Standard'
    COURSE = 'COURSE', 'Course'


class RubricTemplate(BaseModel):
    course = models.ForeignKey(
        'autograder.Course',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='rubric_templates',
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default='')
    scope = models.CharField(
        max_length=10,
        choices=RubricTemplateScope.choices,
        default=RubricTemplateScope.COURSE,
    )
    template_key = models.CharField(max_length=120, null=True, blank=True, unique=True)
    active_version = models.ForeignKey(
        'autograder.RubricTemplateVersion',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )

    class Meta:
        ordering = ['name', 'created_at']
        indexes = [
            models.Index(fields=['scope', 'course'], name='idx_rubric_tpl_scope'),
        ]


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


class RubricTemplateVersion(BaseModel):
    template = models.ForeignKey(
        RubricTemplate,
        on_delete=models.CASCADE,
        related_name='versions',
    )
    version_number = models.PositiveIntegerField()
    is_weighted = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['template', 'version_number'],
                name='uniq_rubric_template_version',
            )
        ]


class RubricAttachment(BaseModel):
    rubric_version = models.ForeignKey(
        RubricVersion,
        on_delete=models.CASCADE,
        related_name='attachments',
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='uploaded_rubric_attachments',
    )
    original_name = models.CharField(max_length=255)
    file_key = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=255, blank=True)
    file_size = models.PositiveBigIntegerField(default=0)
    display_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['display_order', 'created_at']
        indexes = [
            models.Index(fields=['rubric_version', 'display_order'], name='idx_rubric_attach_order'),
        ]


class RubricCriterion(BaseModel):
    rubric_version = models.ForeignKey(RubricVersion, on_delete=models.CASCADE)
    name = models.CharField(max_length=200)
    max_points = models.DecimalField(max_digits=7, decimal_places=2)
    weight = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    order_index = models.PositiveIntegerField(default=0)


class RubricTemplateCriterion(BaseModel):
    template_version = models.ForeignKey(
        RubricTemplateVersion,
        on_delete=models.CASCADE,
        related_name='criteria',
    )
    name = models.CharField(max_length=200)
    max_points = models.DecimalField(max_digits=7, decimal_places=2)
    weight = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    order_index = models.PositiveIntegerField(default=0)


class RubricCriterionLevel(BaseModel):
    criterion = models.ForeignKey(
        RubricCriterion,
        on_delete=models.CASCADE,
        related_name='levels',
    )
    label = models.CharField(max_length=100)
    min_points = models.DecimalField(max_digits=7, decimal_places=2)
    max_points = models.DecimalField(max_digits=7, decimal_places=2)
    description = models.TextField(blank=True)
    order_index = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-max_points']


class RubricTemplateCriterionLevel(BaseModel):
    criterion = models.ForeignKey(
        RubricTemplateCriterion,
        on_delete=models.CASCADE,
        related_name='levels',
    )
    label = models.CharField(max_length=100)
    min_points = models.DecimalField(max_digits=7, decimal_places=2)
    max_points = models.DecimalField(max_digits=7, decimal_places=2)
    description = models.TextField(blank=True)
    order_index = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-max_points']


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
    feedback = models.TextField(blank=True, default='')
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
    grading_run = models.ForeignKey(GradingRun, on_delete=models.CASCADE, null=True, blank=True)
    submission = models.ForeignKey(
        'autograder.Submission',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='rubric_scores',
    )
    rubric_criterion = models.ForeignKey('autograder.RubricCriterion', on_delete=models.CASCADE)
    points_awarded = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    comment = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['submission', 'rubric_criterion'],
                name='uniq_submission_rubric_criterion',
            )
        ]


class ClassExecutionRun(BaseModel):
    assignment = models.ForeignKey('autograder.Assignment', on_delete=models.CASCADE, related_name='class_execution_runs')
    test_suite_version = models.ForeignKey(
        'autograder.TestSuiteVersion',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='class_execution_runs',
    )
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='triggered_class_execution_runs',
    )
    status = models.CharField(
        max_length=20,
        choices=ClassExecutionRunStatus.choices,
        default=ClassExecutionRunStatus.QUEUED,
    )
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    total_students = models.PositiveIntegerField(default=0)
    total_submissions = models.PositiveIntegerField(default=0)
    missing_submissions = models.PositiveIntegerField(default=0)

    class Meta:
        indexes = [
            models.Index(fields=['assignment', 'created_at'], name='idx_class_exec_run_assignment'),
            models.Index(fields=['assignment', 'status'], name='idx_class_exec_run_status'),
        ]


class ClassExecutionItem(BaseModel):
    class_execution_run = models.ForeignKey(
        ClassExecutionRun,
        on_delete=models.CASCADE,
        related_name='items',
    )
    submission = models.ForeignKey('autograder.Submission', on_delete=models.CASCADE, related_name='class_execution_items')
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='class_execution_items',
    )
    grading_run = models.ForeignKey(
        GradingRun,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='class_execution_items',
    )
    status = models.CharField(
        max_length=20,
        choices=ClassExecutionItemStatus.choices,
        default=ClassExecutionItemStatus.QUEUED,
    )
    outcome = models.CharField(
        max_length=20,
        choices=ClassExecutionOutcome.choices,
        blank=True,
    )
    passed_tests = models.PositiveIntegerField(default=0)
    total_tests = models.PositiveIntegerField(default=0)
    summary = models.CharField(max_length=255, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['class_execution_run', 'submission'],
                name='uniq_class_exec_run_submission',
            )
        ]
        indexes = [
            models.Index(fields=['class_execution_run', 'status'], name='idx_class_exec_item_status'),
            models.Index(fields=['submission', 'status'], name='idx_class_exec_item_submission'),
        ]
