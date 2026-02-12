from rest_framework import serializers

from ..models import RubricCriterion, RubricVersion


class RubricCriterionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RubricCriterion
        fields = [
            'id',
            'name',
            'max_points',
            'weight',
            'order_index',
        ]
        read_only_fields = ['id']


class RubricVersionSerializer(serializers.ModelSerializer):
    criteria = RubricCriterionSerializer(many=True, read_only=True)

    class Meta:
        model = RubricVersion
        fields = [
            'id',
            'version_number',
            'is_weighted',
            'created_at',
            'criteria',
        ]
        read_only_fields = ['id', 'created_at', 'version_number', 'criteria']


class RubricVersionInputSerializer(serializers.Serializer):
    is_weighted = serializers.BooleanField(default=False)
    criteria = RubricCriterionSerializer(many=True)
