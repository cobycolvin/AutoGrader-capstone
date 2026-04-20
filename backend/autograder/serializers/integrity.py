from rest_framework import serializers

from ..models import IntegrityFinding, IntegrityScan, IntegrityScanProvider, IntegrityScanStatus, IntegrityScanType


class IntegrityScanRunSerializer(serializers.Serializer):
    threshold = serializers.FloatField(required=False, min_value=0, max_value=100, default=35)
    latest_only = serializers.BooleanField(required=False, default=True)
    excluded_paths = serializers.ListField(
        child=serializers.CharField(max_length=255),
        required=False,
        allow_empty=True,
        default=list,
    )

    def validate_excluded_paths(self, value):
        normalized = []
        seen = set()
        for path in value or []:
            item = str(path or '').replace('\\', '/').strip().lstrip('./')
            if not item:
                continue
            lowered = item.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            normalized.append(item)
        return normalized


class IntegrityScanSerializer(serializers.ModelSerializer):
    findings_count = serializers.SerializerMethodField()
    highest_score = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    latest_only = serializers.SerializerMethodField()
    threshold = serializers.SerializerMethodField()
    excluded_paths = serializers.SerializerMethodField()
    manual_excluded_paths = serializers.SerializerMethodField()
    auto_excluded_paths = serializers.SerializerMethodField()

    class Meta:
        model = IntegrityScan
        fields = [
            'id',
            'scan_type',
            'provider',
            'status',
            'algorithm_version',
            'config_json',
            'latest_only',
            'threshold',
            'excluded_paths',
            'manual_excluded_paths',
            'auto_excluded_paths',
            'error_message',
            'result_url',
            'created_at',
            'completed_at',
            'created_by_username',
            'findings_count',
            'highest_score',
        ]
        read_only_fields = fields

    def get_findings_count(self, obj):
        return obj.integrityfinding_set.count()

    def get_highest_score(self, obj):
        top_finding = obj.integrityfinding_set.order_by('-score').first()
        return float(top_finding.score) if top_finding else None

    def get_latest_only(self, obj):
        return bool((obj.config_json or {}).get('latest_only', True))

    def get_threshold(self, obj):
        return float((obj.config_json or {}).get('threshold', 35))

    def get_excluded_paths(self, obj):
        return list((obj.config_json or {}).get('excluded_paths') or [])

    def get_manual_excluded_paths(self, obj):
        config = obj.config_json or {}
        value = config.get('manual_excluded_paths')
        if value is None:
            value = config.get('excluded_paths') or []
        return list(value or [])

    def get_auto_excluded_paths(self, obj):
        return list((obj.config_json or {}).get('auto_excluded_paths') or [])


class IntegrityFindingSerializer(serializers.ModelSerializer):
    owner_label = serializers.SerializerMethodField()
    matched_owner_label = serializers.SerializerMethodField()
    owner_members = serializers.SerializerMethodField()
    matched_owner_members = serializers.SerializerMethodField()
    matched_files = serializers.SerializerMethodField()
    matched_files_count = serializers.SerializerMethodField()
    submission_context = serializers.SerializerMethodField()
    matched_submission_context = serializers.SerializerMethodField()

    class Meta:
        model = IntegrityFinding
        fields = [
            'id',
            'score',
            'created_at',
            'owner_label',
            'matched_owner_label',
            'owner_members',
            'matched_owner_members',
            'matched_files_count',
            'matched_files',
            'submission_context',
            'matched_submission_context',
        ]
        read_only_fields = fields

    def _details(self, obj):
        return obj.details_json or {}

    def _submission_context(self, submission):
        if not submission:
            return None
        return {
            'id': str(submission.id),
            'attempt_number': submission.attempt_number,
            'submitted_at': submission.submitted_at,
            'submitted_by_username': submission.submitted_by.username,
            'group_name': submission.group.name if submission.group_id else '',
        }

    def get_owner_label(self, obj):
        return (self._details(obj).get('left_owner_label') or '').strip()

    def get_matched_owner_label(self, obj):
        return (self._details(obj).get('right_owner_label') or '').strip()

    def get_owner_members(self, obj):
        return list(self._details(obj).get('left_owner_members') or [])

    def get_matched_owner_members(self, obj):
        return list(self._details(obj).get('right_owner_members') or [])

    def get_matched_files(self, obj):
        return list(self._details(obj).get('matched_files') or [])

    def get_matched_files_count(self, obj):
        return len(self.get_matched_files(obj))

    def get_submission_context(self, obj):
        return self._submission_context(obj.submission)

    def get_matched_submission_context(self, obj):
        return self._submission_context(obj.matched_submission)
