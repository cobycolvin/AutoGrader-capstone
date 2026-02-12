from rest_framework import serializers

from ..models import Assignment, ProgrammingLanguage


class AssignmentSerializer(serializers.ModelSerializer):
    course_id = serializers.UUIDField(write_only=True, required=True)
    language_id = serializers.PrimaryKeyRelatedField(
        source='language',
        queryset=ProgrammingLanguage.objects.all(),
        required=False,
        allow_null=True,
        write_only=True,
    )
    language = serializers.PrimaryKeyRelatedField(read_only=True)
    language_name = serializers.CharField(source='language.name', read_only=True)

    class Meta:
        model = Assignment
        fields = [
            'id',
            'course_id',
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
            'submission_file_types',
            'submission_max_size_mb',
            'submission_max_attempts',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        course_id = attrs.get('course_id')
        if self.instance is None and not course_id:
            raise serializers.ValidationError({'course_id': 'Course is required.'})

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

    def create(self, validated_data):
        validated_data.pop('course_id', None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('course_id', None)
        return super().update(instance, validated_data)
