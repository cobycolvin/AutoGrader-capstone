from django.conf import settings
from django.db import models
from django.utils import timezone

from .core import BaseModel


class AssignmentGroupMode(models.TextChoices):
    PER_ASSIGNMENT = 'PER_ASSIGNMENT', 'Per assignment'
    REUSABLE_SET = 'REUSABLE_SET', 'Reusable set'


class SubmissionStatus(models.TextChoices):
    QUEUED = 'QUEUED', 'Queued'
    RUNNING = 'RUNNING', 'Running'
    GRADED = 'GRADED', 'Graded'
    FAILED = 'FAILED', 'Failed'


class ProgrammingLanguage(BaseModel):
    name = models.CharField(max_length=50)
    slug = models.SlugField(max_length=50, unique=True)
    docker_image = models.CharField(max_length=200)
    compile_cmd = models.TextField(blank=True)
    run_cmd_template = models.TextField()
    is_enabled = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Assignment(BaseModel):
    course = models.ForeignKey('autograder.Course', on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    language = models.ForeignKey(
        ProgrammingLanguage,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    due_at = models.DateTimeField(null=True, blank=True)
    late_policy_json = models.JSONField(default=dict, blank=True)
    max_score = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    allow_groups = models.BooleanField(default=False)
    group_mode = models.CharField(
        max_length=20,
        choices=AssignmentGroupMode.choices,
        default=AssignmentGroupMode.PER_ASSIGNMENT,
    )

    class Meta:
        indexes = [
            models.Index(fields=['course', 'due_at'], name='idx_assignment_course_due'),
        ]


class AssignmentGroup(BaseModel):
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE)
    group = models.ForeignKey('autograder.Group', on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['assignment', 'group'],
                name='uniq_assignment_group',
            )
        ]


class Submission(BaseModel):
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='submissions',
    )
    group = models.ForeignKey('autograder.Group', null=True, blank=True, on_delete=models.SET_NULL)
    attempt_number = models.PositiveIntegerField(default=1)
    submitted_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(
        max_length=20,
        choices=SubmissionStatus.choices,
        default=SubmissionStatus.QUEUED,
    )
    source_bundle_key = models.CharField(max_length=512)
    starter_code_version = models.CharField(max_length=100, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['assignment', 'submitted_by', 'attempt_number'],
                name='uniq_submission_attempt',
            )
        ]
        indexes = [
            models.Index(fields=['assignment', 'submitted_at'], name='idx_sub_assignment_sub'),
        ]
