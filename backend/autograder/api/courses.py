import csv
import io
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    Assignment,
    Course,
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    Group,
    GroupMember,
    GroupSet,
    Grade,
    PendingEnrollment,
    PendingEnrollmentStatus,
    Submission,
    SubmissionStatus,
)
from ..permissions import IsInstructorOrSuperuser
from ..serializers.courses import (
    CourseEnrollmentCreateSerializer,
    CourseEnrollmentSerializer,
    CourseGroupMemberCreateSerializer,
    CourseGroupMemberSerializer,
    CourseGroupSerializer,
    CourseGroupSetSerializer,
    CourseGroupSetWriteSerializer,
    CourseGroupWriteSerializer,
    CoursePersonSerializer,
    PendingEnrollmentSerializer,
    CourseRosterImportSerializer,
    CourseSerializer,
    UserLookupSerializer,
)
from ..services.roster_import import apply_roster_import, preview_roster_import
from ..services import bootstrap_course_rubric_templates
from ..serializers.grades import (
    CourseAssignmentGradeSerializer,
    CourseAssignmentStudentGradeSerializer,
    CourseGradeOverrideSerializer,
    CourseGradeReportRequestSerializer,
    CourseGradeSummarySerializer,
)


class CourseViewSet(viewsets.ModelViewSet):
    queryset = Course.objects.all().order_by('code', 'term', 'section')
    serializer_class = CourseSerializer
    permission_classes = [IsInstructorOrSuperuser]

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user

        if not user.is_authenticated:
            return queryset.none()

        if user.is_superuser:
            return queryset

        open_actions = {
            'self_enroll',
            'people',
            'groups',
            'create_group_set',
            'manage_group_set',
            'create_group',
            'manage_group',
            'add_group_member',
            'remove_group_member',
            'grades',
            'grades_export',
            'grades_report',
            'grades_report_export',
            'override_grade',
            'search_people',
            'enroll_person',
            'unenroll_person',
            'pending_people',
            'import_roster_preview',
            'import_roster',
        }
        if self.action in open_actions:
            return queryset

        return queryset.filter(created_by=user)

    def perform_create(self, serializer):
        course = serializer.save(created_by=self.request.user)
        bootstrap_course_rubric_templates(course, created_by=self.request.user)
        enrollment, created = Enrollment.objects.get_or_create(
            course=course,
            user=self.request.user,
            defaults={
                'role': EnrollmentRole.INSTRUCTOR,
                'status': EnrollmentStatus.ACTIVE,
            },
        )
        if not created:
            updated_fields = []
            if enrollment.role != EnrollmentRole.INSTRUCTOR:
                enrollment.role = EnrollmentRole.INSTRUCTOR
                updated_fields.append('role')
            if enrollment.status != EnrollmentStatus.ACTIVE:
                enrollment.status = EnrollmentStatus.ACTIVE
                updated_fields.append('status')
            if updated_fields:
                enrollment.save(update_fields=updated_fields)

    def perform_update(self, serializer):
        course = self.get_object()
        if not self._can_manage_course(self.request.user, course):
            raise PermissionDenied('Not authorized to update this course.')
        serializer.save()

    def perform_destroy(self, instance):
        if not self._can_manage_course(self.request.user, instance):
            raise PermissionDenied('Not authorized to delete this course.')
        instance.delete()

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
            is_member = Enrollment.objects.filter(
                course=course,
                user=request.user,
                status=EnrollmentStatus.ACTIVE,
            ).exists()
            if not is_member:
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
        if not self._can_manage_people(request.user, course):
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
        url_path='people/pending',
    )
    def pending_people(self, request, pk=None):
        course = self.get_object()
        if not self._can_manage_people(request.user, course):
            return Response({'detail': 'Not authorized to view pending roster entries.'}, status=status.HTTP_403_FORBIDDEN)

        pending_rows = (
            PendingEnrollment.objects.filter(
                course=course,
                status=PendingEnrollmentStatus.PENDING,
            )
            .order_by('last_name', 'first_name', 'sis_login_id')
        )
        serializer = PendingEnrollmentSerializer(pending_rows, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='people/import-preview',
    )
    def import_roster_preview(self, request, pk=None):
        course = self.get_object()
        if not self._can_manage_people(request.user, course):
            return Response({'detail': 'Not authorized to import rosters.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = CourseRosterImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploaded_file = serializer.validated_data['file']
        try:
            payload = preview_roster_import(course, uploaded_file)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(payload, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='people/import',
    )
    def import_roster(self, request, pk=None):
        course = self.get_object()
        if not self._can_manage_people(request.user, course):
            return Response({'detail': 'Not authorized to import rosters.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = CourseRosterImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploaded_file = serializer.validated_data['file']
        try:
            payload = apply_roster_import(course, request.user, uploaded_file)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(payload, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='groups',
    )
    def groups(self, request, pk=None):
        course = self.get_object()
        if not self._can_manage_groups(request.user, course):
            return Response({'detail': 'Not authorized to manage groups.'}, status=status.HTTP_403_FORBIDDEN)
        return Response(self._build_group_payload(course), status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='groups/sets',
    )
    def create_group_set(self, request, pk=None):
        course = self.get_object()
        if not self._can_manage_groups(request.user, course):
            return Response({'detail': 'Not authorized to manage groups.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = CourseGroupSetWriteSerializer(data=request.data, context={'course': course})
        serializer.is_valid(raise_exception=True)
        group_set = GroupSet.objects.create(course=course, name=serializer.validated_data['name'])
        return Response(CourseGroupSetSerializer(group_set).data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['patch', 'delete'],
        permission_classes=[IsAuthenticated],
        url_path=r'groups/sets/(?P<group_set_id>[^/.]+)',
    )
    def manage_group_set(self, request, pk=None, group_set_id=None):
        course = self.get_object()
        if not self._can_manage_groups(request.user, course):
            return Response({'detail': 'Not authorized to manage groups.'}, status=status.HTTP_403_FORBIDDEN)

        group_set = GroupSet.objects.filter(id=group_set_id, course=course).first()
        if not group_set:
            return Response({'detail': 'Group set not found.'}, status=status.HTTP_404_NOT_FOUND)

        if request.method.lower() == 'delete':
            if Group.objects.filter(course=course, group_set=group_set).exists():
                return Response(
                    {'detail': 'Remove all groups from this set before deleting it.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            group_set.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = CourseGroupSetWriteSerializer(
            data=request.data,
            context={'course': course, 'instance': group_set},
        )
        serializer.is_valid(raise_exception=True)
        group_set.name = serializer.validated_data['name']
        group_set.save(update_fields=['name'])
        return Response(CourseGroupSetSerializer(group_set).data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='groups/items',
    )
    def create_group(self, request, pk=None):
        course = self.get_object()
        if not self._can_manage_groups(request.user, course):
            return Response({'detail': 'Not authorized to manage groups.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = CourseGroupWriteSerializer(data=request.data, context={'course': course})
        serializer.is_valid(raise_exception=True)
        group = Group.objects.create(
            course=course,
            group_set=serializer.validated_data['group_set'],
            name=serializer.validated_data['name'],
        )
        return Response(CourseGroupSerializer(group).data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['patch', 'delete'],
        permission_classes=[IsAuthenticated],
        url_path=r'groups/items/(?P<group_id>[^/.]+)',
    )
    def manage_group(self, request, pk=None, group_id=None):
        course = self.get_object()
        if not self._can_manage_groups(request.user, course):
            return Response({'detail': 'Not authorized to manage groups.'}, status=status.HTTP_403_FORBIDDEN)

        group = Group.objects.select_related('group_set').filter(id=group_id, course=course).first()
        if not group:
            return Response({'detail': 'Group not found.'}, status=status.HTTP_404_NOT_FOUND)

        if request.method.lower() == 'delete':
            group.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = CourseGroupWriteSerializer(
            data=request.data,
            context={'course': course, 'instance': group},
        )
        serializer.is_valid(raise_exception=True)
        group.name = serializer.validated_data['name']
        group.group_set = serializer.validated_data['group_set']
        group.save(update_fields=['name', 'group_set'])
        return Response(CourseGroupSerializer(group).data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path=r'groups/items/(?P<group_id>[^/.]+)/members',
    )
    def add_group_member(self, request, pk=None, group_id=None):
        course = self.get_object()
        if not self._can_manage_groups(request.user, course):
            return Response({'detail': 'Not authorized to manage groups.'}, status=status.HTTP_403_FORBIDDEN)

        group = Group.objects.select_related('group_set').filter(id=group_id, course=course).first()
        if not group:
            return Response({'detail': 'Group not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = CourseGroupMemberCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user_ids = serializer.validated_data['resolved_user_ids']

        enrollments = list(
            Enrollment.objects.select_related('user', 'user__profile')
            .filter(
                course=course,
                user_id__in=user_ids,
                status=EnrollmentStatus.ACTIVE,
                role=EnrollmentRole.STUDENT,
            )
        )
        enrollment_by_user_id = {enrollment.user_id: enrollment for enrollment in enrollments}

        for user_id in user_ids:
            enrollment = enrollment_by_user_id.get(user_id)
            if not enrollment:
                return Response(
                    {'detail': 'Only active students in this course can be added to a group.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if GroupMember.objects.filter(group=group, user=enrollment.user).exists():
                return Response({'detail': 'One or more students are already in this group.'}, status=status.HTTP_400_BAD_REQUEST)

            if group.group_set_id and GroupMember.objects.filter(
                user=enrollment.user,
                group__course=course,
                group__group_set_id=group.group_set_id,
            ).exists():
                return Response(
                    {'detail': 'One or more students are already assigned to another group in this set.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        created_ids = []
        for user_id in user_ids:
            member = GroupMember.objects.create(group=group, user=enrollment_by_user_id[user_id].user)
            created_ids.append(member.id)

        members = list(
            GroupMember.objects.select_related('user', 'user__profile')
            .filter(id__in=created_ids)
            .order_by('user__last_name', 'user__first_name', 'user__username')
        )
        return Response(
            {
                'added_count': len(members),
                'members': CourseGroupMemberSerializer(members, many=True).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=['delete'],
        permission_classes=[IsAuthenticated],
        url_path=r'groups/items/(?P<group_id>[^/.]+)/members/(?P<member_id>[^/.]+)',
    )
    def remove_group_member(self, request, pk=None, group_id=None, member_id=None):
        course = self.get_object()
        if not self._can_manage_groups(request.user, course):
            return Response({'detail': 'Not authorized to manage groups.'}, status=status.HTTP_403_FORBIDDEN)

        member = (
            GroupMember.objects.select_related('group')
            .filter(id=member_id, group_id=group_id, group__course=course)
            .first()
        )
        if not member:
            return Response({'detail': 'Group member not found.'}, status=status.HTTP_404_NOT_FOUND)

        member.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='grades',
    )
    def grades(self, request, pk=None):
        course = self.get_object()
        user = request.user
        view_mode = (request.query_params.get('view') or 'overall').strip().lower()

        can_view_all = self._can_view_grades(user, course)
        if not can_view_all:
            is_member = Enrollment.objects.filter(
                course=course,
                user=user,
                status=EnrollmentStatus.ACTIVE,
            ).exists()
            if not is_member:
                return Response({'detail': 'Not authorized to view grades.'}, status=status.HTTP_403_FORBIDDEN)

        if view_mode == 'student':
            if not can_view_all:
                return Response({'detail': 'Not authorized to view student gradebook.'}, status=status.HTTP_403_FORBIDDEN)
            target_user_id = request.query_params.get('user_id')
            if not target_user_id:
                return Response({'detail': 'user_id is required for student gradebook view.'}, status=status.HTTP_400_BAD_REQUEST)
            target_enrollment = (
                Enrollment.objects.select_related('user')
                .filter(
                    course=course,
                    status=EnrollmentStatus.ACTIVE,
                    role=EnrollmentRole.STUDENT,
                    user_id=target_user_id,
                )
                .first()
            )
            if not target_enrollment:
                return Response({'detail': 'Student not found for this course.'}, status=status.HTTP_404_NOT_FOUND)

            rows = self._build_student_assignment_rows(course, target_enrollment.user)
            serializer = CourseAssignmentGradeSerializer(rows, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)

        if view_mode == 'assignment':
            if not can_view_all:
                return Response({'detail': 'Not authorized to view assignment gradebook.'}, status=status.HTTP_403_FORBIDDEN)
            assignment_id = request.query_params.get('assignment_id')
            if not assignment_id:
                return Response({'detail': 'assignment_id is required for assignment gradebook view.'}, status=status.HTTP_400_BAD_REQUEST)
            assignment = Assignment.objects.filter(id=assignment_id, course=course).first()
            if not assignment:
                return Response({'detail': 'Assignment not found for this course.'}, status=status.HTTP_404_NOT_FOUND)

            enrollments = (
                Enrollment.objects.select_related('user', 'user__profile')
                .filter(course=course, status=EnrollmentStatus.ACTIVE, role=EnrollmentRole.STUDENT)
                .order_by('user__last_name', 'user__first_name', 'user__username')
            )
            latest_submissions = self._build_latest_submission_map(
                course,
                student_ids=[enrollment.user_id for enrollment in enrollments],
                assignment_ids=[assignment.id],
            )

            rows = []
            for enrollment in enrollments:
                profile = getattr(enrollment.user, 'profile', None)
                latest = latest_submissions.get((enrollment.user_id, assignment.id))
                score = Decimal('0')
                max_score = Decimal(str(assignment.max_score or 0))
                status_value = 'NOT_SUBMITTED'
                grade_state = self._resolve_grade_state(assignment, latest)
                attempt_number = None
                submitted_at = None
                feedback = ''
                submission_context = self._build_submission_context_payload(latest)

                if latest:
                    status_value = latest.status
                    attempt_number = latest.attempt_number
                    submitted_at = latest.submitted_at
                    if hasattr(latest, 'grade') and latest.grade:
                        score = latest.grade.score
                        max_score = latest.grade.max_score or max_score
                        feedback = latest.grade.feedback or ''

                percent = float((score / max_score) * 100) if max_score > 0 else 0.0
                rows.append(
                    {
                        'id': f'{assignment.id}:{enrollment.user_id}',
                        'assignment_id': assignment.id,
                        'assignment_title': assignment.title,
                        'due_at': assignment.due_at,
                        'user_id': enrollment.user_id,
                        'username': enrollment.user.username,
                        'email': enrollment.user.email or '',
                        'display_name': profile.display_name if profile and profile.display_name else enrollment.user.get_username(),
                        'cwid': profile.cwid if profile else '',
                        'grade_state': grade_state,
                        'status': status_value,
                        'attempt_number': attempt_number,
                        'submitted_at': submitted_at,
                        'score': score,
                        'max_score': max_score,
                        'percent': percent,
                        'feedback': feedback,
                        **submission_context,
                    }
                )

            serializer = CourseAssignmentStudentGradeSerializer(rows, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)

        if view_mode not in {'overall', ''}:
            return Response({'detail': 'Invalid view. Use overall, student, or assignment.'}, status=status.HTTP_400_BAD_REQUEST)

        if not can_view_all:
            rows = self._build_student_assignment_rows(course, user)
            serializer = CourseAssignmentGradeSerializer(rows, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)

        rows = self._build_overall_grade_rows(course)
        serializer = CourseGradeSummarySerializer(rows, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='grades/export',
    )
    def grades_export(self, request, pk=None):
        course = self.get_object()
        user = request.user
        if not self._can_view_grades(user, course):
            return Response({'detail': 'Not authorized to export grades.'}, status=status.HTTP_403_FORBIDDEN)

        view_mode = (request.query_params.get('view') or 'overall').strip().lower()
        if view_mode in {'overall', ''}:
            rows = self._build_overall_grade_rows(course)
            columns = [
                ('user_id', 'User ID'),
                ('username', 'Username'),
                ('display_name', 'Display Name'),
                ('email', 'Email'),
                ('cwid', 'CWID'),
                ('total_score', 'Total Score'),
                ('total_max_score', 'Total Max Score'),
                ('percent', 'Percent'),
            ]
            filename = f'course-{course.id}-overall-grades.csv'
            return self._build_csv_response(filename, columns, rows)

        if view_mode == 'student':
            target_user_id = request.query_params.get('user_id')
            if not target_user_id:
                return Response({'detail': 'user_id is required for student export view.'}, status=status.HTTP_400_BAD_REQUEST)
            target_enrollment = (
                Enrollment.objects.select_related('user')
                .filter(
                    course=course,
                    status=EnrollmentStatus.ACTIVE,
                    role=EnrollmentRole.STUDENT,
                    user_id=target_user_id,
                )
                .first()
            )
            if not target_enrollment:
                return Response({'detail': 'Student not found for this course.'}, status=status.HTTP_404_NOT_FOUND)

            rows = self._build_student_assignment_rows(course, target_enrollment.user)
            columns = [
                ('assignment_id', 'Assignment ID'),
                ('assignment_title', 'Assignment'),
                ('due_at', 'Due At'),
                ('status', 'Status'),
                ('attempt_number', 'Attempt'),
                ('submitted_at', 'Submitted At'),
                ('score', 'Score'),
                ('max_score', 'Max Score'),
                ('percent', 'Percent'),
            ]
            filename = f'course-{course.id}-student-{target_enrollment.user_id}-grades.csv'
            return self._build_csv_response(filename, columns, rows)

        return Response({'detail': 'Invalid view. Use overall or student.'}, status=status.HTTP_400_BAD_REQUEST)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='grades/report',
    )
    def grades_report(self, request, pk=None):
        course = self.get_object()
        user = request.user
        if not self._can_view_grades(user, course):
            return Response({'detail': 'Not authorized to view grade reports.'}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = CourseGradeReportRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        enrollments = self._resolve_report_students(course, payload['user_ids'])
        if enrollments is None:
            return Response({'detail': 'One or more selected students are not active students in this course.'}, status=status.HTTP_400_BAD_REQUEST)

        assignments = self._resolve_report_assignments(
            course,
            payload.get('assignment_ids', []),
            payload.get('include_all_assignments', True),
        )
        if assignments is None:
            return Response({'detail': 'One or more selected assignments do not belong to this course.'}, status=status.HTTP_400_BAD_REQUEST)

        report = self._build_grade_report(course, enrollments, assignments)
        return Response(report, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='grades/report/export',
    )
    def grades_report_export(self, request, pk=None):
        course = self.get_object()
        user = request.user
        if not self._can_view_grades(user, course):
            return Response({'detail': 'Not authorized to export grade reports.'}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = CourseGradeReportRequestSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        enrollments = self._resolve_report_students(course, payload['user_ids'])
        if enrollments is None:
            return Response({'detail': 'One or more selected students are not active students in this course.'}, status=status.HTTP_400_BAD_REQUEST)

        assignments = self._resolve_report_assignments(
            course,
            payload.get('assignment_ids', []),
            payload.get('include_all_assignments', True),
        )
        if assignments is None:
            return Response({'detail': 'One or more selected assignments do not belong to this course.'}, status=status.HTTP_400_BAD_REQUEST)

        report = self._build_grade_report(course, enrollments, assignments)
        rows, columns = self._build_grade_report_export_rows(report)
        filename = f'course-{course.id}-grade-report.csv'
        return self._build_csv_response(filename, columns, rows)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='grades/override',
    )
    def override_grade(self, request, pk=None):
        course = self.get_object()
        user = request.user
        if not self._can_view_grades(user, course):
            return Response({'detail': 'Not authorized to modify grades.'}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = CourseGradeOverrideSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        assignment = Assignment.objects.filter(id=payload['assignment_id'], course=course).first()
        if not assignment:
            return Response({'detail': 'Assignment not found for this course.'}, status=status.HTTP_404_NOT_FOUND)

        latest_submission = self._get_latest_submission_for_student_assignment(
            course,
            payload['user_id'],
            assignment,
        )
        if not latest_submission:
            return Response({'detail': 'No submission found for this student on this assignment.'}, status=status.HTTP_404_NOT_FOUND)

        grade, _ = Grade.objects.get_or_create(submission=latest_submission)
        grade.score = payload['score']
        grade.max_score = payload.get('max_score') or Decimal(str(assignment.max_score or 0))
        grade.save(update_fields=['score', 'max_score'])

        percent = float((grade.score / grade.max_score) * 100) if grade.max_score > 0 else 0.0
        return Response(
            {
                'assignment_id': str(assignment.id),
                'user_id': payload['user_id'],
                'submission_id': str(latest_submission.id),
                'score': grade.score,
                'max_score': grade.max_score,
                'percent': percent,
                'grade_state': 'GRADED',
                'status': latest_submission.status,
            },
            status=status.HTTP_200_OK,
        )

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
        if not is_self and not self._can_manage_people(request.user, course):
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
        if not self._can_manage_people(request.user, course):
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

    def _build_group_payload(self, course):
        group_sets = list(GroupSet.objects.filter(course=course).order_by('name'))
        group_set_ids = [group_set.id for group_set in group_sets]
        groups = []
        if group_set_ids:
            groups = list(
                Group.objects.filter(course=course, group_set_id__in=group_set_ids)
                .select_related('group_set')
                .prefetch_related('groupmember_set__user__profile')
                .order_by('name')
            )

        groups_by_set = {}
        for group in groups:
            prefetched_members = sorted(
                list(group.groupmember_set.all()),
                key=lambda member: (
                    getattr(getattr(member.user, 'profile', None), 'last_name', '') or member.user.last_name or '',
                    getattr(getattr(member.user, 'profile', None), 'first_name', '') or member.user.first_name or '',
                    member.user.username,
                ),
            )
            group.prefetched_members = prefetched_members
            groups_by_set.setdefault(group.group_set_id, []).append(group)

        for group_set in group_sets:
            group_set.prefetched_groups = groups_by_set.get(group_set.id, [])

        return {
            'group_sets': CourseGroupSetSerializer(group_sets, many=True).data,
        }

    def _build_student_assignment_rows(self, course, target_user):
        assignments = list(Assignment.objects.filter(course=course).order_by('due_at', 'created_at'))
        latest_submissions = self._build_latest_submission_map(
            course,
            student_ids=[target_user.id],
            assignment_ids=[assignment.id for assignment in assignments],
        )

        rows = []
        for assignment in assignments:
            assignment_max = Decimal(str(assignment.max_score or 0))
            latest = latest_submissions.get((target_user.id, assignment.id))
            score = Decimal('0')
            max_score = assignment_max
            status_value = 'NOT_SUBMITTED'
            attempt_number = None
            submitted_at = None
            feedback = ''
            submission_context = self._build_submission_context_payload(latest)

            if latest:
                status_value = latest.status
                attempt_number = latest.attempt_number
                submitted_at = latest.submitted_at
                if hasattr(latest, 'grade') and latest.grade:
                    score = latest.grade.score
                    max_score = latest.grade.max_score or assignment_max
                    feedback = latest.grade.feedback or ''

            percent = float((score / max_score) * 100) if max_score > 0 else 0.0
            rows.append(
                {
                    'id': assignment.id,
                    'assignment_id': assignment.id,
                    'assignment_title': assignment.title,
                    'due_at': assignment.due_at,
                    'status': status_value,
                    'attempt_number': attempt_number,
                    'submitted_at': submitted_at,
                    'score': score,
                    'max_score': max_score,
                    'percent': percent,
                    'feedback': feedback,
                    **submission_context,
                }
            )
        return rows

    def _resolve_report_students(self, course, user_ids):
        enrollments = list(
            Enrollment.objects.select_related('user', 'user__profile')
            .filter(
                course=course,
                status=EnrollmentStatus.ACTIVE,
                role=EnrollmentRole.STUDENT,
                user_id__in=user_ids,
            )
        )
        enrollment_by_user = {enrollment.user_id: enrollment for enrollment in enrollments}
        ordered = []
        for user_id in user_ids:
            enrollment = enrollment_by_user.get(user_id)
            if not enrollment:
                return None
            ordered.append(enrollment)
        return ordered

    def _resolve_report_assignments(self, course, assignment_ids, include_all_assignments):
        assignments = list(Assignment.objects.filter(course=course).order_by('due_at', 'created_at'))
        if include_all_assignments:
            return assignments

        assignment_ids = [str(assignment_id) for assignment_id in assignment_ids]
        assignment_by_id = {str(assignment.id): assignment for assignment in assignments}
        ordered = []
        for assignment_id in assignment_ids:
            assignment = assignment_by_id.get(assignment_id)
            if not assignment:
                return None
            ordered.append(assignment)
        return ordered

    def _build_latest_submission_map(self, course, student_ids=None, assignment_ids=None):
        latest_map = {}
        filters = Q(assignment__course=course)
        if assignment_ids:
            filters &= Q(assignment_id__in=assignment_ids)
        if student_ids:
            filters &= (
                Q(submitted_by_id__in=student_ids)
                | Q(group__groupmember__user_id__in=student_ids)
            )
        submissions = (
            Submission.objects.filter(filters)
            .select_related('grade', 'submitted_by', 'group')
            .prefetch_related('group__groupmember_set__user')
            .distinct()
            .order_by('assignment_id', '-attempt_number', '-submitted_at', '-id')
        )
        for submission in submissions:
            for owner_id in self._get_submission_owner_ids(submission):
                if student_ids and owner_id not in student_ids:
                    continue
                key = (owner_id, submission.assignment_id)
                if key not in latest_map:
                    latest_map[key] = submission
        return latest_map

    def _get_submission_owner_ids(self, submission):
        if submission.group_id:
            return [member.user_id for member in submission.group.groupmember_set.all()]
        return [submission.submitted_by_id]

    def _get_submission_group_member_usernames(self, submission):
        if not submission or not submission.group_id:
            return []
        return sorted(member.user.username for member in submission.group.groupmember_set.all())

    def _build_submission_context_payload(self, submission):
        if not submission:
            return {
                'group_name': '',
                'group_member_usernames': [],
                'submitted_by_username': '',
            }
        return {
            'group_name': submission.group.name if submission.group_id else '',
            'group_member_usernames': self._get_submission_group_member_usernames(submission),
            'submitted_by_username': submission.submitted_by.username if submission.submitted_by_id else '',
        }

    def _get_latest_submission_for_student_assignment(self, course, target_user_id, assignment):
        latest_map = self._build_latest_submission_map(
            course,
            student_ids=[target_user_id],
            assignment_ids=[assignment.id],
        )
        return latest_map.get((target_user_id, assignment.id))

    def _build_grade_report(self, course, enrollments, assignments):
        assignment_default_max = {
            assignment.id: Decimal(str(assignment.max_score or 0))
            for assignment in assignments
        }
        student_ids = [enrollment.user_id for enrollment in enrollments]
        assignment_ids = [assignment.id for assignment in assignments]
        latest_map = self._build_latest_submission_map(course, student_ids=student_ids, assignment_ids=assignment_ids)

        students_payload = []
        for enrollment in enrollments:
            profile = getattr(enrollment.user, 'profile', None)
            students_payload.append(
                {
                    'user_id': enrollment.user_id,
                    'username': enrollment.user.username,
                    'display_name': profile.display_name if profile and profile.display_name else enrollment.user.get_username(),
                    'email': enrollment.user.email or '',
                    'cwid': profile.cwid if profile else '',
                }
            )

        assignments_payload = [
            {
                'assignment_id': assignment.id,
                'title': assignment.title,
                'due_at': assignment.due_at,
                'max_score': assignment_default_max[assignment.id],
            }
            for assignment in assignments
        ]

        rows = []
        for enrollment in enrollments:
            profile = getattr(enrollment.user, 'profile', None)
            total_score = Decimal('0')
            total_max = Decimal('0')
            cells = {}
            for assignment in assignments:
                default_max = assignment_default_max[assignment.id]
                latest = latest_map.get((enrollment.user_id, assignment.id))
                score = Decimal('0')
                max_score = default_max
                status_value = 'NOT_SUBMITTED'
                attempt_number = None
                submitted_at = None
                feedback = ''
                if latest:
                    status_value = latest.status
                    attempt_number = latest.attempt_number
                    submitted_at = latest.submitted_at
                    if hasattr(latest, 'grade') and latest.grade:
                        score = latest.grade.score
                        max_score = latest.grade.max_score or default_max
                        feedback = latest.grade.feedback or ''
                grade_state = self._resolve_grade_state(assignment, latest)
                percent = float((score / max_score) * 100) if max_score > 0 else 0.0
                total_score += score
                total_max += max_score
                cells[str(assignment.id)] = {
                    'assignment_id': assignment.id,
                    'assignment_title': assignment.title,
                    'due_at': assignment.due_at,
                    'grade_state': grade_state,
                    'status': status_value,
                    'attempt_number': attempt_number,
                    'submitted_at': submitted_at,
                    'score': score,
                    'max_score': max_score,
                    'percent': percent,
                    'feedback': feedback,
                    **self._build_submission_context_payload(latest),
                }

            rows.append(
                {
                    'id': enrollment.user_id,
                    'user_id': enrollment.user_id,
                    'username': enrollment.user.username,
                    'display_name': profile.display_name if profile and profile.display_name else enrollment.user.get_username(),
                    'email': enrollment.user.email or '',
                    'cwid': profile.cwid if profile else '',
                    'total_score': total_score,
                    'total_max_score': total_max,
                    'percent': float((total_score / total_max) * 100) if total_max > 0 else 0.0,
                    'cells': cells,
                }
            )

        return {
            'students': students_payload,
            'assignments': assignments_payload,
            'rows': rows,
        }

    def _build_grade_report_export_rows(self, report):
        assignments = report.get('assignments', [])
        rows = []
        columns = [
            ('user_id', 'User ID'),
            ('username', 'Username'),
            ('display_name', 'Display Name'),
            ('email', 'Email'),
            ('cwid', 'CWID'),
            ('total_score', 'Total Score'),
            ('total_max_score', 'Total Max Score'),
            ('percent', 'Total Percent'),
        ]
        for assignment in assignments:
            assignment_key = str(assignment['assignment_id'])
            title = assignment['title']
            columns.extend(
                [
                    (f'{assignment_key}__score', f'{title} Score'),
                    (f'{assignment_key}__max', f'{title} Max Score'),
                    (f'{assignment_key}__percent', f'{title} Percent'),
                    (f'{assignment_key}__grade_state', f'{title} Grade Status'),
                    (f'{assignment_key}__status', f'{title} Run Status'),
                ]
            )

        for row in report.get('rows', []):
            export_row = {
                'user_id': row['user_id'],
                'username': row['username'],
                'display_name': row['display_name'],
                'email': row['email'],
                'cwid': row['cwid'],
                'total_score': row['total_score'],
                'total_max_score': row['total_max_score'],
                'percent': row['percent'],
            }
            cells = row.get('cells', {})
            for assignment in assignments:
                assignment_key = str(assignment['assignment_id'])
                cell = cells.get(assignment_key, {})
                export_row[f'{assignment_key}__score'] = cell.get('score', Decimal('0'))
                export_row[f'{assignment_key}__max'] = cell.get('max_score', Decimal('0'))
                export_row[f'{assignment_key}__percent'] = cell.get('percent', 0.0)
                export_row[f'{assignment_key}__grade_state'] = cell.get('grade_state', '')
                export_row[f'{assignment_key}__status'] = cell.get('status', '')
            rows.append(export_row)

        return rows, columns

    def _resolve_grade_state(self, assignment, latest_submission):
        if latest_submission:
            if hasattr(latest_submission, 'grade') and latest_submission.grade:
                return 'GRADED'
            return 'UNGRADED'
        if assignment.due_at and assignment.due_at < timezone.now():
            return 'MISSING'
        return 'NOT_SUBMITTED'

    def _build_overall_grade_rows(self, course):
        enrollments = list(
            Enrollment.objects.select_related('user', 'user__profile')
            .filter(course=course, status=EnrollmentStatus.ACTIVE, role=EnrollmentRole.STUDENT)
            .order_by('user__last_name', 'user__first_name', 'user__username')
        )
        assignments = list(Assignment.objects.filter(course=course).order_by('due_at', 'created_at'))
        assignment_default_max = {
            assignment.id: Decimal(str(assignment.max_score or 0))
            for assignment in assignments
        }
        student_ids = [enrollment.user_id for enrollment in enrollments]
        latest_by_student_assignment = self._build_latest_submission_map(
            course,
            student_ids=student_ids,
            assignment_ids=[assignment.id for assignment in assignments],
        )

        rows = []
        for enrollment in enrollments:
            profile = getattr(enrollment.user, 'profile', None)
            total_score = Decimal('0')
            total_max = Decimal('0')
            for assignment in assignments:
                default_max = assignment_default_max[assignment.id]
                latest = latest_by_student_assignment.get((enrollment.user_id, assignment.id))
                score = Decimal('0')
                max_score = default_max
                if latest and hasattr(latest, 'grade') and latest.grade:
                    score = latest.grade.score
                    max_score = latest.grade.max_score or default_max
                total_score += score
                total_max += max_score

            percent = float((total_score / total_max) * 100) if total_max > 0 else 0.0
            rows.append(
                {
                    'id': enrollment.user_id,
                    'user_id': enrollment.user_id,
                    'username': enrollment.user.username,
                    'email': enrollment.user.email or '',
                    'display_name': profile.display_name if profile and profile.display_name else enrollment.user.get_username(),
                    'cwid': profile.cwid if profile else '',
                    'total_score': total_score,
                    'total_max_score': total_max,
                    'percent': percent,
                }
            )
        return rows

    def _build_csv_response(self, filename, columns, rows):
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow([label for _key, label in columns])
        for row in rows:
            values = []
            for key, _label in columns:
                value = row.get(key)
                if value is None:
                    values.append('')
                    continue
                if isinstance(value, Decimal):
                    values.append(f'{value:.2f}')
                    continue
                if hasattr(value, 'isoformat'):
                    values.append(value.isoformat())
                    continue
                values.append(str(value))
            writer.writerow(values)

        response = HttpResponse(buffer.getvalue(), content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    def _can_manage_people(self, user, course):
        if user.is_superuser:
            return True
        if user.groups.filter(name='Instructor').exists():
            return True
        return Enrollment.objects.filter(
            course=course,
            user=user,
            status=EnrollmentStatus.ACTIVE,
            role__in=[EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA],
        ).exists()

    def _can_manage_groups(self, user, course):
        return self._can_manage_people(user, course)

    def _can_manage_course(self, user, course):
        if user.is_superuser:
            return True
        return course.created_by_id == user.id

    def _can_view_grades(self, user, course):
        if user.is_superuser:
            return True
        if user.groups.filter(name='Instructor').exists():
            return True
        return Enrollment.objects.filter(
            course=course,
            user=user,
            status=EnrollmentStatus.ACTIVE,
            role__in=[EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA, EnrollmentRole.GRADER],
        ).exists()


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
