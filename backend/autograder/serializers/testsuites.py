import json
import os

from rest_framework import serializers

from ..models import TestSuiteVersion, TestSuiteVisibility


FILE_IO_COMPARISON_MODES = [
    'EXACT',
    'TRIMMED',
    'NORMALIZED_WHITESPACE',
    'UNORDERED_LINES',
    'JSON_EQ',
    'NUMERIC_TOLERANCE',
]
FILE_IO_VALIDATION_MODES = ['BUILT_IN', 'CUSTOM']
MAX_INLINE_FILE_BYTES = 256 * 1024
MAX_VALIDATOR_BYTES = 200 * 1024


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
            'execution_mode',
            'bundle_key',
            'checksum',
            'created_at',
            'is_active',
        ]
        read_only_fields = ['id', 'created_at']


def _is_safe_relative_path(path):
    normalized = (path or '').replace('\\', '/').strip()
    if not normalized:
        return False
    if os.path.isabs(normalized):
        return False
    parts = [part for part in normalized.split('/') if part not in {'', '.'}]
    if any(part == '..' for part in parts):
        return False
    return True


def _ensure_json_compatible(value, field_name):
    try:
        json.dumps(value)
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError({field_name: f'Must be JSON-compatible: {exc}'}) from exc


def _validate_text_size(value, limit_bytes, field_name):
    if value is None:
        return
    if len(str(value).encode('utf-8')) > limit_bytes:
        raise serializers.ValidationError({field_name: f'Must be {limit_bytes} bytes or smaller.'})


class IOTestCaseInputSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    input = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)
    expected = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)
    points = serializers.DecimalField(
        max_digits=7,
        decimal_places=2,
        min_value=0,
        required=False,
        default=0,
    )
    timeout_ms = serializers.IntegerField(required=False, allow_null=True, min_value=1)

    def validate(self, attrs):
        input_value = attrs.get('input', '')
        expected_value = attrs.get('expected', '')
        if input_value == '' and expected_value == '':
            raise serializers.ValidationError('Provide input or expected output.')
        return attrs


class MethodStepInputSerializer(serializers.Serializer):
    method = serializers.CharField(max_length=120)
    args = serializers.JSONField(required=False, default=list)

    def validate(self, attrs):
        args = attrs.get('args', [])
        _ensure_json_compatible(args, 'args')
        if not isinstance(args, list):
            raise serializers.ValidationError({'args': 'args must be a JSON array.'})
        return attrs


class OOPClassTestCaseInputSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    class_name = serializers.CharField(max_length=120)
    constructor_args = serializers.JSONField(required=False, default=list)
    steps = MethodStepInputSerializer(many=True, required=False, default=list)
    assert_method = serializers.CharField(max_length=120)
    assert_args = serializers.JSONField(required=False, default=list)
    expected = serializers.JSONField()
    points = serializers.DecimalField(
        max_digits=7,
        decimal_places=2,
        min_value=0,
        required=False,
        default=0,
    )
    timeout_ms = serializers.IntegerField(required=False, allow_null=True, min_value=1)

    def validate(self, attrs):
        constructor_args = attrs.get('constructor_args', [])
        assert_args = attrs.get('assert_args', [])
        expected = attrs.get('expected')

        _ensure_json_compatible(constructor_args, 'constructor_args')
        _ensure_json_compatible(assert_args, 'assert_args')
        _ensure_json_compatible(expected, 'expected')

        if not isinstance(constructor_args, list):
            raise serializers.ValidationError({'constructor_args': 'constructor_args must be a JSON array.'})
        if not isinstance(assert_args, list):
            raise serializers.ValidationError({'assert_args': 'assert_args must be a JSON array.'})
        return attrs


class OOPMainTestCaseInputSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    input = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)
    expected = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)
    points = serializers.DecimalField(
        max_digits=7,
        decimal_places=2,
        min_value=0,
        required=False,
        default=0,
    )
    timeout_ms = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    main_class = serializers.CharField(required=False, allow_blank=True, max_length=120)

    def validate(self, attrs):
        input_value = attrs.get('input', '')
        expected_value = attrs.get('expected', '')
        if input_value == '' and expected_value == '':
            raise serializers.ValidationError('Provide input or expected output.')
        return attrs


class FileFixtureInputSerializer(serializers.Serializer):
    path = serializers.CharField(max_length=255)
    content = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)

    def validate_path(self, value):
        if not _is_safe_relative_path(value):
            raise serializers.ValidationError('path must be a safe relative path.')
        return value

    def validate(self, attrs):
        _validate_text_size(attrs.get('content', ''), MAX_INLINE_FILE_BYTES, 'content')
        return attrs


class GradingFileInputSerializer(FileFixtureInputSerializer):
    pass


class InlineExpectationInputSerializer(serializers.Serializer):
    content = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)
    comparison_mode = serializers.ChoiceField(
        choices=FILE_IO_COMPARISON_MODES,
        required=False,
        default='EXACT',
    )
    numeric_tolerance = serializers.FloatField(required=False, allow_null=True)

    def validate(self, attrs):
        _validate_text_size(attrs.get('content', ''), MAX_INLINE_FILE_BYTES, 'content')
        comparison_mode = attrs.get('comparison_mode') or 'EXACT'
        numeric_tolerance = attrs.get('numeric_tolerance')
        if comparison_mode == 'NUMERIC_TOLERANCE' and numeric_tolerance is None:
            raise serializers.ValidationError({'numeric_tolerance': 'numeric_tolerance is required for NUMERIC_TOLERANCE.'})
        return attrs


class FileExpectationInputSerializer(InlineExpectationInputSerializer):
    path = serializers.CharField(max_length=255)

    def validate_path(self, value):
        if not _is_safe_relative_path(value):
            raise serializers.ValidationError('path must be a safe relative path.')
        return value


class FileIOTestCaseInputSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    args = serializers.ListField(
        child=serializers.CharField(allow_blank=True, max_length=300),
        required=False,
        default=list,
    )
    stdin = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)
    input_files = FileFixtureInputSerializer(many=True, required=False, default=list)
    expected_files = FileExpectationInputSerializer(many=True, required=False, default=list)
    expected_stdout = InlineExpectationInputSerializer(required=False, allow_null=True, default=None)
    expected_stderr = InlineExpectationInputSerializer(required=False, allow_null=True, default=None)
    expected_exit_code = serializers.IntegerField(required=False, default=0)
    validation_mode = serializers.ChoiceField(
        choices=FILE_IO_VALIDATION_MODES,
        required=False,
        default='BUILT_IN',
    )
    points = serializers.DecimalField(
        max_digits=7,
        decimal_places=2,
        min_value=0,
        required=False,
        default=0,
    )
    timeout_ms = serializers.IntegerField(required=False, allow_null=True, min_value=1)

    def validate(self, attrs):
        input_files = attrs.get('input_files') or []
        expected_files = attrs.get('expected_files') or []
        expected_stdout = attrs.get('expected_stdout')
        expected_stderr = attrs.get('expected_stderr')
        validation_mode = attrs.get('validation_mode') or 'BUILT_IN'

        if len(input_files) > 50:
            raise serializers.ValidationError({'input_files': 'Too many input files. Limit is 50.'})
        if len(expected_files) > 50:
            raise serializers.ValidationError({'expected_files': 'Too many expected files. Limit is 50.'})

        if validation_mode == 'BUILT_IN' and not (expected_files or expected_stdout is not None or expected_stderr is not None):
            raise serializers.ValidationError(
                {'expected_files': 'Built-in validation requires expected_files, expected_stdout, or expected_stderr.'}
            )
        return attrs


class TestSuiteBuildInputSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, max_length=200, default='tests')
    language_id = serializers.UUIDField(required=False, allow_null=True)
    type = serializers.ChoiceField(choices=['IO', 'OOP', 'FILE_IO'], required=False, default='IO')
    visibility = serializers.ChoiceField(
        choices=TestSuiteVisibility.values,
        required=False,
        default=TestSuiteVisibility.PRIVATE,
    )
    timeout_ms = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    set_active = serializers.BooleanField(required=False, default=True)

    # IO fields
    tests = IOTestCaseInputSerializer(many=True, required=False, default=list)

    # OOP fields
    module_path = serializers.CharField(required=False, allow_blank=True, max_length=255, default='')
    class_tests = OOPClassTestCaseInputSerializer(many=True, required=False, default=list)
    main_tests = OOPMainTestCaseInputSerializer(many=True, required=False, default=list)

    # FILE_IO fields
    entry_path = serializers.CharField(required=False, allow_blank=True, max_length=255, default='')
    main_class = serializers.CharField(required=False, allow_blank=True, max_length=255, default='')
    grading_files = GradingFileInputSerializer(many=True, required=False, default=list)
    primary_grading_file = serializers.CharField(required=False, allow_blank=True, max_length=255, default='')
    cases = FileIOTestCaseInputSerializer(many=True, required=False, default=list)
    validator_code = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_module_path(self, value):
        if not value:
            return value
        if not _is_safe_relative_path(value):
            raise serializers.ValidationError('module_path must be a safe relative path.')
        return value

    def validate_entry_path(self, value):
        if not value:
            return value
        if not _is_safe_relative_path(value):
            raise serializers.ValidationError('entry_path must be a safe relative path.')
        return value

    def validate_validator_code(self, value):
        _validate_text_size(value or '', MAX_VALIDATOR_BYTES, 'validator_code')
        return value

    def validate_primary_grading_file(self, value):
        if not value:
            return value
        if not _is_safe_relative_path(value):
            raise serializers.ValidationError('primary_grading_file must be a safe relative path.')
        return value

    def validate(self, attrs):
        suite_type = attrs.get('type', 'IO')
        tests = attrs.get('tests') or []
        class_tests = attrs.get('class_tests') or []
        main_tests = attrs.get('main_tests') or []
        cases = attrs.get('cases') or []
        validator_code = attrs.get('validator_code') or ''
        grading_files = attrs.get('grading_files') or []
        primary_grading_file = attrs.get('primary_grading_file') or ''

        if suite_type == 'IO':
            if not tests:
                raise serializers.ValidationError({'tests': 'At least one test case is required.'})
            if len(tests) > 200:
                raise serializers.ValidationError({'tests': 'Too many tests. Limit is 200.'})
        elif suite_type == 'OOP':
            if len(class_tests) > 200:
                raise serializers.ValidationError({'class_tests': 'Too many class tests. Limit is 200.'})
            if len(main_tests) > 200:
                raise serializers.ValidationError({'main_tests': 'Too many main tests. Limit is 200.'})
            if not class_tests and not main_tests:
                raise serializers.ValidationError(
                    {'class_tests': 'Provide at least one class test or one main test.'}
                )
        elif suite_type == 'FILE_IO':
            if not cases:
                raise serializers.ValidationError({'cases': 'At least one file I/O test case is required.'})
            if len(cases) > 200:
                raise serializers.ValidationError({'cases': 'Too many file I/O cases. Limit is 200.'})
            if len(grading_files) > 100:
                raise serializers.ValidationError({'grading_files': 'Too many grading files. Limit is 100.'})
            requires_validator = any((case.get('validation_mode') or 'BUILT_IN') == 'CUSTOM' for case in cases)
            if requires_validator and not validator_code.strip():
                raise serializers.ValidationError({'validator_code': 'validator_code is required when any case uses CUSTOM validation.'})
            if primary_grading_file and primary_grading_file not in {item.get('path') for item in grading_files}:
                raise serializers.ValidationError({'primary_grading_file': 'primary_grading_file must match one of the uploaded grading file paths.'})
        return attrs


__all__ = [
    'FILE_IO_COMPARISON_MODES',
    'FILE_IO_VALIDATION_MODES',
    'FileExpectationInputSerializer',
    'FileFixtureInputSerializer',
    'FileIOTestCaseInputSerializer',
    'InlineExpectationInputSerializer',
    'IOTestCaseInputSerializer',
    'MethodStepInputSerializer',
    'OOPClassTestCaseInputSerializer',
    'OOPMainTestCaseInputSerializer',
    'TestSuiteBuildInputSerializer',
    'TestSuiteVersionSerializer',
]
