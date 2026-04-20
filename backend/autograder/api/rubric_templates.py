from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import (
    Course,
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    RubricTemplate,
    RubricTemplateCriterion,
    RubricTemplateCriterionLevel,
    RubricTemplateScope,
)
from ..serializers.rubrics import (
    RubricTemplateCreateSerializer,
    RubricTemplateSerializer,
    RubricTemplateVersionInputSerializer,
)
from ..services import (
    bootstrap_course_rubric_templates,
    create_rubric_template,
    create_rubric_template_version,
)


class RubricTemplateViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [IsAuthenticated]
    serializer_class = RubricTemplateSerializer
    queryset = RubricTemplate.objects.select_related('course', 'active_version').all()

    def list(self, request, *args, **kwargs):
        course_id = request.query_params.get('course_id')
        if not course_id:
            return Response({'detail': 'course_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        course = Course.objects.filter(id=course_id).first()
        if not course:
            return Response({'detail': 'Course not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not self._can_manage_course_templates(request.user, course):
            raise PermissionDenied('Not authorized to view rubric templates for this course.')

        templates = list(
            RubricTemplate.objects.select_related('course', 'active_version')
            .filter(
                course_id=course.id,
            )
        )
        templates.extend(
            list(
                RubricTemplate.objects.select_related('course', 'active_version')
                .filter(scope=RubricTemplateScope.SYSTEM)
            )
        )
        templates = self._dedupe_templates(templates)
        templates.sort(key=lambda template: (0 if template.scope == RubricTemplateScope.SYSTEM else 1, template.name.lower()))
        return Response(self._serialize_template_collection(templates), status=status.HTTP_200_OK)

    def create(self, request, *args, **kwargs):
        input_serializer = RubricTemplateCreateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        course = Course.objects.filter(id=payload['course_id']).first()
        if not course:
            return Response({'detail': 'Course not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not self._can_manage_course_templates(request.user, course):
            raise PermissionDenied('Not authorized to create rubric templates for this course.')

        template, _version = create_rubric_template(
            payload['name'],
            description=payload.get('description', ''),
            scope=RubricTemplateScope.COURSE,
            course=course,
            is_weighted=payload.get('is_weighted', False),
            criteria=payload.get('criteria', []),
            created_by=request.user,
        )
        template.refresh_from_db()
        return Response(self._serialize_template(template), status=status.HTTP_201_CREATED)

    @action(
        detail=False,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='bootstrap',
    )
    def bootstrap(self, request):
        course_id = request.data.get('course_id')
        if not course_id:
            return Response({'detail': 'course_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        course = Course.objects.filter(id=course_id).first()
        if not course:
            return Response({'detail': 'Course not found.'}, status=status.HTTP_404_NOT_FOUND)
        if not self._can_manage_course_templates(request.user, course):
            raise PermissionDenied('Not authorized to create rubric templates for this course.')

        created_templates = bootstrap_course_rubric_templates(course, created_by=request.user)
        return Response(
            {
                'detail': (
                    f'Added {len(created_templates)} starter rubric templates.'
                    if created_templates
                    else 'Starter rubric templates already exist for this course.'
                ),
                'created_count': len(created_templates),
                'created_names': [template.name for template in created_templates],
            },
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAuthenticated],
        url_path='versions',
    )
    def versions(self, request, pk=None):
        template = self.get_object()
        if template.scope != RubricTemplateScope.COURSE:
            raise PermissionDenied('Standard rubric templates are read-only.')
        if not template.course or not self._can_manage_course_templates(request.user, template.course):
            raise PermissionDenied('Not authorized to update this rubric template.')

        input_serializer = RubricTemplateVersionInputSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        payload = input_serializer.validated_data

        update_fields = []
        if 'name' in payload and payload['name'] != template.name:
            template.name = payload['name']
            update_fields.append('name')
        if 'description' in payload and payload['description'] != template.description:
            template.description = payload['description']
            update_fields.append('description')
        if update_fields:
            template.save(update_fields=update_fields)

        create_rubric_template_version(
            template,
            is_weighted=payload.get('is_weighted', False),
            criteria=payload.get('criteria', []),
            created_by=request.user,
        )
        template.refresh_from_db()
        return Response(self._serialize_template(template), status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        template = self.get_object()
        if template.scope == RubricTemplateScope.SYSTEM:
            raise PermissionDenied('Standard templates cannot be deleted.')
        if not template.course or not self._can_manage_course_templates(request.user, template.course):
            raise PermissionDenied('Not authorized to delete this rubric template.')
        template.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def partial_update(self, request, pk=None):
        """PATCH name/description only — no new version created."""
        template = self.get_object()
        if template.scope == RubricTemplateScope.SYSTEM:
            raise PermissionDenied('Standard templates are read-only.')
        if not template.course or not self._can_manage_course_templates(request.user, template.course):
            raise PermissionDenied('Not authorized to update this rubric template.')

        update_fields = []
        name = request.data.get('name', '').strip()
        description = request.data.get('description', '')
        if name and name != template.name:
            template.name = name
            update_fields.append('name')
        if description != template.description:
            template.description = description
            update_fields.append('description')
        if update_fields:
            template.save(update_fields=update_fields)
        template.refresh_from_db()
        return Response(self._serialize_template(template), status=status.HTTP_200_OK)

    def _serialize_template_collection(self, templates):
        active_version_ids = [template.active_version_id for template in templates if template.active_version_id]
        criteria_by_version_id = {}
        criteria_ids = []
        if active_version_ids:
            for criterion in (
                RubricTemplateCriterion.objects.filter(template_version_id__in=active_version_ids)
                .order_by('order_index', 'created_at')
            ):
                criteria_by_version_id.setdefault(criterion.template_version_id, []).append(criterion)
                criteria_ids.append(criterion.id)

        levels_by_criterion_id = {}
        if criteria_ids:
            for level in (
                RubricTemplateCriterionLevel.objects.filter(criterion_id__in=criteria_ids)
                .order_by('-max_points')
            ):
                levels_by_criterion_id.setdefault(level.criterion_id, []).append(level)

        return [
            self._serialize_template(
                template,
                criteria=criteria_by_version_id.get(template.active_version_id, []),
                levels_by_criterion_id=levels_by_criterion_id,
            )
            for template in templates
        ]

    def _serialize_template(self, template, criteria=None, levels_by_criterion_id=None):
        active_version = template.active_version
        if criteria is None and active_version is not None:
            criteria = list(
                RubricTemplateCriterion.objects.filter(template_version=active_version)
                .order_by('order_index', 'created_at')
            )
            if criteria:
                criterion_ids = [c.id for c in criteria]
                raw_levels = RubricTemplateCriterionLevel.objects.filter(
                    criterion_id__in=criterion_ids
                ).order_by('-max_points')
                levels_by_criterion_id = {}
                for level in raw_levels:
                    levels_by_criterion_id.setdefault(level.criterion_id, []).append(level)
        else:
            criteria = list(criteria or [])

        levels_map = levels_by_criterion_id or {}
        return {
            'id': str(template.id),
            'name': template.name,
            'description': template.description or '',
            'scope': template.scope,
            'course_id': str(template.course_id) if template.course_id else None,
            'is_editable': template.scope == RubricTemplateScope.COURSE,
            'active_version': None if active_version is None else {
                'id': str(active_version.id),
                'version_number': active_version.version_number,
                'is_weighted': active_version.is_weighted,
                'created_at': active_version.created_at,
                'criteria': [
                    {
                        'id': str(criterion.id),
                        'name': criterion.name,
                        'max_points': criterion.max_points,
                        'weight': criterion.weight,
                        'order_index': criterion.order_index,
                        'levels': [
                            {
                                'id': str(level.id),
                                'label': level.label,
                                'min_points': level.min_points,
                                'max_points': level.max_points,
                                'description': level.description,
                                'order_index': level.order_index,
                            }
                            for level in levels_map.get(criterion.id, [])
                        ],
                    }
                    for criterion in criteria
                ],
                'criteria_count': len(criteria),
                'total_points': sum(float(criterion.max_points) for criterion in criteria),
                'total_weight': sum(float(criterion.weight or 0) for criterion in criteria),
            },
        }

    def _dedupe_templates(self, templates):
        seen = set()
        unique = []
        for template in templates:
            if template.id in seen:
                continue
            seen.add(template.id)
            unique.append(template)
        return unique

    def _can_manage_course_templates(self, user, course):
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
