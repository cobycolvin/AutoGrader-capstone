from rest_framework import serializers

from ..models import (
    Assignment,
    AssignmentGroup,
    AssignmentGroupMode,
    AssignmentInstructionAsset,
    AssignmentSubmissionMode,
    Group,
    GroupSet,
    ProgrammingLanguage,
)


_UNSET = object()


class AssignmentSerializer(serializers.ModelSerializer):
    course_id = serializers.UUIDField(write_only=True, required=True)
    course = serializers.PrimaryKeyRelatedField(read_only=True)
    course_title = serializers.CharField(source='course.title', read_only=True)
    course_code = serializers.CharField(source='course.code', read_only=True)
    language_id = serializers.PrimaryKeyRelatedField(
        source='language',
        queryset=ProgrammingLanguage.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )
    language = serializers.PrimaryKeyRelatedField(read_only=True)
    language_name = serializers.CharField(source='language.name', read_only=True)
    group_set_id = serializers.PrimaryKeyRelatedField(
        source='group_set',
        queryset=GroupSet.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )
    group_set = serializers.PrimaryKeyRelatedField(read_only=True)
    group_set_name = serializers.CharField(source='group_set.name', read_only=True)
    assignment_group_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        write_only=True,
    )
    assignment_groups = serializers.SerializerMethodField()

    class Meta:
        model = Assignment
        fields = [
            'id',
            'course_id',
            'course',
            'course_title',
            'course_code',
            'title',
            'description',
            'instructions',
            'language',
            'language_id',
            'language_name',
            'due_at',
            'max_score',
            'allow_groups',
            'group_mode',
            'group_set',
            'group_set_id',
            'group_set_name',
            'assignment_group_ids',
            'assignment_groups',
            'submission_mode',
            'submission_file_types',
            'submission_max_size_mb',
            'submission_max_attempts',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_assignment_groups(self, obj):
        links = getattr(obj, 'prefetched_assignment_groups', None)
        if links is None:
            links = (
                AssignmentGroup.objects.filter(assignment=obj)
                .select_related('group', 'group__group_set')
                .order_by('group__name')
            )
        return [
            {
                'id': str(link.group_id),
                'name': link.group.name,
                'group_set_id': str(link.group.group_set_id) if link.group.group_set_id else None,
                'group_set_name': link.group.group_set.name if link.group.group_set_id else '',
            }
            for link in links
            if getattr(link, 'group', None) is not None
        ]

    def validate(self, attrs):
        course_id = attrs.get('course_id')
        if self.instance is None and not course_id:
            raise serializers.ValidationError({'course_id': 'Course is required.'})

        effective_course_id = course_id or getattr(self.instance, 'course_id', None)
        effective_allow_groups = attrs.get(
            'allow_groups',
            getattr(self.instance, 'allow_groups', False),
        )
        effective_group_mode = attrs.get(
            'group_mode',
            getattr(self.instance, 'group_mode', AssignmentGroupMode.PER_ASSIGNMENT),
        )
        effective_group_set = attrs.get(
            'group_set',
            getattr(self.instance, 'group_set', None),
        )
        effective_language = attrs.get(
            'language',
            getattr(self.instance, 'language', None),
        )
        effective_submission_mode = attrs.get(
            'submission_mode',
            getattr(self.instance, 'submission_mode', AssignmentSubmissionMode.UPLOAD),
        )
        submitted_assignment_group_ids = attrs.get('assignment_group_ids', _UNSET)
        if submitted_assignment_group_ids is _UNSET:
            effective_assignment_groups = (
                list(
                    AssignmentGroup.objects.filter(assignment=self.instance)
                    .select_related('group', 'group__group_set')
                    .order_by('group__name')
                )
                if self.instance
                else []
            )
        else:
            normalized_group_ids = list(dict.fromkeys(str(group_id) for group_id in submitted_assignment_group_ids))
            if not normalized_group_ids:
                effective_assignment_groups = []
            else:
                groups = list(
                    Group.objects.filter(course_id=effective_course_id, id__in=normalized_group_ids)
                    .select_related('group_set')
                    .order_by('name')
                )
                found_group_ids = {str(group.id) for group in groups}
                missing_group_ids = [group_id for group_id in normalized_group_ids if group_id not in found_group_ids]
                if missing_group_ids:
                    raise serializers.ValidationError(
                        {'assignment_group_ids': 'Each selected group must belong to the same course.'}
                    )
                effective_assignment_groups = groups

        if effective_submission_mode in {
            AssignmentSubmissionMode.WORKSPACE,
            AssignmentSubmissionMode.BOTH,
        } and effective_language is None:
            raise serializers.ValidationError(
                {'submission_mode': 'Choose a programming language before enabling the workspace editor.'}
            )

        if not effective_allow_groups:
            attrs['group_set'] = None
            attrs['group_mode'] = AssignmentGroupMode.PER_ASSIGNMENT
            attrs['assignment_groups_to_sync'] = []
        else:
            has_reusable_set = effective_group_set is not None
            has_specific_groups = bool(effective_assignment_groups)

            if has_reusable_set and has_specific_groups:
                raise serializers.ValidationError(
                    {'detail': 'Choose either a reusable group set or specific groups, not both.'}
                )

            if has_reusable_set:
                if str(effective_group_set.course_id) != str(effective_course_id):
                    raise serializers.ValidationError(
                        {'group_set_id': 'Selected group set must belong to the same course.'}
                    )
                attrs['group_mode'] = AssignmentGroupMode.REUSABLE_SET
                attrs['assignment_groups_to_sync'] = []
            elif has_specific_groups:
                attrs['group_set'] = None
                attrs['group_mode'] = AssignmentGroupMode.PER_ASSIGNMENT
                attrs['assignment_groups_to_sync'] = effective_assignment_groups
            else:
                raise serializers.ValidationError(
                    {
                        'group_set_id': 'Choose a reusable group set or specific groups for grouped assignments.',
                        'assignment_group_ids': 'Choose a reusable group set or specific groups for grouped assignments.',
                    }
                )

        if 'submission_file_types' in attrs:
            value = attrs.get('submission_file_types')
            if isinstance(value, str):
                parts = [part.strip().lower() for part in value.split(',')]
                attrs['submission_file_types'] = [part for part in parts if part]
            elif isinstance(value, list):
                attrs['submission_file_types'] = [str(part).strip().lower() for part in value if str(part).strip()]

        if 'submission_max_size_mb' in attrs:
            if attrs['submission_max_size_mb'] is None or attrs['submission_max_size_mb'] < 0:
                raise serializers.ValidationError({'submission_max_size_mb': 'Must be zero or positive.'})

        if 'submission_max_attempts' in attrs:
            if attrs['submission_max_attempts'] is None or attrs['submission_max_attempts'] < 0:
                raise serializers.ValidationError({'submission_max_attempts': 'Must be zero or positive.'})
        return attrs

    def _sync_assignment_groups(self, assignment, groups):
        AssignmentGroup.objects.filter(assignment=assignment).delete()
        if groups:
            AssignmentGroup.objects.bulk_create(
                [AssignmentGroup(assignment=assignment, group=group) for group in groups]
            )

    def create(self, validated_data):
        validated_data.pop('course_id', None)
        validated_data.pop('assignment_group_ids', None)
        assignment_groups = validated_data.pop('assignment_groups_to_sync', [])
        assignment = super().create(validated_data)
        self._sync_assignment_groups(assignment, assignment_groups)
        return assignment

    def update(self, instance, validated_data):
        validated_data.pop('course_id', None)
        validated_data.pop('assignment_group_ids', None)
        assignment_groups = validated_data.pop('assignment_groups_to_sync', [])
        assignment = super().update(instance, validated_data)
        self._sync_assignment_groups(assignment, assignment_groups)
        return assignment


class AssignmentInstructionAssetSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.CharField(source='uploaded_by.username', read_only=True)

    class Meta:
        model = AssignmentInstructionAsset
        fields = [
            'id',
            'original_name',
            'mime_type',
            'file_size',
            'display_order',
            'uploaded_by',
            'uploaded_by_username',
            'created_at',
        ]
        read_only_fields = fields
