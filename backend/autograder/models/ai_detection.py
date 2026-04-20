from django.conf import settings
from django.db import models

from .core import BaseModel


class AIDetectionStatus(models.TextChoices):
    PENDING = 'PENDING', 'Pending'
    RUNNING = 'RUNNING', 'Running'
    DONE = 'DONE', 'Done'
    FAILED = 'FAILED', 'Failed'


class AIDetectionVerdict(models.TextChoices):
    CLEAN = 'CLEAN', 'Clean'
    LIKELY_AI = 'LIKELY_AI', 'Likely AI'
    CONFIRMED_AI = 'CONFIRMED_AI', 'Confirmed AI'


class AIDetectionScan(BaseModel):
    submission = models.ForeignKey(
        'autograder.Submission',
        on_delete=models.CASCADE,
        related_name='ai_detection_scans',
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='requested_ai_scans',
    )
    status = models.CharField(
        max_length=20,
        choices=AIDetectionStatus.choices,
        default=AIDetectionStatus.PENDING,
    )
    model_version = models.CharField(max_length=50, blank=True, default='v1-xgboost')
    overall_score = models.FloatField(null=True, blank=True)
    verdict = models.CharField(
        max_length=20,
        choices=AIDetectionVerdict.choices,
        null=True,
        blank=True,
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at']


class AIDetectionFinding(BaseModel):
    scan = models.ForeignKey(
        AIDetectionScan,
        on_delete=models.CASCADE,
        related_name='findings',
    )
    file_path = models.CharField(max_length=512)
    start_line = models.PositiveIntegerField()
    end_line = models.PositiveIntegerField()
    confidence = models.FloatField()

    class Meta:
        ordering = ['file_path', 'start_line']
