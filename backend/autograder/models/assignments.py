from django.conf import settings
from django.db import models
from django.utils import timezone

from .core import BaseModel


class AssignmentGroupMode(models.TextChoices):
    PER_ASSIGNMENT = 'PER_ASSIGNMENT', 'Per assignment'
    REUSABLE_SET = 'REUSABLE_SET', 'Reusable set'


class AssignmentSubmissionMode(models.TextChoices):
    UPLOAD = 'UPLOAD', 'Upload only'
    WORKSPACE = 'WORKSPACE', 'Workspace only'
    BOTH = 'BOTH', 'Upload or workspace'


class SubmissionStatus(models.TextChoices):
    QUEUED = 'QUEUED', 'Queued'
    RUNNING = 'RUNNING', 'Running'
    GRADED = 'GRADED', 'Graded'
    FAILED = 'FAILED', 'Failed'


class ProgrammingLanguage(BaseModel):
    name = models.CharField(max_length=50)
    slug = models.SlugField(max_length=50, unique=True)
    docker_image = models.CharField(max_length=200, blank=True)
    compile_cmd = models.TextField(blank=True)
    run_cmd_template = models.TextField()
    is_enabled = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Assignment(BaseModel):
    course = models.ForeignKey('autograder.Course', on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    instructions = models.TextField(blank=True)
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
    group_set = models.ForeignKey(
        'autograder.GroupSet',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='assignments',
    )
    integrity_config_json = models.JSONField(default=dict, blank=True)
    submission_mode = models.CharField(
        max_length=20,
        choices=AssignmentSubmissionMode.choices,
        default=AssignmentSubmissionMode.UPLOAD,
    )
    submission_file_types = models.JSONField(default=list, blank=True)
    submission_max_size_mb = models.PositiveIntegerField(default=25)
    submission_max_attempts = models.PositiveIntegerField(default=3)

    class Meta:
        indexes = [
            models.Index(fields=['course', 'due_at'], name='idx_assignment_course_due'),
        ]

    def allows_upload_submission(self):
        return self.submission_mode in {
            AssignmentSubmissionMode.UPLOAD,
            AssignmentSubmissionMode.BOTH,
        }

    def allows_workspace_submission(self):
        return self.submission_mode in {
            AssignmentSubmissionMode.WORKSPACE,
            AssignmentSubmissionMode.BOTH,
        }


class AssignmentInstructionAsset(BaseModel):
    assignment = models.ForeignKey(
        Assignment,
        on_delete=models.CASCADE,
        related_name='instruction_assets',
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='uploaded_instruction_assets',
    )
    original_name = models.CharField(max_length=255)
    file_key = models.CharField(max_length=512)
    mime_type = models.CharField(max_length=255, blank=True)
    file_size = models.PositiveBigIntegerField(default=0)
    display_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['display_order', 'created_at']
        indexes = [
            models.Index(fields=['assignment', 'display_order'], name='idx_assign_instr_order'),
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
            ),
            models.UniqueConstraint(
                fields=['assignment', 'group', 'attempt_number'],
                name='uniq_submission_group_attempt',
            ),
        ]
        indexes = [
            models.Index(fields=['assignment', 'submitted_at'], name='idx_sub_assignment_sub'),
        ]


class SubmissionDraft(BaseModel):
    assignment = models.ForeignKey(
        Assignment,
        on_delete=models.CASCADE,
        related_name='submission_drafts',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='submission_drafts',
    )
    group = models.ForeignKey(
        'autograder.Group',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='submission_drafts',
    )
    source_bundle_key = models.CharField(max_length=512, blank=True)
    manifest_json = models.JSONField(default=list, blank=True)
    revision = models.PositiveIntegerField(default=1)
    starter_code_version = models.CharField(max_length=100, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=(
                    (models.Q(user__isnull=False) & models.Q(group__isnull=True))
                    | (models.Q(user__isnull=True) & models.Q(group__isnull=False))
                ),
                name='chk_submission_draft_owner',
            ),
            models.UniqueConstraint(
                fields=['assignment', 'user'],
                condition=models.Q(user__isnull=False),
                name='uniq_submission_draft_assignment_user',
            ),
            models.UniqueConstraint(
                fields=['assignment', 'group'],
                condition=models.Q(group__isnull=False),
                name='uniq_submission_draft_assignment_group',
            ),
        ]
        indexes = [
            models.Index(fields=['assignment', 'updated_at'], name='idx_draft_assignment_updated'),
        ]
