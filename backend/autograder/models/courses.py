from django.conf import settings
from django.db import models
from django.utils import timezone

from .core import BaseModel


class EnrollmentRole(models.TextChoices):
    STUDENT = 'STUDENT', 'Student'
    INSTRUCTOR = 'INSTRUCTOR', 'Instructor'
    TA = 'TA', 'TA'
    GRADER = 'GRADER', 'Grader'


class EnrollmentStatus(models.TextChoices):
    ACTIVE = 'ACTIVE', 'Active'
    DROPPED = 'DROPPED', 'Dropped'


class Course(BaseModel):
    org = models.ForeignKey(
        'autograder.Organization',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    code = models.CharField(max_length=50)
    title = models.CharField(max_length=200)
    term = models.CharField(max_length=50, blank=True)
    section = models.CharField(max_length=50, blank=True)
    canvas_course_id = models.CharField(max_length=100, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['org', 'code', 'term', 'section'],
                name='uniq_course_org_code_term_section',
            )
        ]


class Enrollment(BaseModel):
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=EnrollmentRole.choices)
    status = models.CharField(
        max_length=20,
        choices=EnrollmentStatus.choices,
        default=EnrollmentStatus.ACTIVE,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['course', 'user'],
                name='uniq_enrollment_course_user',
            )
        ]
        indexes = [
            models.Index(fields=['course', 'role'], name='idx_enrollment_course_role'),
        ]


class GroupSet(BaseModel):
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    name = models.CharField(max_length=200)

    def __str__(self):
        return self.name


class Group(BaseModel):
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    group_set = models.ForeignKey(
        GroupSet,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    name = models.CharField(max_length=200)

    def __str__(self):
        return self.name


class GroupMember(BaseModel):
    group = models.ForeignKey(Group, on_delete=models.CASCADE)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['group', 'user'],
                name='uniq_group_member',
            )
        ]
