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


class PendingEnrollmentStatus(models.TextChoices):
    PENDING = 'PENDING', 'Pending'
    CLAIMED = 'CLAIMED', 'Claimed'


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


class PendingEnrollment(BaseModel):
    course = models.ForeignKey(
        Course,
        on_delete=models.CASCADE,
        related_name='pending_enrollments',
    )
    role = models.CharField(
        max_length=20,
        choices=EnrollmentRole.choices,
        default=EnrollmentRole.STUDENT,
    )
    status = models.CharField(
        max_length=20,
        choices=PendingEnrollmentStatus.choices,
        default=PendingEnrollmentStatus.PENDING,
    )
    student_name = models.CharField(max_length=200)
    display_name = models.CharField(max_length=200, blank=True)
    first_name = models.CharField(max_length=150)
    middle_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150)
    cwid = models.CharField(max_length=32)
    sis_login_id = models.CharField(max_length=150)
    section = models.CharField(max_length=100, blank=True)
    claimed_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='claimed_pending_enrollments',
    )
    claimed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['course', 'cwid', 'status'],
                name='uniq_pending_enrollment_course_cwid_status',
            )
        ]
        indexes = [
            models.Index(fields=['course', 'status'], name='idx_pending_course_status'),
            models.Index(fields=['cwid'], name='idx_pending_cwid'),
            models.Index(fields=['sis_login_id'], name='idx_pending_login'),
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
