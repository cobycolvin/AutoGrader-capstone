from rest_framework import serializers

from ..services.workspace import normalize_workspace_path


class SubmissionDraftFileSerializer(serializers.Serializer):
    path = serializers.CharField(max_length=255)
    content = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)

    def validate_path(self, value):
        normalized = normalize_workspace_path(value)
        if not normalized:
            raise serializers.ValidationError('path must be a safe relative path.')
        return normalized


class SubmissionDraftUpdateSerializer(serializers.Serializer):
    expected_revision = serializers.IntegerField(required=False, min_value=1)
    files = SubmissionDraftFileSerializer(many=True, allow_empty=False)
