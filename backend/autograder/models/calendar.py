from django.conf import settings
from django.db import models

from .core import BaseModel


class CalendarEventScope(models.TextChoices):
    PERSONAL = 'PERSONAL', 'Personal'
    COURSE = 'COURSE', 'Course'
    GLOBAL = 'GLOBAL', 'Global'


class CalendarEventType(models.TextChoices):
    CUSTOM = 'CUSTOM', 'Custom'
    EXAM = 'EXAM', 'Exam'
    MEETING = 'MEETING', 'Meeting'
    REMINDER = 'REMINDER', 'Reminder'


class CalendarEvent(BaseModel):
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    scope = models.CharField(
        max_length=20,
        choices=CalendarEventScope.choices,
        default=CalendarEventScope.PERSONAL,
    )
    event_type = models.CharField(
        max_length=20,
        choices=CalendarEventType.choices,
        default=CalendarEventType.CUSTOM,
    )
    course = models.ForeignKey(
        'autograder.Course',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='calendar_events',
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='calendar_events',
    )
    start_at = models.DateTimeField()
    end_at = models.DateTimeField(null=True, blank=True)
    all_day = models.BooleanField(default=False)
    timezone = models.CharField(max_length=64, blank=True, default='UTC')
    priority = models.PositiveSmallIntegerField(default=2)
    is_important = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=['scope', 'start_at'], name='idx_event_scope_start'),
            models.Index(fields=['owner', 'start_at'], name='idx_event_owner_start'),
            models.Index(fields=['course', 'start_at'], name='idx_event_course_start'),
        ]
