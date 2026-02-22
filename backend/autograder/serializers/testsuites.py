from rest_framework import serializers

from ..models import TestSuiteVersion, TestSuiteVisibility


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


class IOTestCaseInputSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    input = serializers.CharField(required=False, allow_blank=True, default='')
    expected = serializers.CharField(required=False, allow_blank=True, default='')
    points = serializers.FloatField(required=False, min_value=0, default=0)
    timeout_ms = serializers.IntegerField(required=False, min_value=1)

    def validate(self, attrs):
        input_value = attrs.get('input', '')
        expected_value = attrs.get('expected', '')
        if input_value == '' and expected_value == '':
            raise serializers.ValidationError('Input and expected output cannot both be empty.')
        return attrs


class FunctionTestCaseInputSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    function_name = serializers.CharField(required=True, allow_blank=False, max_length=120)
    args = serializers.JSONField(required=False, default=list)
    expected = serializers.JSONField(required=True)
    points = serializers.FloatField(required=False, min_value=0, default=0)
    timeout_ms = serializers.IntegerField(required=False, min_value=1)


class TestSuiteBuildInputSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=['IO', 'FUNCTION'], required=False, default='IO')
    name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    visibility = serializers.ChoiceField(
        choices=TestSuiteVisibility.values,
        required=False,
        default=TestSuiteVisibility.PRIVATE,
    )
    set_active = serializers.BooleanField(required=False, default=True)
    timeout_ms = serializers.IntegerField(required=False, min_value=1)
    module_path = serializers.CharField(required=False, allow_blank=True, max_length=200, default='student.py')
    tests = IOTestCaseInputSerializer(many=True, required=False)
    function_tests = FunctionTestCaseInputSerializer(many=True, required=False)

    def validate_module_path(self, value):
        normalized = (value or '').strip()
        if not normalized:
            return 'student.py'
        if normalized.startswith('/') or '..' in normalized.split('/'):
            raise serializers.ValidationError('module_path must be a relative path inside the submission.')
        if not normalized.endswith('.py'):
            raise serializers.ValidationError('module_path must reference a .py file.')
        return normalized

    def validate_tests(self, value):
        if value is None:
            return value
        if len(value) > 200:
            raise serializers.ValidationError('Too many tests. Limit is 200.')
        return value

    def validate_function_tests(self, value):
        if value is None:
            return value
        if len(value) > 200:
            raise serializers.ValidationError('Too many function tests. Limit is 200.')
        return value

    def validate(self, attrs):
        test_type = attrs.get('type', 'IO')
        if test_type == 'IO':
            tests = attrs.get('tests') or []
            if len(tests) == 0:
                raise serializers.ValidationError({'tests': 'At least one I/O test case is required.'})
        if test_type == 'FUNCTION':
            function_tests = attrs.get('function_tests') or []
            if len(function_tests) == 0:
                raise serializers.ValidationError({'function_tests': 'At least one function test case is required.'})
        return attrs
