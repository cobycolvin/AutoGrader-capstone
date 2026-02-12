from rest_framework import serializers

from ..models import TestSuiteVersion


class TestSuiteVersionSerializer(serializers.ModelSerializer):
    is_active = serializers.SerializerMethodField()

    def get_is_active(self, obj):
        active_id = self.context.get('active_version_id')
        if not active_id:
            return False
        return str(obj.id) == str(active_id)

    class Meta:
        model = TestSuiteVersion
        fields = [
            'id',
            'version_number',
            'visibility',
            'bundle_key',
            'checksum',
            'created_at',
            'is_active',
        ]
        read_only_fields = ['id', 'created_at']
