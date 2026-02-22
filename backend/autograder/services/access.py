from ..models import Enrollment, EnrollmentRole, EnrollmentStatus

_MANAGE_ROLES = [EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA]


def is_instructor_or_superuser(user):
    if user.is_superuser:
        return True
    return user.groups.filter(name='Instructor').exists()


def has_active_course_staff_enrollment(user):
    return Enrollment.objects.filter(
        user=user,
        status=EnrollmentStatus.ACTIVE,
        role__in=_MANAGE_ROLES,
    ).exists()


def is_course_member(user, course_id):
    return Enrollment.objects.filter(
        course_id=course_id,
        user=user,
        status=EnrollmentStatus.ACTIVE,
    ).exists()


def can_manage_course(user, course):
    if is_instructor_or_superuser(user):
        return True
    return Enrollment.objects.filter(
        course=course,
        user=user,
        status=EnrollmentStatus.ACTIVE,
        role__in=_MANAGE_ROLES,
    ).exists()


def can_view_course_assets(user, course_id):
    if is_instructor_or_superuser(user):
        return True
    return is_course_member(user, course_id)


def can_access_template_tools(user):
    if is_instructor_or_superuser(user):
        return True
    return has_active_course_staff_enrollment(user)
