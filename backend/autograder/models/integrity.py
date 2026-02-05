from django.db import models

from .core import BaseModel


class IntegrityScanType(models.TextChoices):
    PLAGIARISM = 'PLAGIARISM', 'Plagiarism'
    AI_CODE = 'AI_CODE', 'AI code'


class IntegrityScanStatus(models.TextChoices):
    PENDING = 'PENDING', 'Pending'
    DONE = 'DONE', 'Done'
    FAILED = 'FAILED', 'Failed'


class IntegrityScan(BaseModel):
    assignment = models.ForeignKey('autograder.Assignment', on_delete=models.CASCADE)
    scan_type = models.CharField(max_length=20, choices=IntegrityScanType.choices)
    status = models.CharField(
        max_length=20,
        choices=IntegrityScanStatus.choices,
        default=IntegrityScanStatus.PENDING,
    )


class IntegrityFinding(BaseModel):
    scan = models.ForeignKey(IntegrityScan, on_delete=models.CASCADE)
    submission = models.ForeignKey('autograder.Submission', on_delete=models.CASCADE)
    score = models.DecimalField(max_digits=6, decimal_places=3)
    matched_submission = models.ForeignKey(
        'autograder.Submission',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='integrity_matches',
    )
    details_json = models.JSONField(default=dict, blank=True)
