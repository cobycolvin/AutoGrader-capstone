import base64
import mimetypes
import os
import zipfile
from decimal import Decimal
from django.db.models import Q

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.decorators import action

from ..grader.runner import (
    get_submission_console_spec,
    get_submission_file_run_spec,
    run_submission_console,
    run_submission_file_preview,
)
from ..models import (
    AIDetectionScan,
    AIDetectionStatus,
    Assignment,
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    Grade,
    GroupMember,
    Rubric,
    RubricCriterion,
    RubricScore,
    RubricVersion,
    Submission,
    SubmissionStatus,
    GradingRun,
    TestResult,
)
from ..serializers.submissions import (
    AIDetectionScanSerializer,
    SubmissionSerializer,
    SubmissionDetailSerializer,
    SubmissionGradeOverrideSerializer,
    SubmissionConsoleRunSerializer,
    SubmissionFileRunSerializer,
    SubmissionRubricGradeSerializer,
    build_submission_rubric_payload,
)
from ..services.ai_detection import run_ai_detection

MAX_SUBMISSION_PREVIEW_BYTES = 5 * 1024 * 1024


def _safe_archive_entry_name(path):
    normalized = (path or '').replace('\\', '/').strip()
    if not normalized:
        return ''
    if normalized.startswith('/'):
        return ''
    parts = [part for part in normalized.split('/') if part not in {'', '.'}]
    if not parts or any(part == '..' for part in parts):
        return ''
    return '/'.join(parts)


class SubmissionViewSet(viewsets.ModelViewSet):
    serializer_class = SubmissionSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = (
            Submission.objects.select_related('assignment', 'submitted_by', 'grade', 'group')
            .prefetch_related('group__groupmember_set__user')
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
            return qs.filter(Q(submitted_by=user) | Q(group__groupmember__user=user)).distinct()

        if user.is_superuser:
            return qs

        course_ids = Enrollment.objects.filter(
            user=user,
            status=EnrollmentStatus.ACTIVE,
        ).values_list('course_id', flat=True)
        return qs.filter(
            assignment__course_id__in=course_ids,
        ).filter(Q(submitted_by=user) | Q(group__groupmember__user=user)).distinct()

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
        submission = (
            Submission.objects.select_related('assignment', 'submitted_by', 'grade')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)
        course_id = submission.assignment.course_id
        if not self._can_view_submission(request.user, submission):
            raise PermissionDenied('Not authorized to view this submission.')

        latest_run = (
            GradingRun.objects.filter(submission=submission).order_by('-started_at').first()
        )
        test_results = []
        if latest_run:
            test_results = TestResult.objects.filter(grading_run=latest_run).order_by('created_at')

        submission._latest_grading_run = latest_run
        submission._latest_test_results = test_results
        submission._rubric_payload = build_submission_rubric_payload(submission)

        serializer = SubmissionDetailSerializer(submission)
        payload = serializer.data
        payload['permissions'] = {
            'can_edit_grade': self._can_view_all(request.user, course_id),
            'can_rerun': self._can_rerun_submission(request.user, submission),
        }
        payload['console'] = get_submission_console_spec(submission)
        payload['file_run'] = get_submission_file_run_spec(submission)
        return Response(payload, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='manifest',
    )
    def manifest(self, request, pk=None):
        submission = (
            Submission.objects.select_related('assignment', 'submitted_by')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)

        course_id = submission.assignment.course_id
        if not self._can_view_submission(request.user, submission):
            raise PermissionDenied('Not authorized to view this submission.')

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            file_path = storage.path(submission.source_bundle_key)
        except Exception:
            return Response({'detail': 'Unable to locate submission file.'}, status=status.HTTP_404_NOT_FOUND)
        if not os.path.exists(file_path):
            return Response({'detail': 'Submission file missing.'}, status=status.HTTP_404_NOT_FOUND)

        files = []
        total_size = 0
        is_archive = zipfile.is_zipfile(file_path)
        if is_archive:
            try:
                with zipfile.ZipFile(file_path, 'r') as zip_ref:
                    for info in zip_ref.infolist():
                        is_dir = info.is_dir()
                        files.append(
                            {
                                'name': info.filename,
                                'size': info.file_size,
                                'compressed_size': info.compress_size,
                                'is_dir': is_dir,
                            }
                        )
                        if not is_dir:
                            total_size += info.file_size
            except zipfile.BadZipFile:
                return Response({'detail': 'Invalid zip file.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            size = os.path.getsize(file_path)
            filename = os.path.basename(file_path)
            files.append(
                {
                    'name': filename,
                    'size': size,
                    'compressed_size': size,
                    'is_dir': False,
                }
            )
            total_size = size

        return Response(
            {
                'submission_id': str(submission.id),
                'is_archive': is_archive,
                'file_count': len(files),
                'total_size': total_size,
                'files': files[:300],
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='file',
    )
    def file_preview(self, request, pk=None):
        submission = (
            Submission.objects.select_related('assignment', 'submitted_by')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)

        course_id = submission.assignment.course_id
        if not self._can_view_submission(request.user, submission):
            raise PermissionDenied('Not authorized to view this submission.')

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            file_path = storage.path(submission.source_bundle_key)
        except Exception:
            return Response({'detail': 'Unable to locate submission file.'}, status=status.HTTP_404_NOT_FOUND)
        if not os.path.exists(file_path):
            return Response({'detail': 'Submission file missing.'}, status=status.HTTP_404_NOT_FOUND)

        entry_name = _safe_archive_entry_name(request.query_params.get('name'))
        is_archive = zipfile.is_zipfile(file_path)
        info_name = ''
        info_size = 0
        if is_archive:
            if not entry_name:
                return Response({'detail': 'name query parameter is required.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                with zipfile.ZipFile(file_path, 'r') as zip_ref:
                    try:
                        info = zip_ref.getinfo(entry_name)
                    except KeyError:
                        return Response({'detail': 'File not found in submission bundle.'}, status=status.HTTP_404_NOT_FOUND)
                    if info.is_dir():
                        return Response({'detail': 'Cannot preview directory entries.'}, status=status.HTTP_400_BAD_REQUEST)
                    read_limit = MAX_SUBMISSION_PREVIEW_BYTES + 1
                    with zip_ref.open(info, 'r') as entry_handle:
                        raw_content = entry_handle.read(read_limit)
                    info_name = info.filename
                    info_size = info.file_size
            except zipfile.BadZipFile:
                return Response({'detail': 'Invalid zip file.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            file_name = os.path.basename(file_path)
            if entry_name and entry_name != file_name:
                return Response({'detail': 'File not found in submission bundle.'}, status=status.HTTP_404_NOT_FOUND)
            read_limit = MAX_SUBMISSION_PREVIEW_BYTES + 1
            with open(file_path, 'rb') as handle:
                raw_content = handle.read(read_limit)
            info_name = file_name
            info_size = os.path.getsize(file_path)

        truncated = len(raw_content) > MAX_SUBMISSION_PREVIEW_BYTES
        if truncated:
            raw_content = raw_content[:MAX_SUBMISSION_PREVIEW_BYTES]

        mime_type = mimetypes.guess_type(info_name)[0] or 'application/octet-stream'
        is_text = mime_type.startswith('text/')
        if not is_text:
            text_extensions = {
                '.py', '.json', '.md', '.txt', '.yaml', '.yml', '.xml', '.csv',
                '.java', '.js', '.ts', '.jsx', '.tsx', '.c', '.cpp', '.h', '.hpp',
                '.cs', '.go', '.rs', '.kt', '.swift', '.sh', '.sql',
            }
            ext = os.path.splitext(info_name)[1].lower()
            is_text = ext in text_extensions and b'\x00' not in raw_content

        if is_text:
            content = raw_content.decode('utf-8', errors='replace')
            encoding = 'utf-8'
        else:
            content = base64.b64encode(raw_content).decode('ascii')
            encoding = 'base64'

        return Response(
            {
                'submission_id': str(submission.id),
                'name': info_name,
                'size': info_size,
                'truncated': truncated,
                'max_preview_bytes': MAX_SUBMISSION_PREVIEW_BYTES,
                'mime_type': mime_type,
                'encoding': encoding,
                'is_text': is_text,
                'content': content,
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='console-run',
    )
    def console_run(self, request, pk=None):
        submission = (
            Submission.objects.select_related('assignment', 'submitted_by', 'assignment__language')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)

        course_id = submission.assignment.course_id
        if not self._can_view_submission(request.user, submission):
            raise PermissionDenied('Not authorized to run this submission.')

        input_serializer = SubmissionConsoleRunSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        capability = get_submission_console_spec(submission)
        if not capability.get('available'):
            return Response(
                {'detail': capability.get('reason') or 'Interactive console is not available for this submission.'},
                status=status.HTTP_409_CONFLICT,
            )

        result = run_submission_console(
            submission_id=submission.id,
            stdin_text=payload.get('stdin', ''),
            timeout_seconds=(payload.get('timeout_ms') or 5000) / 1000,
        )
        response_payload = {
            'submission_id': str(submission.id),
            'entry_label': result.get('entry_label') or capability.get('entry_label') or '',
            'command_preview': result.get('command_preview') or capability.get('command_preview') or '',
            'stdout': result.get('stdout') or '',
            'stderr': result.get('stderr') or '',
            'stdout_truncated': bool(result.get('stdout_truncated')),
            'stderr_truncated': bool(result.get('stderr_truncated')),
            'exit_status': result.get('exit_status'),
            'returncode': result.get('returncode'),
            'duration_ms': result.get('duration_ms'),
        }
        return Response(response_payload, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='file-run',
    )
    def file_run(self, request, pk=None):
        submission = (
            Submission.objects.select_related('assignment', 'submitted_by', 'assignment__language')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)

        course_id = submission.assignment.course_id
        if not self._can_view_submission(request.user, submission):
            raise PermissionDenied('Not authorized to run this submission.')

        input_serializer = SubmissionFileRunSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        capability = get_submission_file_run_spec(submission)
        if not capability.get('available'):
            return Response(
                {'detail': capability.get('reason') or 'Try files is not available for this submission.'},
                status=status.HTTP_409_CONFLICT,
            )

        result = run_submission_file_preview(
            submission_id=submission.id,
            args=payload.get('args') or [],
            input_files=payload.get('input_files') or [],
            stdin_text=payload.get('stdin', ''),
            timeout_seconds=(payload.get('timeout_ms') or capability.get('default_timeout_ms') or 5000) / 1000,
        )
        response_payload = {
            'submission_id': str(submission.id),
            'entry_label': result.get('entry_label') or capability.get('entry_label') or '',
            'command_preview': result.get('command_preview') or capability.get('command_preview') or '',
            'stdout': result.get('stdout') or '',
            'stderr': result.get('stderr') or '',
            'stdout_truncated': bool(result.get('stdout_truncated')),
            'stderr_truncated': bool(result.get('stderr_truncated')),
            'exit_status': result.get('exit_status'),
            'returncode': result.get('returncode'),
            'duration_ms': result.get('duration_ms'),
            'produced_files': result.get('produced_files') or [],
        }
        return Response(response_payload, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='rerun',
    )
    def rerun(self, request, pk=None):
        submission = (
            Submission.objects.select_related('assignment', 'submitted_by')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not self._can_view_all(request.user, submission.assignment.course_id):
            return Response({'detail': 'Not authorized to rerun this submission.'}, status=status.HTTP_403_FORBIDDEN)

        if submission.status == SubmissionStatus.RUNNING:
            return Response({'detail': 'Submission is already running.'}, status=status.HTTP_409_CONFLICT)
        if submission.status == SubmissionStatus.QUEUED:
            return Response({'detail': 'Submission is already queued.'}, status=status.HTTP_409_CONFLICT)

        submission.status = SubmissionStatus.QUEUED
        submission.save(update_fields=['status'])

        return Response(
            {
                'submission_id': str(submission.id),
                'status': submission.status,
                'detail': 'Submission queued for rerun.',
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='grade',
    )
    def override_grade(self, request, pk=None):
        submission = (
            Submission.objects.select_related('assignment', 'submitted_by', 'grade')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)

        course_id = submission.assignment.course_id
        if not self._can_view_all(request.user, course_id):
            return Response({'detail': 'Not authorized to modify grades.'}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = SubmissionGradeOverrideSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        grade, _ = Grade.objects.get_or_create(submission=submission)
        grade.score = payload['score']
        feedback = payload.get('feedback')
        if feedback is not None:
            grade.feedback = feedback

        max_score = payload.get('max_score')
        if max_score is None:
            if grade.max_score and grade.max_score > 0:
                max_score = grade.max_score
            else:
                max_score = submission.assignment.max_score or 0
        grade.max_score = max_score
        update_fields = ['score', 'max_score']
        if feedback is not None:
            update_fields.append('feedback')
        grade.save(update_fields=update_fields)

        percent = float((grade.score / grade.max_score) * 100) if grade.max_score > 0 else 0.0
        return Response(
            {
                'submission_id': str(submission.id),
                'assignment_id': str(submission.assignment_id),
                'user_id': submission.submitted_by_id,
                'score': grade.score,
                'max_score': grade.max_score,
                'feedback': grade.feedback,
                'percent': percent,
                'grade_state': 'GRADED',
                'status': submission.status,
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='rubric-grade',
    )
    def save_rubric_grade(self, request, pk=None):
        submission = (
            Submission.objects.select_related('assignment', 'submitted_by', 'grade')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)

        course_id = submission.assignment.course_id
        if not self._can_view_all(request.user, course_id):
            return Response({'detail': 'Not authorized to modify rubric grades.'}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = SubmissionRubricGradeSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        rubric = Rubric.objects.filter(assignment=submission.assignment).select_related('active_version').first()
        if not rubric:
            return Response({'detail': 'Rubric not found for this assignment.'}, status=status.HTTP_404_NOT_FOUND)

        rubric_version_id = payload.get('rubric_version_id') or getattr(rubric.active_version, 'id', None)
        rubric_version = RubricVersion.objects.filter(id=rubric_version_id, rubric=rubric).first()
        if not rubric_version:
            return Response({'detail': 'Rubric version not found.'}, status=status.HTTP_404_NOT_FOUND)

        criteria = list(RubricCriterion.objects.filter(rubric_version=rubric_version).order_by('order_index', 'created_at'))
        criteria_by_id = {str(criterion.id): criterion for criterion in criteria}
        incoming = payload.get('criteria') or []
        if len(incoming) != len(criteria):
            return Response(
                {'detail': 'Rubric grade must include every criterion in the selected rubric version.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        seen = set()
        normalized_entries = []
        for entry in incoming:
            criterion_id = str(entry.get('criterion_id'))
            criterion = criteria_by_id.get(criterion_id)
            if not criterion:
                return Response(
                    {'detail': 'One or more rubric criteria do not belong to this rubric version.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if criterion_id in seen:
                return Response({'detail': 'Duplicate rubric criterion provided.'}, status=status.HTTP_400_BAD_REQUEST)
            seen.add(criterion_id)
            points_awarded = entry.get('points_awarded') or Decimal('0')
            if points_awarded > criterion.max_points:
                return Response(
                    {'detail': f'Points for "{criterion.name}" cannot exceed {criterion.max_points}.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            normalized_entries.append(
                {
                    'criterion': criterion,
                    'points_awarded': points_awarded,
                    'comment': entry.get('comment', ''),
                }
            )

        RubricScore.objects.filter(submission=submission).delete()
        RubricScore.objects.bulk_create(
            [
                RubricScore(
                    submission=submission,
                    grading_run=None,
                    rubric_criterion=entry['criterion'],
                    points_awarded=entry['points_awarded'],
                    comment=entry['comment'],
                    created_by=request.user,
                )
                for entry in normalized_entries
            ]
        )

        rubric_payload = build_submission_rubric_payload(submission)
        grade, _ = Grade.objects.get_or_create(submission=submission)
        grade.score = rubric_payload['computed_score']
        grade.max_score = rubric_payload['computed_max_score']
        grade.save(update_fields=['score', 'max_score'])

        percent = float((grade.score / grade.max_score) * 100) if grade.max_score > 0 else 0.0
        return Response(
            {
                'submission_id': str(submission.id),
                'rubric': rubric_payload,
                'grade': {
                    'score': grade.score,
                    'max_score': grade.max_score,
                    'feedback': grade.feedback,
                    'percent': percent,
                },
            },
            status=status.HTTP_200_OK,
        )

    def _can_submit(self, user, course_id):
        if user.is_superuser:
            return True
        if user.groups.filter(name='Instructor').exists():
            return True
        return Enrollment.objects.filter(
            course_id=course_id,
            user=user,
            status=EnrollmentStatus.ACTIVE,
            role__in=[EnrollmentRole.STUDENT, EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA],
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
            role__in=[EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA, EnrollmentRole.GRADER],
        ).exists()

    def _can_rerun_submission(self, user, submission):
        return (
            self._can_view_all(user, submission.assignment.course_id)
            and submission.status not in {SubmissionStatus.QUEUED, SubmissionStatus.RUNNING}
        )

    def _can_view_submission(self, user, submission):
        if self._can_view_all(user, submission.assignment.course_id):
            return True
        if submission.submitted_by_id == user.id:
            return True
        if submission.group_id:
            return GroupMember.objects.filter(group_id=submission.group_id, user=user).exists()
        return False

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='ai-scan',
    )
    def ai_scan(self, request, pk=None):
        submission = (
            Submission.objects.select_related('assignment')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not self._can_view_all(request.user, submission.assignment.course_id):
            return Response({'detail': 'Not authorized.'}, status=status.HTTP_403_FORBIDDEN)

        # Check if a scan is already running
        running = AIDetectionScan.objects.filter(
            submission=submission,
            status__in=[AIDetectionStatus.PENDING, AIDetectionStatus.RUNNING],
        ).first()
        if running:
            return Response(
                {'detail': 'A scan is already in progress.'},
                status=status.HTTP_409_CONFLICT,
            )

        scan = AIDetectionScan.objects.create(
            submission=submission,
            requested_by=request.user,
        )

        run_ai_detection(scan)

        scan.refresh_from_db()
        return Response(AIDetectionScanSerializer(scan).data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='ai-scan/latest',
    )
    def ai_scan_latest(self, request, pk=None):
        submission = (
            Submission.objects.select_related('assignment')
            .filter(pk=pk)
            .first()
        )
        if not submission:
            return Response({'detail': 'Submission not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not self._can_view_all(request.user, submission.assignment.course_id):
            return Response({'detail': 'Not authorized.'}, status=status.HTTP_403_FORBIDDEN)

        scan = (
            AIDetectionScan.objects.prefetch_related('findings')
            .filter(submission=submission)
            .order_by('-created_at')
            .first()
        )
        if not scan:
            return Response({'detail': 'No scan found for this submission.'}, status=status.HTTP_404_NOT_FOUND)

        return Response(AIDetectionScanSerializer(scan).data, status=status.HTTP_200_OK)
