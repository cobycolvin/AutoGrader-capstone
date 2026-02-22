from django.contrib.auth import get_user_model
from django.db.models import Q
from collections import defaultdict
from decimal import Decimal

from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Course, Enrollment, EnrollmentRole, EnrollmentStatus, Grade
from ..permissions import IsInstructorOrSuperuser, IsSuperuser
from ..serializers.courses import (
    CourseEnrollmentCreateSerializer,
    CourseEnrollmentSerializer,
    CoursePersonSerializer,
    CourseSerializer,
    UserLookupSerializer,
)
from ..serializers.grades import CourseGradeSummarySerializer
from ..services.access import can_manage_course, is_course_member


class CourseViewSet(viewsets.ModelViewSet):
    queryset = Course.objects.all().order_by('code', 'term', 'section')
    serializer_class = CourseSerializer
    permission_classes = [IsSuperuser]

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsInstructorOrSuperuser],
        url_path='self-enroll',
    )
    def self_enroll(self, request, pk=None):
        course = self.get_object()
        enrollment, created = Enrollment.objects.get_or_create(
            course=course,
            user=request.user,
            defaults={
                'role': EnrollmentRole.INSTRUCTOR,
                'status': EnrollmentStatus.ACTIVE,
            },
        )
        if not created:
            if enrollment.status != EnrollmentStatus.ACTIVE:
                enrollment.status = EnrollmentStatus.ACTIVE
                enrollment.save(update_fields=['status'])
        data = CourseEnrollmentSerializer(enrollment).data
        return Response(data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='people',
    )
    def people(self, request, pk=None):
        course = self.get_object()
        if not request.user.is_superuser:
            if not is_course_member(request.user, course.id):
                return Response({'detail': 'Not enrolled in this course.'}, status=status.HTTP_403_FORBIDDEN)

        enrollments = (
            Enrollment.objects.select_related('user', 'user__profile')
            .filter(course=course, status=EnrollmentStatus.ACTIVE)
            .order_by('role', 'user__last_name', 'user__first_name', 'user__username')
        )
        data = CoursePersonSerializer(enrollments, many=True).data
        return Response(data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='people/enroll',
    )
    def enroll_person(self, request, pk=None):
        course = self.get_object()
        if not can_manage_course(request.user, course):
            return Response({'detail': 'Not authorized to enroll people.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = CourseEnrollmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.resolve_user()
        if not user:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        role = serializer.validated_data.get('role', EnrollmentRole.STUDENT)
        status_value = serializer.validated_data.get('status', EnrollmentStatus.ACTIVE)

        enrollment, created = Enrollment.objects.get_or_create(
            course=course,
            user=user,
            defaults={
                'role': role,
                'status': status_value,
            },
        )
        if not created:
            updated_fields = []
            if enrollment.role != role:
                enrollment.role = role
                updated_fields.append('role')
            if enrollment.status != status_value:
                enrollment.status = status_value
                updated_fields.append('status')
            if updated_fields:
                enrollment.save(update_fields=updated_fields)

        data = CoursePersonSerializer(enrollment).data
        return Response(data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='grades',
    )
    def grades(self, request, pk=None):
        course = self.get_object()
        user = request.user

        can_view_all = can_manage_course(user, course)
        if not can_view_all:
            if not is_course_member(user, course.id):
                return Response({'detail': 'Not authorized to view grades.'}, status=status.HTTP_403_FORBIDDEN)

        enrollments = (
            Enrollment.objects.select_related('user', 'user__profile')
            .filter(course=course, status=EnrollmentStatus.ACTIVE, role=EnrollmentRole.STUDENT)
            .order_by('user__last_name', 'user__first_name', 'user__username')
        )
        if not can_view_all:
            enrollments = enrollments.filter(user=user)

        totals = defaultdict(lambda: {'score': Decimal('0'), 'max': Decimal('0')})
        grades = Grade.objects.filter(submission__assignment__course=course).select_related('submission__submitted_by')
        for grade in grades:
            user_id = grade.submission.submitted_by_id
            totals[user_id]['score'] += grade.score
            totals[user_id]['max'] += grade.max_score

        rows = []
        for enrollment in enrollments:
            profile = getattr(enrollment.user, 'profile', None)
            total_score = totals[enrollment.user_id]['score']
            total_max = totals[enrollment.user_id]['max']
            percent = float((total_score / total_max) * 100) if total_max > 0 else 0.0
            rows.append({
                'id': enrollment.user_id,
                'user_id': enrollment.user_id,
                'username': enrollment.user.username,
                'email': enrollment.user.email or '',
                'display_name': profile.display_name if profile and profile.display_name else enrollment.user.get_username(),
                'cwid': profile.cwid if profile else '',
                'total_score': total_score,
                'total_max_score': total_max,
                'percent': percent,
            })

        serializer = CourseGradeSummarySerializer(rows, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='people/unenroll',
    )
    def unenroll_person(self, request, pk=None):
        course = self.get_object()
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'detail': 'user_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        enrollment = (
            Enrollment.objects.filter(course=course, user_id=user_id)
            .select_related('user', 'user__profile')
            .first()
        )
        if not enrollment:
            return Response({'detail': 'Enrollment not found.'}, status=status.HTTP_404_NOT_FOUND)

        is_self = request.user.is_authenticated and enrollment.user_id == request.user.id
        if not is_self and not can_manage_course(request.user, course):
            return Response({'detail': 'Not authorized to unenroll this user.'}, status=status.HTTP_403_FORBIDDEN)

        if enrollment.status != EnrollmentStatus.DROPPED:
            enrollment.status = EnrollmentStatus.DROPPED
            enrollment.save(update_fields=['status'])

        data = CoursePersonSerializer(enrollment).data
        return Response(data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='people/search',
    )
    def search_people(self, request, pk=None):
        course = self.get_object()
        if not can_manage_course(request.user, course):
            return Response({'detail': 'Not authorized to search people.'}, status=status.HTTP_403_FORBIDDEN)

        query = (request.query_params.get('q') or '').strip()
        if len(query) < 2:
            return Response([], status=status.HTTP_200_OK)

        user_model = get_user_model()
        filters = (
            Q(username__icontains=query)
            | Q(email__icontains=query)
            | Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
            | Q(profile__cwid__icontains=query)
            | Q(profile__display_name__icontains=query)
        )
        qs = (
            user_model.objects.select_related('profile')
            .filter(filters)
            .order_by('last_name', 'first_name', 'username')[:20]
        )
        data = UserLookupSerializer(qs, many=True).data
        return Response(data, status=status.HTTP_200_OK)


class MyCoursesView(generics.ListAPIView):
    serializer_class = CourseEnrollmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Enrollment.objects.select_related('course')
            .filter(user=self.request.user, status=EnrollmentStatus.ACTIVE)
            .order_by('course__code', 'course__term', 'course__section')
        )


class CourseCatalogView(generics.ListAPIView):
    serializer_class = CourseSerializer
    permission_classes = [IsInstructorOrSuperuser]
    queryset = Course.objects.all().order_by('code', 'term', 'section')
