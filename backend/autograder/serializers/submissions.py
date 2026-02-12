import os
import uuid

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db.models import Max
from rest_framework import serializers

from ..models import Assignment, Submission, SubmissionStatus, GradingRun, TestResult


class SubmissionSerializer(serializers.ModelSerializer):
    assignment_id = serializers.UUIDField(write_only=True, required=True)
    file = serializers.FileField(write_only=True, required=False, allow_null=True)
    assignment_title = serializers.CharField(source='assignment.title', read_only=True)
    submitted_by_username = serializers.CharField(source='submitted_by.username', read_only=True)
    grade_score = serializers.SerializerMethodField()
    grade_max_score = serializers.SerializerMethodField()

    class Meta:
        model = Submission
        fields = [
            'id',
            'assignment_id',
            'assignment_title',
            'submitted_by',
            'submitted_by_username',
            'submitted_at',
            'attempt_number',
            'status',
            'source_bundle_key',
            'file',
            'grade_score',
            'grade_max_score',
        ]
        read_only_fields = [
            'id',
            'submitted_by',
            'submitted_at',
            'attempt_number',
            'status',
            'source_bundle_key',
            'grade_score',
            'grade_max_score',
        ]

    def get_grade_score(self, obj):
        return obj.grade.score if hasattr(obj, 'grade') else None

    def get_grade_max_score(self, obj):
        return obj.grade.max_score if hasattr(obj, 'grade') else None

    def validate(self, attrs):
        assignment_id = attrs.get('assignment_id')
        if not assignment_id:
            raise serializers.ValidationError({'assignment_id': 'Assignment is required.'})
        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        submitted_by = request.user if request else None
        assignment_id = validated_data.pop('assignment_id')
        upload = validated_data.pop('file', None)

        if not upload:
            raise serializers.ValidationError({'file': 'Submission file is required.'})

        assignment = Assignment.objects.filter(id=assignment_id).first()
        if not assignment:
            raise serializers.ValidationError({'assignment_id': 'Assignment not found.'})

        last_attempt = (
            Submission.objects.filter(assignment=assignment, submitted_by=submitted_by)
            .aggregate(max_attempt=Max('attempt_number'))
            .get('max_attempt')
            or 0
        )

        max_attempts = assignment.submission_max_attempts or 0
        if max_attempts and last_attempt >= max_attempts:
            raise serializers.ValidationError({'detail': 'Maximum submission attempts reached.'})

        max_size_mb = assignment.submission_max_size_mb or 0
        if max_size_mb:
            max_bytes = max_size_mb * 1024 * 1024
            if upload.size > max_bytes:
                raise serializers.ValidationError({'file': f'File exceeds {max_size_mb} MB limit.'})

        allowed_types = assignment.submission_file_types or []
        if allowed_types:
            _, ext = os.path.splitext(upload.name or '')
            ext = ext.lower()
            normalized = []
            for item in allowed_types:
                item = (item or '').strip().lower()
                if not item:
                    continue
                normalized.append(item if item.startswith('.') else f'.{item}')
            if not ext or ext not in normalized:
                raise serializers.ValidationError({'file': f'File type {ext or "(none)"} is not allowed.'})

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        filename = f"{uuid.uuid4().hex}_{upload.name}"
        path = os.path.join('submissions', str(assignment.id), str(submitted_by.id), filename)
        stored_path = storage.save(path, upload)

        submission = Submission.objects.create(
            assignment=assignment,
            submitted_by=submitted_by,
            attempt_number=last_attempt + 1,
            status=SubmissionStatus.QUEUED,
            source_bundle_key=stored_path,
        )
        return submission


class TestResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestResult
        fields = [
            'id',
            'test_name',
            'status',
            'points_awarded',
            'time_ms',
            'message',
        ]
        read_only_fields = fields


class GradingRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = GradingRun
        fields = [
            'id',
            'started_at',
            'finished_at',
            'exit_status',
            'stdout_key',
            'stderr_key',
            'result_json',
        ]
        read_only_fields = fields


class SubmissionDetailSerializer(serializers.Serializer):
    submission = serializers.SerializerMethodField()
    grade = serializers.SerializerMethodField()
    grading_run = serializers.SerializerMethodField()
    test_results = serializers.SerializerMethodField()

    def get_submission(self, obj):
        return SubmissionSerializer(obj).data

    def get_grade(self, obj):
        grade = getattr(obj, 'grade', None)
        if not grade:
            return None
        return {
            'score': grade.score,
            'max_score': grade.max_score,
            'released_to_student': grade.released_to_student,
            'released_at': grade.released_at,
        }

    def get_grading_run(self, obj):
        run = getattr(obj, '_latest_grading_run', None)
        if not run:
            return None
        return GradingRunSerializer(run).data

    def get_test_results(self, obj):
        results = getattr(obj, '_latest_test_results', None) or []
        return TestResultSerializer(results, many=True).data
