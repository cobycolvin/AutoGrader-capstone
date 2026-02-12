import hashlib
import os
import zipfile

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db.models import Max
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    Assignment,
    Course,
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    Rubric,
    RubricCriterion,
    RubricVersion,
    TestSuite,
    TestSuiteVisibility,
    TestSuiteVersion,
)
from ..serializers.assignments import AssignmentSerializer
from ..serializers.rubrics import RubricVersionInputSerializer, RubricVersionSerializer
from ..serializers.testsuites import TestSuiteVersionSerializer


class AssignmentViewSet(viewsets.ModelViewSet):
    serializer_class = AssignmentSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_queryset(self):
        qs = Assignment.objects.select_related('course', 'language').order_by('due_at', 'title')
        course_id = self.request.query_params.get('course_id')
        user = self.request.user

        if course_id:
            if self._is_course_member(user, course_id) or user.is_superuser:
                return qs.filter(course_id=course_id)
            return Assignment.objects.none()

        if user.is_superuser:
            return qs

        course_ids = Enrollment.objects.filter(
            user=user,
            status=EnrollmentStatus.ACTIVE,
        ).values_list('course_id', flat=True)
        return qs.filter(course_id__in=course_ids)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        course_id = serializer.validated_data.get('course_id')
        course = Course.objects.filter(id=course_id).first()
        if not course:
            return Response({'detail': 'Course not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not self._can_manage_assignments(request.user, course):
            raise PermissionDenied('Not authorized to create assignments for this course.')
        serializer.save(course=course, created_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        assignment = serializer.instance
        if not self._can_manage_assignments(self.request.user, assignment.course):
            raise PermissionDenied('Not authorized to update assignments for this course.')
        serializer.save()

    def perform_destroy(self, instance):
        if not self._can_manage_assignments(self.request.user, instance.course):
            raise PermissionDenied('Not authorized to delete assignments for this course.')
        instance.delete()

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites',
    )
    def test_suites(self, request, pk=None):
        assignment = self.get_object()
        if request.method == 'GET':
            if not (
                self._is_course_member(request.user, assignment.course_id)
                or request.user.is_superuser
                or request.user.groups.filter(name='Instructor').exists()
            ):
                raise PermissionDenied('Not authorized to view test suites.')
            visibility = (request.query_params.get('visibility') or '').strip().upper()
            test_suite = (
                TestSuite.objects.filter(assignment=assignment)
                .select_related('active_version')
                .first()
            )
            qs = TestSuiteVersion.objects.filter(test_suite__assignment=assignment).select_related('test_suite')
            if visibility in TestSuiteVisibility.values:
                qs = qs.filter(visibility=visibility)
            qs = qs.order_by('-created_at')
            serializer = TestSuiteVersionSerializer(
                qs,
                many=True,
                context={'active_version_id': test_suite.active_version_id if test_suite else None},
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to upload test suites.')

        upload = request.FILES.get('file')
        visibility = (request.data.get('visibility') or TestSuiteVisibility.PRIVATE).upper()
        if visibility not in TestSuiteVisibility.values:
            return Response({'detail': 'Invalid visibility.'}, status=status.HTTP_400_BAD_REQUEST)
        if not upload:
            return Response({'detail': 'File is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not zipfile.is_zipfile(upload):
            return Response({'detail': 'Test suite must be a .zip file.'}, status=status.HTTP_400_BAD_REQUEST)
        if hasattr(upload, 'seek'):
            upload.seek(0)

        test_suite, _ = TestSuite.objects.get_or_create(assignment=assignment)
        current_version = (
            TestSuiteVersion.objects.filter(test_suite=test_suite, visibility=visibility)
            .aggregate(max_version=Max('version_number'))
            .get('max_version')
            or 0
        )
        next_version = current_version + 1

        hasher = hashlib.sha256()
        for chunk in upload.chunks():
            hasher.update(chunk)
        checksum = hasher.hexdigest()
        if hasattr(upload, 'seek'):
            upload.seek(0)

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        filename = f"v{next_version}_{upload.name}"
        path = os.path.join('test_suites', str(assignment.id), visibility.lower(), filename)
        stored_path = storage.save(path, upload)

        version = TestSuiteVersion.objects.create(
            test_suite=test_suite,
            version_number=next_version,
            visibility=visibility,
            bundle_key=stored_path,
            checksum=checksum,
        )
        test_suite.active_version = version
        test_suite.save(update_fields=['active_version'])

        serializer = TestSuiteVersionSerializer(
            version,
            context={'active_version_id': test_suite.active_version_id},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites/activate',
    )
    def activate_test_suite(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to update test suites.')
        version_id = request.data.get('version_id')
        if not version_id:
            return Response({'detail': 'version_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        version = TestSuiteVersion.objects.filter(id=version_id, test_suite__assignment=assignment).first()
        if not version:
            return Response({'detail': 'Test suite version not found.'}, status=status.HTTP_404_NOT_FOUND)
        test_suite = version.test_suite
        test_suite.active_version = version
        test_suite.save(update_fields=['active_version'])
        serializer = TestSuiteVersionSerializer(
            version,
            context={'active_version_id': test_suite.active_version_id},
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites/(?P<version_id>[^/.]+)/manifest',
    )
    def test_suite_manifest(self, request, pk=None, version_id=None):
        assignment = self.get_object()
        if not (
            self._is_course_member(request.user, assignment.course_id)
            or request.user.is_superuser
            or request.user.groups.filter(name='Instructor').exists()
        ):
            raise PermissionDenied('Not authorized to view test suites.')
        version = TestSuiteVersion.objects.filter(id=version_id, test_suite__assignment=assignment).first()
        if not version:
            return Response({'detail': 'Test suite version not found.'}, status=status.HTTP_404_NOT_FOUND)
        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        try:
            file_path = storage.path(version.bundle_key)
        except Exception:
            return Response({'detail': 'Unable to locate test suite.'}, status=status.HTTP_404_NOT_FOUND)

        if not os.path.exists(file_path):
            return Response({'detail': 'Test suite file missing.'}, status=status.HTTP_404_NOT_FOUND)

        files = []
        total_size = 0
        try:
            with zipfile.ZipFile(file_path, 'r') as zip_ref:
                for info in zip_ref.infolist():
                    is_dir = info.is_dir()
                    entry = {
                        'name': info.filename,
                        'size': info.file_size,
                        'compressed_size': info.compress_size,
                        'is_dir': is_dir,
                    }
                    files.append(entry)
                    if not is_dir:
                        total_size += info.file_size
        except zipfile.BadZipFile:
            return Response({'detail': 'Invalid zip file.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                'version_id': str(version.id),
                'file_count': len(files),
                'total_size': total_size,
                'files': files[:300],
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[IsAuthenticated],
        url_path='rubric',
    )
    def rubric(self, request, pk=None):
        assignment = self.get_object()
        if request.method == 'GET':
            if not (
                self._is_course_member(request.user, assignment.course_id)
                or request.user.is_superuser
                or request.user.groups.filter(name='Instructor').exists()
            ):
                raise PermissionDenied('Not authorized to view this rubric.')
            rubric = Rubric.objects.filter(assignment=assignment).select_related('active_version').first()
            if not rubric or not rubric.active_version:
                return Response(
                    {'version_number': 0, 'is_weighted': False, 'criteria': []},
                    status=status.HTTP_200_OK,
                )
            version = rubric.active_version
            criteria = RubricCriterion.objects.filter(rubric_version=version).order_by('order_index', 'created_at')
            data = RubricVersionSerializer(version).data
            data['criteria'] = [
                {
                    'id': criterion.id,
                    'name': criterion.name,
                    'max_points': criterion.max_points,
                    'weight': criterion.weight,
                    'order_index': criterion.order_index,
                }
                for criterion in criteria
            ]
            return Response(data, status=status.HTTP_200_OK)

        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to edit this rubric.')

        input_serializer = RubricVersionInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        rubric, _ = Rubric.objects.get_or_create(assignment=assignment)
        current_version = (
            RubricVersion.objects.filter(rubric=rubric).aggregate(max_version=Max('version_number')).get('max_version')
            or 0
        )
        next_version = current_version + 1

        version = RubricVersion.objects.create(
            rubric=rubric,
            version_number=next_version,
            is_weighted=payload.get('is_weighted', False),
        )

        criteria = payload.get('criteria', [])
        for index, criterion in enumerate(criteria):
            RubricCriterion.objects.create(
                rubric_version=version,
                name=criterion.get('name', ''),
                max_points=criterion.get('max_points', 0),
                weight=criterion.get('weight'),
                order_index=criterion.get('order_index', index),
            )

        rubric.active_version = version
        rubric.save(update_fields=['active_version'])

        data = RubricVersionSerializer(version).data
        data['criteria'] = criteria
        return Response(data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='rubric/versions',
    )
    def rubric_versions(self, request, pk=None):
        assignment = self.get_object()
        if not (
            self._is_course_member(request.user, assignment.course_id)
            or request.user.is_superuser
            or request.user.groups.filter(name='Instructor').exists()
        ):
            raise PermissionDenied('Not authorized to view this rubric.')
        rubric = Rubric.objects.filter(assignment=assignment).select_related('active_version').first()
        if not rubric:
            return Response([], status=status.HTTP_200_OK)
        versions = RubricVersion.objects.filter(rubric=rubric).order_by('-created_at')
        criteria = RubricCriterion.objects.filter(rubric_version__in=versions)
        totals = {}
        counts = {}
        for criterion in criteria:
            vid = criterion.rubric_version_id
            counts[vid] = counts.get(vid, 0) + 1
            totals[vid] = totals.get(vid, 0) + float(criterion.max_points)
        data = [
            {
                'id': str(version.id),
                'version_number': version.version_number,
                'created_at': version.created_at,
                'is_weighted': version.is_weighted,
                'criteria_count': counts.get(version.id, 0),
                'total_points': totals.get(version.id, 0),
                'is_active': str(version.id) == str(rubric.active_version_id),
            }
            for version in versions
        ]
        return Response(data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='rubric/activate',
    )
    def rubric_activate(self, request, pk=None):
        assignment = self.get_object()
        if not self._can_manage_assignments(request.user, assignment.course):
            raise PermissionDenied('Not authorized to edit this rubric.')
        version_id = request.data.get('version_id')
        if not version_id:
            return Response({'detail': 'version_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        rubric = Rubric.objects.filter(assignment=assignment).first()
        if not rubric:
            return Response({'detail': 'Rubric not found.'}, status=status.HTTP_404_NOT_FOUND)
        version = RubricVersion.objects.filter(id=version_id, rubric=rubric).first()
        if not version:
            return Response({'detail': 'Rubric version not found.'}, status=status.HTTP_404_NOT_FOUND)
        rubric.active_version = version
        rubric.save(update_fields=['active_version'])
        return Response({'detail': 'Active rubric version updated.'}, status=status.HTTP_200_OK)

    def _is_course_member(self, user, course_id):
        return Enrollment.objects.filter(
            course_id=course_id,
            user=user,
            status=EnrollmentStatus.ACTIVE,
        ).exists()

    def _can_manage_assignments(self, user, course):
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
