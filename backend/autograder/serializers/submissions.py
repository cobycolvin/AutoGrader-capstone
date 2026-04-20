from decimal import Decimal
import os
import uuid
import io
import json
import zipfile

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.db.models import Max
from rest_framework import serializers

from ..models import (
    Assignment,
    AssignmentGroup,
    AssignmentGroupMode,
    AIDetectionFinding,
    AIDetectionScan,
    Group,
    GroupMember,
    Submission,
    SubmissionStatus,
    GradingRun,
    TestSuite,
    RubricAttachment,
    TestResult,
    Rubric,
    RubricCriterion,
    RubricScore,
)
from .rubrics import RubricAttachmentSerializer


def _is_safe_relative_path(path):
    normalized = (path or '').replace('\\', '/').strip()
    if not normalized:
        return False
    if normalized.startswith('/'):
        return False
    parts = [part for part in normalized.split('/') if part not in {'', '.'}]
    if not parts or any(part == '..' for part in parts):
        return False
    return True


def _preview_case_text(value, limit=400):
    text = value if isinstance(value, str) else str(value or '')
    if len(text) <= limit:
        return text
    return text[:limit] + '...'


def _safe_zip_text(zip_ref, name):
    source_name = str(name or '').strip()
    if not source_name:
        return ''
    try:
        raw_content = zip_ref.read(source_name)
    except KeyError:
        return ''
    return raw_content.decode('utf-8', errors='replace')


def _build_case_fixture_previews(zip_ref, fixtures):
    previews = []
    for fixture in fixtures or []:
        content = _safe_zip_text(zip_ref, fixture.get('source'))
        previews.append(
            {
                'path': fixture.get('path') or '',
                'content': _preview_case_text(content),
            }
        )
    return previews


def _load_submission_case_definitions(submission):
    run = getattr(submission, '_latest_grading_run', None)
    test_version = None
    if run:
        test_version = run.test_suite_version_private or run.test_suite_version_public
    if not test_version:
        suite = TestSuite.objects.filter(assignment=submission.assignment).select_related('active_version').first()
        test_version = suite.active_version if suite else None
    if not test_version:
        return {}

    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    try:
        source_path = storage.path(test_version.bundle_key)
    except Exception:
        return {}
    if not zipfile.is_zipfile(source_path):
        return {}

    try:
        with zipfile.ZipFile(source_path, 'r') as zip_ref:
            tests_payload = json.loads(zip_ref.read('tests.json').decode('utf-8'))
            suite_type = str(tests_payload.get('type') or '').upper()
            case_details = {}

            if suite_type == 'IO':
                for index, case in enumerate(tests_payload.get('tests') or [], start=1):
                    name = str(case.get('name') or f'case-{index}')
                    case_details[name] = {
                        'input_preview': _preview_case_text(case.get('input', '')),
                        'expected_preview': _preview_case_text(case.get('expected', '')),
                    }
                return case_details

            if suite_type == 'FILE_IO':
                for index, case in enumerate(tests_payload.get('cases') or [], start=1):
                    name = str(case.get('name') or f'case-{index}')
                    entry = {
                        'args': list(case.get('args') or []),
                        'stdin_preview': _preview_case_text(case.get('stdin', '')),
                        'expected_stdout_preview': _preview_case_text(((case.get('expected_stdout') or {}).get('content')) or ''),
                        'expected_stderr_preview': _preview_case_text(((case.get('expected_stderr') or {}).get('content')) or ''),
                        'input_files_preview': _build_case_fixture_previews(zip_ref, case.get('input_files') or []),
                        'expected_files_preview': _build_case_fixture_previews(zip_ref, case.get('expected_files') or []),
                    }
                    if case.get('expected_exit_code') is not None:
                        entry['expected_exit_code'] = case.get('expected_exit_code')
                    case_details[name] = entry
                return case_details

            if suite_type == 'OOP':
                for index, case in enumerate(tests_payload.get('main_tests') or [], start=1):
                    name = str(case.get('name') or f'main-case-{index}')
                    case_details[name] = {
                        'input_preview': _preview_case_text(case.get('input', '')),
                        'expected_preview': _preview_case_text(case.get('expected', '')),
                    }
                for index, case in enumerate(tests_payload.get('class_tests') or [], start=1):
                    name = str(case.get('name') or f'class-case-{index}')
                    case_details[name] = {
                        'args': [
                            f"constructor={json.dumps(case.get('constructor_args', []))}",
                            f"assert={case.get('assert_method') or ''}{json.dumps(case.get('assert_args', []))}",
                        ],
                        'expected_preview': _preview_case_text(json.dumps(case.get('expected'))),
                    }
                return case_details
    except Exception:
        return {}

    return {}


class SubmissionSerializer(serializers.ModelSerializer):
    assignment_id = serializers.UUIDField(write_only=True, required=True)
    assignment_uuid = serializers.UUIDField(source='assignment_id', read_only=True)
    assignment_max_score = serializers.SerializerMethodField()
    file = serializers.FileField(write_only=True, required=False, allow_null=True)
    files = serializers.ListField(
        child=serializers.FileField(),
        write_only=True,
        required=False,
        allow_empty=False,
    )
    group_id = serializers.PrimaryKeyRelatedField(
        source='group',
        queryset=Group.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    group = serializers.PrimaryKeyRelatedField(read_only=True)
    group_name = serializers.CharField(source='group.name', read_only=True)
    group_member_usernames = serializers.SerializerMethodField()
    assignment_title = serializers.CharField(source='assignment.title', read_only=True)
    submitted_by_username = serializers.CharField(source='submitted_by.username', read_only=True)
    grade_score = serializers.SerializerMethodField()
    grade_max_score = serializers.SerializerMethodField()

    class Meta:
        model = Submission
        fields = [
            'id',
            'assignment_id',
            'assignment_uuid',
            'assignment_title',
            'assignment_max_score',
            'submitted_by',
            'submitted_by_username',
            'submitted_at',
            'attempt_number',
            'status',
            'source_bundle_key',
            'file',
            'files',
            'group',
            'group_id',
            'group_name',
            'group_member_usernames',
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

    def get_assignment_max_score(self, obj):
        return obj.assignment.max_score if getattr(obj, 'assignment', None) else None

    def get_group_member_usernames(self, obj):
        group = getattr(obj, 'group', None)
        if not group:
            return []
        members = getattr(group, 'groupmember_set', None)
        if members is None:
            return []
        return sorted(
            member.user.username
            for member in members.all()
            if getattr(member, 'user', None) is not None
        )

    def validate(self, attrs):
        assignment_id = attrs.get('assignment_id')
        if not assignment_id:
            raise serializers.ValidationError({'assignment_id': 'Assignment is required.'})
        return attrs

    @staticmethod
    def _is_zip_upload(upload):
        try:
            if hasattr(upload, 'seek'):
                upload.seek(0)
            return zipfile.is_zipfile(upload)
        finally:
            if hasattr(upload, 'seek'):
                upload.seek(0)

    @staticmethod
    def _safe_upload_name(upload):
        original_name = (getattr(upload, 'name', '') or '').replace('\\', '/').strip()
        return os.path.basename(original_name)

    def create(self, validated_data):
        request = self.context.get('request')
        submitted_by = request.user if request else None
        assignment_id = validated_data.pop('assignment_id')
        requested_group = validated_data.pop('group', None)
        upload = validated_data.pop('file', None)
        validated_data.pop('files', None)
        upload_files = []
        if request:
            upload_files = request.FILES.getlist('files') or request.FILES.getlist('files[]')

        if not upload and len(upload_files) == 1:
            candidate = upload_files[0]
            is_zip = self._is_zip_upload(candidate)
            if is_zip:
                upload = candidate
                upload_files = []

        if upload and upload_files:
            raise serializers.ValidationError({'detail': 'Provide either file or files[], not both.'})

        if not upload and not upload_files:
            raise serializers.ValidationError({'file': 'Submission file is required.'})

        assignment = Assignment.objects.filter(id=assignment_id).first()
        if not assignment:
            raise serializers.ValidationError({'assignment_id': 'Assignment not found.'})
        if not assignment.allows_upload_submission():
            raise serializers.ValidationError(
                {'detail': 'This assignment accepts submissions through the workspace editor only.'}
            )

        group = None
        if assignment.allow_groups:
            if assignment.group_mode == AssignmentGroupMode.REUSABLE_SET:
                if not assignment.group_set_id:
                    raise serializers.ValidationError(
                        {'detail': 'This assignment does not have a reusable group set configured yet.'}
                    )
                valid_groups = list(
                    Group.objects.filter(
                        group_set_id=assignment.group_set_id,
                        groupmember__user=submitted_by,
                    ).distinct()
                )
            else:
                valid_groups = list(
                    Group.objects.filter(
                        assignmentgroup__assignment=assignment,
                        groupmember__user=submitted_by,
                    ).distinct()
                )
                if not valid_groups:
                    assignment_has_groups = AssignmentGroup.objects.filter(assignment=assignment).exists()
                    if not assignment_has_groups:
                        raise serializers.ValidationError(
                            {'detail': 'This assignment does not have any groups configured yet.'}
                        )

            if requested_group is None:
                if len(valid_groups) == 1:
                    group = valid_groups[0]
                elif not valid_groups:
                    raise serializers.ValidationError(
                        {'group_id': 'You are not a member of any valid group for this assignment.'}
                    )
                else:
                    raise serializers.ValidationError(
                        {'group_id': 'Choose your group before submitting this assignment.'}
                    )
            else:
                if assignment.group_mode == AssignmentGroupMode.REUSABLE_SET:
                    if requested_group.group_set_id != assignment.group_set_id:
                        raise serializers.ValidationError(
                            {'group_id': 'Selected group does not belong to this assignment’s reusable group set.'}
                        )
                elif not AssignmentGroup.objects.filter(assignment=assignment, group=requested_group).exists():
                    raise serializers.ValidationError(
                        {'group_id': 'Selected group does not belong to this assignment.'}
                    )
                if not GroupMember.objects.filter(group=requested_group, user=submitted_by).exists():
                    raise serializers.ValidationError(
                        {'group_id': 'You must belong to the selected group before submitting.'}
                    )
                group = requested_group
        elif requested_group is not None:
            raise serializers.ValidationError(
                {'group_id': 'This assignment only accepts individual submissions.'}
            )

        last_attempt = (
            Submission.objects.filter(
                assignment=assignment,
                group=group,
            )
            if group
            else Submission.objects.filter(assignment=assignment, submitted_by=submitted_by)
        ).aggregate(max_attempt=Max('attempt_number')).get('max_attempt') or 0

        max_attempts = assignment.submission_max_attempts or 0
        if max_attempts and last_attempt >= max_attempts:
            raise serializers.ValidationError({'detail': 'Maximum submission attempts reached.'})

        max_size_mb = assignment.submission_max_size_mb or 0
        allowed_types = assignment.submission_file_types or []
        normalized_types = []
        for item in allowed_types:
            item = (item or '').strip().lower()
            if not item:
                continue
            normalized_types.append(item if item.startswith('.') else f'.{item}')

        if upload_files:
            if len(upload_files) > 300:
                raise serializers.ValidationError({'files': 'Too many files. Limit is 300.'})

            files_payload = {}
            total_bytes = 0
            for uploaded in upload_files:
                total_bytes += uploaded.size or 0
                original_name = (uploaded.name or '').replace('\\', '/').strip()
                safe_name = os.path.basename(original_name)
                if not safe_name:
                    raise serializers.ValidationError({'files': 'Each uploaded file must have a valid name.'})
                if safe_name in files_payload:
                    raise serializers.ValidationError({'files': f'Duplicate file name: {safe_name}'})
                if normalized_types:
                    _, ext = os.path.splitext(safe_name)
                    if not ext or ext.lower() not in normalized_types:
                        raise serializers.ValidationError({'files': f'File type {ext or "(none)"} is not allowed.'})
                files_payload[safe_name] = uploaded.read()

            if max_size_mb:
                max_bytes = max_size_mb * 1024 * 1024
                if total_bytes > max_bytes:
                    raise serializers.ValidationError({'files': f'Files exceed {max_size_mb} MB limit.'})

            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
                for name, content in files_payload.items():
                    zip_ref.writestr(name, content)
            upload = ContentFile(buffer.getvalue(), name='submission.zip')
        else:
            if max_size_mb:
                max_bytes = max_size_mb * 1024 * 1024
                if upload.size > max_bytes:
                    raise serializers.ValidationError({'file': f'File exceeds {max_size_mb} MB limit.'})

            safe_name = self._safe_upload_name(upload)
            if not safe_name:
                raise serializers.ValidationError({'file': 'Uploaded file must have a valid name.'})

            if normalized_types:
                _, ext = os.path.splitext(safe_name)
                ext = ext.lower()
                if not ext or ext not in normalized_types:
                    raise serializers.ValidationError({'file': f'File type {ext or "(none)"} is not allowed.'})

            if not self._is_zip_upload(upload):
                content = upload.read()
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
                    zip_ref.writestr(safe_name, content)
                upload = ContentFile(buffer.getvalue(), name='submission.zip')

        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        filename = f"{uuid.uuid4().hex}_{upload.name}"
        owner_segment = f'groups/{group.id}' if group else str(submitted_by.id)
        path = os.path.join('submissions', str(assignment.id), owner_segment, filename)
        stored_path = storage.save(path, upload)

        submission = Submission.objects.create(
            assignment=assignment,
            submitted_by=submitted_by,
            group=group,
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
    rubric = serializers.SerializerMethodField()

    def get_submission(self, obj):
        return SubmissionSerializer(obj).data

    def get_grade(self, obj):
        grade = getattr(obj, 'grade', None)
        if not grade:
            return None
        return {
            'score': grade.score,
            'max_score': grade.max_score,
            'feedback': grade.feedback,
            'released_to_student': grade.released_to_student,
            'released_at': grade.released_at,
        }

    def get_grading_run(self, obj):
        run = getattr(obj, '_latest_grading_run', None)
        if not run:
            return None
        return GradingRunSerializer(run).data

    def get_test_results(self, obj):
        results = list(getattr(obj, '_latest_test_results', None) or [])
        serialized = TestResultSerializer(results, many=True).data
        run = getattr(obj, '_latest_grading_run', None)
        case_definitions = _load_submission_case_definitions(obj)
        run_tests = []
        if run and isinstance(getattr(run, 'result_json', None), dict):
            run_tests = list(run.result_json.get('tests') or [])

        run_entries_by_name = {}
        for entry in run_tests:
            name = str(entry.get('name') or '')
            run_entries_by_name.setdefault(name, []).append(entry)

        enriched = []
        for index, item in enumerate(serialized):
            item = dict(item)
            run_entry = None
            if index < len(run_tests):
                candidate = run_tests[index]
                if str(candidate.get('name') or '') == str(item.get('test_name') or ''):
                    run_entry = candidate
            if run_entry is None:
                bucket = run_entries_by_name.get(str(item.get('test_name') or ''), [])
                if bucket:
                    run_entry = bucket.pop(0)

            item['summary'] = item.get('message') or ''
            item['failure_kind'] = ''
            item['details'] = dict(case_definitions.get(str(item.get('test_name') or ''), {}) or {})
            if run_entry:
                item['summary'] = run_entry.get('summary') or item['summary']
                item['failure_kind'] = run_entry.get('failure_kind') or ''
                item['details'].update(run_entry.get('details') or {})
                if run_entry.get('message') and not item.get('message'):
                    item['message'] = run_entry.get('message')
            if not item['summary'] and item['details']:
                item['summary'] = 'Configured test details are available.'
            enriched.append(item)

        if enriched:
            return enriched

        fallback_results = []
        for index, entry in enumerate(run_tests):
            fallback_results.append(
                {
                    'id': f'run-{index}',
                    'test_name': entry.get('name') or f'test-{index + 1}',
                    'status': entry.get('status') or '',
                    'points_awarded': None,
                    'time_ms': entry.get('time_ms'),
                    'message': entry.get('message') or '',
                    'summary': entry.get('summary') or entry.get('message') or '',
                    'failure_kind': entry.get('failure_kind') or '',
                    'details': {
                        **dict(case_definitions.get(str((entry.get('name') or f'test-{index + 1}')), {}) or {}),
                        **(entry.get('details') or {}),
                    },
                }
            )
        return fallback_results

    def get_rubric(self, obj):
        return getattr(obj, '_rubric_payload', None)


class SubmissionGradeOverrideSerializer(serializers.Serializer):
    score = serializers.DecimalField(max_digits=10, decimal_places=2)
    max_score = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    feedback = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)

    def validate_score(self, value):
        if value < 0:
            raise serializers.ValidationError('score must be zero or positive.')
        return value

    def validate_max_score(self, value):
        if value <= 0:
            raise serializers.ValidationError('max_score must be greater than zero.')
        return value


class SubmissionRubricCriterionScoreSerializer(serializers.Serializer):
    criterion_id = serializers.UUIDField()
    points_awarded = serializers.DecimalField(max_digits=7, decimal_places=2)
    comment = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)

    def validate_points_awarded(self, value):
        if value < 0:
            raise serializers.ValidationError('points_awarded must be zero or positive.')
        return value


class SubmissionRubricGradeSerializer(serializers.Serializer):
    rubric_version_id = serializers.UUIDField(required=False)
    criteria = SubmissionRubricCriterionScoreSerializer(many=True)

    def validate(self, attrs):
        if not attrs.get('criteria'):
            raise serializers.ValidationError({'criteria': ['Add at least one rubric score.']})
        return attrs


def build_submission_rubric_payload(submission):
    rubric = Rubric.objects.filter(assignment=submission.assignment).select_related('active_version').first()
    existing_scores = list(
        RubricScore.objects.select_related('rubric_criterion', 'rubric_criterion__rubric_version')
        .filter(submission=submission)
        .order_by('rubric_criterion__order_index', 'created_at')
    )

    saved_version = None
    if existing_scores:
        saved_version = existing_scores[0].rubric_criterion.rubric_version

    version = saved_version or (rubric.active_version if rubric else None)
    if not version:
        return {
            'available': False,
            'version_id': '',
            'version_number': 0,
            'is_weighted': False,
            'criteria': [],
            'attachments': [],
            'total_points': Decimal('0.00'),
            'total_weight': Decimal('0.00'),
            'computed_score': Decimal('0.00'),
            'computed_max_score': Decimal('0.00'),
            'has_saved_scores': False,
        }

    criteria = list(RubricCriterion.objects.filter(rubric_version=version).order_by('order_index', 'created_at'))
    attachments = list(
        RubricAttachment.objects.filter(rubric_version=version)
        .select_related('uploaded_by', 'rubric_version__rubric')
        .order_by('display_order', 'created_at')
    )
    scores_by_criterion_id = {}
    for score in existing_scores:
        if score.rubric_criterion.rubric_version_id == version.id:
            scores_by_criterion_id[str(score.rubric_criterion_id)] = score

    total_points = sum((criterion.max_points for criterion in criteria), Decimal('0.00'))
    total_weight = sum((criterion.weight or Decimal('0.00') for criterion in criteria), Decimal('0.00'))
    grading_max_score = Decimal(str(submission.assignment.max_score or 0))
    if grading_max_score <= 0:
        grading_max_score = total_points

    entries = []
    awarded_total = Decimal('0.00')
    weighted_ratio = Decimal('0.00')
    for criterion in criteria:
        score = scores_by_criterion_id.get(str(criterion.id))
        points_awarded = score.points_awarded if score else Decimal('0.00')
        comment = score.comment if score else ''
        awarded_total += points_awarded
        if version.is_weighted and total_weight > 0 and criterion.max_points > 0 and criterion.weight:
            weighted_ratio += (points_awarded / criterion.max_points) * (criterion.weight / total_weight)
        entries.append(
            {
                'criterion_id': criterion.id,
                'name': criterion.name,
                'max_points': criterion.max_points,
                'weight': criterion.weight,
                'order_index': criterion.order_index,
                'points_awarded': points_awarded,
                'comment': comment,
            }
        )

    if version.is_weighted:
        computed_score = (weighted_ratio * grading_max_score) if grading_max_score > 0 else Decimal('0.00')
        computed_max_score = grading_max_score
    else:
        if total_points > 0 and grading_max_score > 0:
            computed_score = (awarded_total / total_points) * grading_max_score
            computed_max_score = grading_max_score
        else:
            computed_score = awarded_total
            computed_max_score = total_points

    return {
        'available': True,
        'version_id': str(version.id),
        'version_number': version.version_number,
        'is_weighted': version.is_weighted,
        'criteria': entries,
        'attachments': RubricAttachmentSerializer(attachments, many=True).data,
        'total_points': total_points.quantize(Decimal('0.01')),
        'total_weight': total_weight.quantize(Decimal('0.01')),
        'computed_score': computed_score.quantize(Decimal('0.01')),
        'computed_max_score': computed_max_score.quantize(Decimal('0.01')),
        'has_saved_scores': bool(scores_by_criterion_id),
    }


class SubmissionConsoleRunSerializer(serializers.Serializer):
    stdin = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)
    timeout_ms = serializers.IntegerField(required=False, min_value=250, max_value=10000, default=5000)


class SubmissionFileRunInputFileSerializer(serializers.Serializer):
    path = serializers.CharField(max_length=255)
    content = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)

    def validate_path(self, value):
        if not _is_safe_relative_path(value):
            raise serializers.ValidationError('path must be a safe relative path.')
        return value


class SubmissionFileRunSerializer(serializers.Serializer):
    args = serializers.ListField(
        child=serializers.CharField(allow_blank=True, max_length=300),
        required=False,
        default=list,
    )
    stdin = serializers.CharField(required=False, allow_blank=True, default='', trim_whitespace=False)
    timeout_ms = serializers.IntegerField(required=False, min_value=250, max_value=15000, default=5000)
    input_files = SubmissionFileRunInputFileSerializer(many=True, required=False, default=list)


class AIDetectionFindingSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIDetectionFinding
        fields = ['id', 'file_path', 'start_line', 'end_line', 'confidence']


class AIDetectionScanSerializer(serializers.ModelSerializer):
    findings = AIDetectionFindingSerializer(many=True, read_only=True)
    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AIDetectionScan
        fields = [
            'id',
            'status',
            'model_version',
            'overall_score',
            'verdict',
            'completed_at',
            'error_message',
            'requested_by_name',
            'findings',
            'created_at',
        ]

    def get_requested_by_name(self, obj):
        if obj.requested_by:
            return obj.requested_by.get_full_name() or obj.requested_by.username
        return None
