from rest_framework import serializers


class CourseGradeSummarySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    user_id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.EmailField()
    display_name = serializers.CharField()
    cwid = serializers.CharField()
    total_score = serializers.DecimalField(max_digits=10, decimal_places=2)
    total_max_score = serializers.DecimalField(max_digits=10, decimal_places=2)
    percent = serializers.FloatField()


class CourseAssignmentGradeSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    assignment_id = serializers.UUIDField()
    assignment_title = serializers.CharField()
    due_at = serializers.DateTimeField(allow_null=True)
    status = serializers.CharField()
    attempt_number = serializers.IntegerField(allow_null=True)
    submitted_at = serializers.DateTimeField(allow_null=True)
    score = serializers.DecimalField(max_digits=10, decimal_places=2)
    max_score = serializers.DecimalField(max_digits=10, decimal_places=2)
    percent = serializers.FloatField()
    feedback = serializers.CharField(allow_blank=True, required=False)
    group_name = serializers.CharField(allow_blank=True, required=False)
    group_member_usernames = serializers.ListField(child=serializers.CharField(), required=False)
    submitted_by_username = serializers.CharField(allow_blank=True, required=False)


class CourseAssignmentStudentGradeSerializer(serializers.Serializer):
    id = serializers.CharField()
    assignment_id = serializers.UUIDField()
    assignment_title = serializers.CharField()
    due_at = serializers.DateTimeField(allow_null=True)
    user_id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.EmailField(allow_blank=True)
    display_name = serializers.CharField()
    cwid = serializers.CharField(allow_blank=True)
    grade_state = serializers.CharField()
    status = serializers.CharField()
    attempt_number = serializers.IntegerField(allow_null=True)
    submitted_at = serializers.DateTimeField(allow_null=True)
    score = serializers.DecimalField(max_digits=10, decimal_places=2)
    max_score = serializers.DecimalField(max_digits=10, decimal_places=2)
    percent = serializers.FloatField()
    feedback = serializers.CharField(allow_blank=True, required=False)
    group_name = serializers.CharField(allow_blank=True, required=False)
    group_member_usernames = serializers.ListField(child=serializers.CharField(), required=False)
    submitted_by_username = serializers.CharField(allow_blank=True, required=False)


class CourseGradeOverrideSerializer(serializers.Serializer):
    assignment_id = serializers.UUIDField()
    user_id = serializers.IntegerField()
    score = serializers.DecimalField(max_digits=10, decimal_places=2)
    max_score = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)

    def validate_score(self, value):
        if value < 0:
            raise serializers.ValidationError('score must be zero or positive.')
        return value

    def validate_max_score(self, value):
        if value <= 0:
            raise serializers.ValidationError('max_score must be greater than zero.')
        return value


class CourseGradeReportRequestSerializer(serializers.Serializer):
    user_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
    )
    assignment_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        default=list,
    )
    include_all_assignments = serializers.BooleanField(required=False, default=True)

    def validate(self, attrs):
        if not attrs.get('include_all_assignments', True) and not attrs.get('assignment_ids'):
            raise serializers.ValidationError({'assignment_ids': 'Select one or more assignments or choose all assignments.'})
        return attrs
