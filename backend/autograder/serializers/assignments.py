from rest_framework import serializers

from ..models import Assignment, RubricCriterion, RubricVersion, Submission


class AssignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Assignment
        fields = [
            'id', 'course', 'title', 'description',
            'due_at', 'max_score', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class RubricCriterionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RubricCriterion
        fields = ['id', 'name', 'max_points', 'order_index']


class SubmissionSerializer(serializers.ModelSerializer):
    submitted_by = serializers.StringRelatedField(read_only=True)
    grade_score = serializers.SerializerMethodField()

    class Meta:
        model = Submission
        fields = [
            'id', 'assignment', 'submitted_by', 'content',
            'status', 'attempt_number', 'submitted_at', 'grade_score',
        ]
        read_only_fields = ['id', 'submitted_by', 'status', 'attempt_number', 'submitted_at', 'grade_score']

    def get_grade_score(self, obj):
        try:
            g = obj.grade
            return {'score': str(g.score), 'max_score': str(g.max_score)}
        except Exception:
            return None
