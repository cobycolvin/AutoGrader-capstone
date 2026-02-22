import zipfile

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    Assignment,
    Course,
    Enrollment,
    EnrollmentStatus,
    TestSuiteVersion,
    TestSuiteVisibility,
)
from ..serializers.assignments import AssignmentSerializer
from ..serializers.rubrics import RubricVersionInputSerializer, RubricVersionSerializer
from ..serializers.testsuites import TestSuiteBuildInputSerializer, TestSuiteVersionSerializer
from ..services.access import can_manage_course, can_view_course_assets, is_course_member
from ..services.rubric_service import (
    activate_rubric_version,
    get_active_rubric_payload,
    list_rubric_versions,
    upsert_rubric_version,
)
from ..services.test_suite_builder import is_python_language
from ..services.test_suite_service import (
    activate_test_suite_version,
    build_test_suite_from_builder,
    list_test_suite_versions,
    read_test_suite_manifest,
    upload_test_suite_bundle,
)


class AssignmentViewSet(viewsets.ModelViewSet):
    serializer_class = AssignmentSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_queryset(self):
        qs = Assignment.objects.select_related('course', 'language').order_by('due_at', 'title')
        course_id = self.request.query_params.get('course_id')
        user = self.request.user

        if course_id:
            if is_course_member(user, course_id) or user.is_superuser:
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
        if not can_manage_course(request.user, course):
            raise PermissionDenied('Not authorized to create assignments for this course.')
        serializer.save(course=course, created_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        assignment = serializer.instance
        if not can_manage_course(self.request.user, assignment.course):
            raise PermissionDenied('Not authorized to update assignments for this course.')
        serializer.save()

    def perform_destroy(self, instance):
        if not can_manage_course(self.request.user, instance.course):
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
            if not can_view_course_assets(request.user, assignment.course_id):
                raise PermissionDenied('Not authorized to view test suites.')

            visibility = (request.query_params.get('visibility') or '').strip().upper()
            visibility_filter = visibility if visibility in TestSuiteVisibility.values else None
            qs, active_version_id = list_test_suite_versions(assignment, visibility=visibility_filter)

            serializer = TestSuiteVersionSerializer(
                qs,
                many=True,
                context={'active_version_id': active_version_id},
            )
            return Response(serializer.data, status=status.HTTP_200_OK)

        if not can_manage_course(request.user, assignment.course):
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

        version, test_suite = upload_test_suite_bundle(
            assignment=assignment,
            upload=upload,
            visibility=visibility,
        )
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
        if not can_manage_course(request.user, assignment.course):
            raise PermissionDenied('Not authorized to update test suites.')

        version_id = request.data.get('version_id')
        if not version_id:
            return Response({'detail': 'version_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        version, test_suite = activate_test_suite_version(assignment=assignment, version_id=version_id)
        if not version:
            return Response({'detail': 'Test suite version not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = TestSuiteVersionSerializer(
            version,
            context={'active_version_id': test_suite.active_version_id},
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites/build',
    )
    def build_test_suite(self, request, pk=None):
        assignment = self.get_object()
        if not can_manage_course(request.user, assignment.course):
            raise PermissionDenied('Not authorized to build test suites.')

        if not is_python_language(assignment.language):
            return Response(
                {'detail': 'Builder currently supports Python assignments only.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        input_serializer = TestSuiteBuildInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        version, test_suite = build_test_suite_from_builder(assignment=assignment, payload=payload)
        serializer = TestSuiteVersionSerializer(
            version,
            context={'active_version_id': test_suite.active_version_id},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='test-suites/(?P<version_id>[^/.]+)/manifest',
    )
    def test_suite_manifest(self, request, pk=None, version_id=None):
        assignment = self.get_object()
        if not can_view_course_assets(request.user, assignment.course_id):
            raise PermissionDenied('Not authorized to view test suites.')

        version = TestSuiteVersion.objects.filter(id=version_id, test_suite__assignment=assignment).first()
        if not version:
            return Response({'detail': 'Test suite version not found.'}, status=status.HTTP_404_NOT_FOUND)

        manifest, error_detail, error_status = read_test_suite_manifest(version.bundle_key)
        if error_detail:
            return Response({'detail': error_detail}, status=error_status)

        response_payload = {'version_id': str(version.id)}
        response_payload.update(manifest)
        return Response(response_payload, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[IsAuthenticated],
        url_path='rubric',
    )
    def rubric(self, request, pk=None):
        assignment = self.get_object()

        if request.method == 'GET':
            if not can_view_course_assets(request.user, assignment.course_id):
                raise PermissionDenied('Not authorized to view this rubric.')

            _rubric, version, criteria = get_active_rubric_payload(assignment)
            if not version:
                return Response(
                    {'version_number': 0, 'is_weighted': False, 'criteria': []},
                    status=status.HTTP_200_OK,
                )

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

        if not can_manage_course(request.user, assignment.course):
            raise PermissionDenied('Not authorized to edit this rubric.')

        input_serializer = RubricVersionInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        _rubric, version, _criteria = upsert_rubric_version(assignment=assignment, payload=payload)
        data = RubricVersionSerializer(version).data
        data['criteria'] = payload.get('criteria', [])
        return Response(data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAuthenticated],
        url_path='rubric/versions',
    )
    def rubric_versions(self, request, pk=None):
        assignment = self.get_object()
        if not can_view_course_assets(request.user, assignment.course_id):
            raise PermissionDenied('Not authorized to view this rubric.')

        data = list_rubric_versions(assignment)
        return Response(data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='rubric/activate',
    )
    def rubric_activate(self, request, pk=None):
        assignment = self.get_object()
        if not can_manage_course(request.user, assignment.course):
            raise PermissionDenied('Not authorized to edit this rubric.')

        version_id = request.data.get('version_id')
        if not version_id:
            return Response({'detail': 'version_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        rubric, version = activate_rubric_version(assignment=assignment, version_id=version_id)
        if not rubric:
            return Response({'detail': 'Rubric not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not version:
            return Response({'detail': 'Rubric version not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response({'detail': 'Active rubric version updated.'}, status=status.HTTP_200_OK)
