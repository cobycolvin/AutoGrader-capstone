from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.decorators import action

from ..models import Assignment, Enrollment, EnrollmentRole, EnrollmentStatus, Submission, SubmissionStatus, GradingRun, TestResult
from ..serializers.submissions import SubmissionSerializer, SubmissionDetailSerializer


class SubmissionViewSet(viewsets.ModelViewSet):
    serializer_class = SubmissionSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        qs = (
            Submission.objects.select_related('assignment', 'submitted_by', 'grade')
            .order_by('-submitted_at')
        )
        assignment_id = self.request.query_params.get('assignment_id')
        course_id = self.request.query_params.get('course_id')
        user = self.request.user

        if assignment_id:
            qs = qs.filter(assignment_id=assignment_id)
            course_id = qs.values_list('assignment__course_id', flat=True).first()

        if course_id:
            qs = qs.filter(assignment__course_id=course_id)
            if self._can_view_all(user, course_id):
                return qs
            return qs.filter(submitted_by=user)

        if user.is_superuser:
            return qs

        course_ids = Enrollment.objects.filter(
            user=user,
            status=EnrollmentStatus.ACTIVE,
        ).values_list('course_id', flat=True)
        return qs.filter(assignment__course_id__in=course_ids, submitted_by=user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        assignment_id = serializer.validated_data.get('assignment_id')
        assignment = Assignment.objects.select_related('course').filter(id=assignment_id).first()
        if not assignment:
            return Response({'detail': 'Assignment not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not self._can_submit(request.user, assignment.course_id):
            raise PermissionDenied('Not authorized to submit for this course.')
        submission = serializer.save()
        submission.status = SubmissionStatus.QUEUED
        submission.save(update_fields=['status'])
        data = self.get_serializer(submission).data
        return Response(data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='details',
    )
    def details(self, request, pk=None):
        submission = self.get_object()
        course_id = submission.assignment.course_id
        if not self._can_view_all(request.user, course_id) and submission.submitted_by_id != request.user.id:
            raise PermissionDenied('Not authorized to view this submission.')

        latest_run = (
            GradingRun.objects.filter(submission=submission).order_by('-started_at').first()
        )
        test_results = []
        if latest_run:
            test_results = TestResult.objects.filter(grading_run=latest_run).order_by('created_at')

        submission._latest_grading_run = latest_run
        submission._latest_test_results = test_results

        serializer = SubmissionDetailSerializer(submission)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def _can_submit(self, user, course_id):
        if user.is_superuser:
            return True
        if user.groups.filter(name='Instructor').exists():
            return True
        return Enrollment.objects.filter(
            course_id=course_id,
            user=user,
            status=EnrollmentStatus.ACTIVE,
        ).exists()

    def _can_view_all(self, user, course_id):
        if user.is_superuser:
            return True
        if user.groups.filter(name='Instructor').exists():
            return True
        return Enrollment.objects.filter(
            course_id=course_id,
            user=user,
            status=EnrollmentStatus.ACTIVE,
            role__in=[EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA],
        ).exists()
