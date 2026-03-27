from decimal import Decimal

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    Assignment,
    Grade,
    GradingExitStatus,
    GradingRun,
    Rubric,
    RubricCriterion,
    RubricScore,
    RubricVersion,
    Submission,
    SubmissionStatus,
)
from ..permissions import IsSuperuser
from ..serializers.assignments import (
    AssignmentSerializer,
    RubricCriterionSerializer,
    SubmissionSerializer,
)
from ..services.ai_grader import grade_submission


class AssignmentViewSet(viewsets.ModelViewSet):
    """CRUD for assignments. Instructors (superusers) only."""

    queryset = Assignment.objects.select_related('course').order_by('due_at')
    serializer_class = AssignmentSerializer
    permission_classes = [IsSuperuser]

    @action(detail=True, methods=['get'], url_path='rubric')
    def rubric_criteria(self, request, pk=None):
        """Return rubric criteria for this assignment."""
        assignment = self.get_object()
        try:
            rubric = Rubric.objects.get(assignment=assignment)
            version = rubric.active_version
            if not version:
                return Response({'criteria': []})
            criteria = RubricCriterion.objects.filter(rubric_version=version).order_by('order_index')
            return Response({'criteria': RubricCriterionSerializer(criteria, many=True).data})
        except Rubric.DoesNotExist:
            return Response({'criteria': []})


class SubmissionViewSet(viewsets.ModelViewSet):
    """Submit work and trigger AI grading."""

    serializer_class = SubmissionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.is_superuser:
            return Submission.objects.select_related('assignment', 'submitted_by').order_by('-submitted_at')
        return Submission.objects.filter(submitted_by=user).select_related('assignment').order_by('-submitted_at')

    def perform_create(self, serializer):
        assignment = serializer.validated_data['assignment']
        last = (
            Submission.objects.filter(assignment=assignment, submitted_by=self.request.user)
            .order_by('-attempt_number')
            .first()
        )
        attempt = (last.attempt_number + 1) if last else 1
        serializer.save(submitted_by=self.request.user, attempt_number=attempt)

    @action(detail=True, methods=['post'], url_path='grade')
    def ai_grade(self, request, pk=None):
        """
        Trigger AI grading for this submission.

        Requires the assignment to have an active rubric with at least one criterion.
        The submission must have content.
        """
        submission = self.get_object()

        if not submission.content.strip():
            return Response(
                {'error': 'Submission has no content to grade.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            rubric = Rubric.objects.get(assignment=submission.assignment)
        except Rubric.DoesNotExist:
            return Response(
                {'error': 'No rubric found for this assignment.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        rubric_version = rubric.active_version
        if not rubric_version:
            return Response(
                {'error': 'Rubric has no active version.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        criteria_qs = RubricCriterion.objects.filter(rubric_version=rubric_version).order_by('order_index')
        if not criteria_qs.exists():
            return Response(
                {'error': 'Rubric has no criteria.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        criteria = [
            {'id': str(c.id), 'name': c.name, 'max_points': float(c.max_points)}
            for c in criteria_qs
        ]

        # Mark as running
        submission.status = SubmissionStatus.RUNNING
        submission.save(update_fields=['status'])

        try:
            ai_results = grade_submission(
                submission_content=submission.content,
                assignment_title=submission.assignment.title,
                criteria=criteria,
            )
        except Exception as exc:
            submission.status = SubmissionStatus.FAILED
            submission.save(update_fields=['status'])
            return Response({'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        # Save grading run
        grading_run = GradingRun.objects.create(
            submission=submission,
            rubric_version=rubric_version,
            worker_id='ai-claude',
            started_at=timezone.now(),
            finished_at=timezone.now(),
            exit_status=GradingExitStatus.OK,
        )

        total_score = Decimal('0')
        max_score = Decimal('0')
        rubric_scores = []

        for result in ai_results:
            criterion = criteria_qs.filter(id=result['criterion_id']).first()
            if not criterion:
                continue
            points = Decimal(str(result['points_awarded']))
            RubricScore.objects.create(
                grading_run=grading_run,
                rubric_criterion=criterion,
                points_awarded=points,
                comment=result.get('comment', ''),
            )
            rubric_scores.append({
                'criterion': criterion.name,
                'points_awarded': float(points),
                'max_points': float(criterion.max_points),
                'comment': result.get('comment', ''),
            })
            total_score += points
            max_score += criterion.max_points

        # Save or update grade
        Grade.objects.update_or_create(
            submission=submission,
            defaults={
                'latest_grading_run': grading_run,
                'score': total_score,
                'max_score': max_score,
            },
        )

        submission.status = SubmissionStatus.GRADED
        submission.save(update_fields=['status'])

        return Response({
            'submission_id': str(submission.id),
            'status': 'GRADED',
            'score': float(total_score),
            'max_score': float(max_score),
            'percentage': round(float(total_score) / float(max_score) * 100, 1) if max_score else 0,
            'rubric_scores': rubric_scores,
        })
