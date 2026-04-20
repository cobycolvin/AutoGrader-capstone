from decimal import Decimal

from rest_framework import serializers

from ..models import (
    RubricAttachment,
    RubricCriterion,
    RubricCriterionLevel,
    RubricTemplate,
    RubricTemplateCriterion,
    RubricTemplateCriterionLevel,
    RubricTemplateVersion,
    RubricVersion,
)


class RubricAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.CharField(source='uploaded_by.username', read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = RubricAttachment
        fields = [
            'id',
            'original_name',
            'mime_type',
            'file_size',
            'display_order',
            'created_at',
            'uploaded_by_username',
            'download_url',
        ]
        read_only_fields = fields

    def get_download_url(self, obj):
        assignment_id = getattr(getattr(getattr(obj, 'rubric_version', None), 'rubric', None), 'assignment_id', None)
        if not assignment_id:
            return ''
        return f'/api/assignments/{assignment_id}/rubric-files/{obj.id}/download/'


class RubricCriterionLevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = RubricCriterionLevel
        fields = ['id', 'label', 'min_points', 'max_points', 'description', 'order_index']
        read_only_fields = ['id']
        extra_kwargs = {'order_index': {'required': False}}


class RubricCriterionLevelInputSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=100)
    min_points = serializers.DecimalField(max_digits=7, decimal_places=2)
    max_points = serializers.DecimalField(max_digits=7, decimal_places=2)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    order_index = serializers.IntegerField(required=False, default=0)


class RubricCriterionSerializer(serializers.ModelSerializer):
    levels = RubricCriterionLevelSerializer(many=True, read_only=True)

    def validate_name(self, value):
        if not str(value or '').strip():
            raise serializers.ValidationError('Criterion name is required.')
        return str(value).strip()

    def validate_max_points(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Points must be greater than 0.')
        return value

    class Meta:
        model = RubricCriterion
        fields = [
            'id',
            'name',
            'max_points',
            'weight',
            'order_index',
            'levels',
        ]
        read_only_fields = ['id', 'levels']
        extra_kwargs = {
            'weight': {'required': False, 'allow_null': True},
            'order_index': {'required': False},
        }


class RubricVersionSerializer(serializers.ModelSerializer):
    criteria = RubricCriterionSerializer(many=True, read_only=True)
    attachments = RubricAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = RubricVersion
        fields = [
            'id',
            'version_number',
            'is_weighted',
            'created_at',
            'criteria',
            'attachments',
        ]
        read_only_fields = ['id', 'created_at', 'version_number', 'criteria', 'attachments']


class RubricCriterionInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    max_points = serializers.DecimalField(max_digits=7, decimal_places=2)
    weight = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    order_index = serializers.IntegerField(required=False, default=0)
    levels = RubricCriterionLevelInputSerializer(many=True, required=False, default=list)

    def validate_name(self, value):
        if not str(value or '').strip():
            raise serializers.ValidationError('Criterion name is required.')
        return str(value).strip()

    def validate_max_points(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Points must be greater than 0.')
        return value


class RubricVersionInputSerializer(serializers.Serializer):
    is_weighted = serializers.BooleanField(default=False)
    criteria = RubricCriterionInputSerializer(many=True)

    def validate(self, attrs):
        criteria = list(attrs.get('criteria') or [])
        if not criteria:
            raise serializers.ValidationError({'criteria': ['Add at least one criterion.']})

        if attrs.get('is_weighted'):
            total_weight = Decimal('0')
            for criterion in criteria:
                weight = criterion.get('weight')
                if weight is None:
                    raise serializers.ValidationError(
                        {'criteria': ['Weighted rubrics require a weight for every criterion.']}
                    )
                if weight <= 0:
                    raise serializers.ValidationError(
                        {'criteria': ['Weighted rubrics require every weight to be greater than 0.']}
                    )
                total_weight += weight
            attrs['total_weight'] = total_weight
        else:
            attrs['criteria'] = [{**criterion, 'weight': None} for criterion in criteria]
            attrs['total_weight'] = Decimal('0')

        return attrs


class RubricTemplateCriterionLevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = RubricTemplateCriterionLevel
        fields = ['id', 'label', 'min_points', 'max_points', 'description', 'order_index']
        read_only_fields = ['id']


class RubricTemplateCriterionSerializer(serializers.ModelSerializer):
    levels = RubricTemplateCriterionLevelSerializer(many=True, read_only=True)

    class Meta:
        model = RubricTemplateCriterion
        fields = [
            'id',
            'name',
            'max_points',
            'weight',
            'order_index',
            'levels',
        ]
        read_only_fields = ['id', 'levels']


class RubricTemplateVersionSerializer(serializers.ModelSerializer):
    criteria = RubricTemplateCriterionSerializer(many=True, read_only=True)

    class Meta:
        model = RubricTemplateVersion
        fields = [
            'id',
            'version_number',
            'is_weighted',
            'created_at',
            'criteria',
        ]
        read_only_fields = fields


class RubricTemplateSerializer(serializers.ModelSerializer):
    active_version = RubricTemplateVersionSerializer(read_only=True)
    course_id = serializers.UUIDField(source='course_id', read_only=True)

    class Meta:
        model = RubricTemplate
        fields = [
            'id',
            'name',
            'description',
            'scope',
            'course_id',
            'template_key',
            'created_at',
            'updated_at',
            'active_version',
        ]
        read_only_fields = fields


class RubricTemplateCreateSerializer(RubricVersionInputSerializer):
    name = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True)
    course_id = serializers.UUIDField()

    def validate_name(self, value):
        if not str(value or '').strip():
            raise serializers.ValidationError('Template name is required.')
        return str(value).strip()


class RubricTemplateVersionInputSerializer(RubricVersionInputSerializer):
    name = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)

    def validate_name(self, value):
        if not str(value or '').strip():
            raise serializers.ValidationError('Template name is required.')
        return str(value).strip()
