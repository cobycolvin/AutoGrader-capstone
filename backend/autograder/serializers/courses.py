from django.contrib.auth import get_user_model
from rest_framework import serializers

from ..models import (
    Course,
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    Group,
    GroupMember,
    GroupSet,
    PendingEnrollment,
    UserProfile,
)


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = [
            'id',
            'code',
            'title',
            'term',
            'section',
            'is_active',
            'archived_at',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class CourseEnrollmentSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source='course.id')
    code = serializers.CharField(source='course.code')
    title = serializers.CharField(source='course.title')
    term = serializers.CharField(source='course.term')
    section = serializers.CharField(source='course.section')
    is_active = serializers.BooleanField(source='course.is_active')

    class Meta:
        model = Enrollment
        fields = [
            'id',
            'code',
            'title',
            'term',
            'section',
            'is_active',
            'role',
            'status',
        ]


class CoursePersonSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source='user.id')
    username = serializers.CharField(source='user.username')
    email = serializers.EmailField(source='user.email')
    first_name = serializers.SerializerMethodField()
    middle_name = serializers.SerializerMethodField()
    last_name = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    cwid = serializers.SerializerMethodField()

    class Meta:
        model = Enrollment
        fields = [
            'id',
            'user_id',
            'username',
            'email',
            'first_name',
            'middle_name',
            'last_name',
            'display_name',
            'cwid',
            'role',
            'status',
        ]

    def _get_profile(self, obj):
        try:
            return obj.user.profile
        except UserProfile.DoesNotExist:
            return None

    def get_first_name(self, obj):
        profile = self._get_profile(obj)
        if profile and profile.first_name:
            return profile.first_name
        return obj.user.first_name

    def get_middle_name(self, obj):
        profile = self._get_profile(obj)
        return profile.middle_name if profile else ''

    def get_last_name(self, obj):
        profile = self._get_profile(obj)
        if profile and profile.last_name:
            return profile.last_name
        return obj.user.last_name

    def get_display_name(self, obj):
        profile = self._get_profile(obj)
        if profile and profile.display_name:
            return profile.display_name
        full_name = " ".join(part for part in [obj.user.first_name, obj.user.last_name] if part)
        return full_name or obj.user.get_username()

    def get_cwid(self, obj):
        profile = self._get_profile(obj)
        return profile.cwid if profile else ''


class CourseEnrollmentCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(required=False)
    username = serializers.CharField(required=False, allow_blank=False)
    email = serializers.EmailField(required=False)
    cwid = serializers.CharField(required=False, allow_blank=False)
    role = serializers.ChoiceField(choices=EnrollmentRole.choices, default=EnrollmentRole.STUDENT)
    status = serializers.ChoiceField(choices=EnrollmentStatus.choices, default=EnrollmentStatus.ACTIVE)

    def validate(self, attrs):
        identifiers = {
            'user_id': attrs.get('user_id'),
            'username': attrs.get('username'),
            'email': attrs.get('email'),
            'cwid': attrs.get('cwid'),
        }
        provided = [key for key, value in identifiers.items() if value]
        if len(provided) != 1:
            raise serializers.ValidationError(
                'Provide exactly one identifier: user_id, username, email, or cwid.'
            )
        return attrs

    def resolve_user(self):
        data = self.validated_data
        user_model = get_user_model()
        if data.get('user_id'):
            return user_model.objects.filter(id=data['user_id']).first()
        if data.get('username'):
            return user_model.objects.filter(username=data['username']).first()
        if data.get('email'):
            return user_model.objects.filter(email=data['email']).first()
        if data.get('cwid'):
            profile = UserProfile.objects.filter(cwid=data['cwid']).select_related('user').first()
            return profile.user if profile else None
        return None


class UserLookupSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    cwid = serializers.SerializerMethodField()
    middle_name = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'middle_name',
            'last_name',
            'display_name',
            'cwid',
        ]

    def _get_profile(self, obj):
        try:
            return obj.profile
        except UserProfile.DoesNotExist:
            return None

    def get_middle_name(self, obj):
        profile = self._get_profile(obj)
        return profile.middle_name if profile else ''

    def get_display_name(self, obj):
        profile = self._get_profile(obj)
        if profile and profile.display_name:
            return profile.display_name
        full_name = " ".join(part for part in [obj.first_name, obj.last_name] if part)
        return full_name or obj.get_username()

    def get_cwid(self, obj):
        profile = self._get_profile(obj)
        return profile.cwid if profile else ''


class CourseRosterImportSerializer(serializers.Serializer):
    file = serializers.FileField()


class PendingEnrollmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PendingEnrollment
        fields = [
            'id',
            'display_name',
            'student_name',
            'first_name',
            'middle_name',
            'last_name',
            'cwid',
            'sis_login_id',
            'section',
            'status',
            'created_at',
            'claimed_at',
        ]


class CourseGroupMemberSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source='user.id')
    username = serializers.CharField(source='user.username')
    email = serializers.EmailField(source='user.email')
    first_name = serializers.SerializerMethodField()
    middle_name = serializers.SerializerMethodField()
    last_name = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    cwid = serializers.SerializerMethodField()

    class Meta:
        model = GroupMember
        fields = [
            'id',
            'user_id',
            'username',
            'email',
            'first_name',
            'middle_name',
            'last_name',
            'display_name',
            'cwid',
            'joined_at',
        ]

    def _get_profile(self, obj):
        try:
            return obj.user.profile
        except UserProfile.DoesNotExist:
            return None

    def get_first_name(self, obj):
        profile = self._get_profile(obj)
        if profile and profile.first_name:
            return profile.first_name
        return obj.user.first_name

    def get_middle_name(self, obj):
        profile = self._get_profile(obj)
        return profile.middle_name if profile else ''

    def get_last_name(self, obj):
        profile = self._get_profile(obj)
        if profile and profile.last_name:
            return profile.last_name
        return obj.user.last_name

    def get_display_name(self, obj):
        profile = self._get_profile(obj)
        if profile and profile.display_name:
            return profile.display_name
        full_name = " ".join(part for part in [obj.user.first_name, obj.user.last_name] if part)
        return full_name or obj.user.get_username()

    def get_cwid(self, obj):
        profile = self._get_profile(obj)
        return profile.cwid if profile else ''


class CourseGroupSerializer(serializers.ModelSerializer):
    group_set_id = serializers.UUIDField(source='group_set.id', allow_null=True, read_only=True)
    member_count = serializers.SerializerMethodField()
    members = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = [
            'id',
            'name',
            'group_set_id',
            'member_count',
            'members',
        ]

    def get_member_count(self, obj):
        members = getattr(obj, 'prefetched_members', None)
        if members is not None:
            return len(members)
        return GroupMember.objects.filter(group=obj).count()

    def get_members(self, obj):
        members = getattr(obj, 'prefetched_members', None)
        if members is None:
            members = list(
                GroupMember.objects.select_related('user', 'user__profile')
                .filter(group=obj)
                .order_by('user__last_name', 'user__first_name', 'user__username')
            )
        return CourseGroupMemberSerializer(members, many=True).data


class CourseGroupSetSerializer(serializers.ModelSerializer):
    group_count = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    groups = serializers.SerializerMethodField()

    class Meta:
        model = GroupSet
        fields = [
            'id',
            'name',
            'group_count',
            'member_count',
            'groups',
        ]

    def get_group_count(self, obj):
        groups = getattr(obj, 'prefetched_groups', None)
        if groups is not None:
            return len(groups)
        return Group.objects.filter(group_set=obj).count()

    def get_member_count(self, obj):
        groups = getattr(obj, 'prefetched_groups', None)
        if groups is None:
            groups = list(
                Group.objects.filter(group_set=obj).prefetch_related('groupmember_set')
            )
        return sum(len(getattr(group, 'prefetched_members', None) or list(group.groupmember_set.all())) for group in groups)

    def get_groups(self, obj):
        groups = getattr(obj, 'prefetched_groups', None)
        if groups is None:
            groups = list(
                Group.objects.filter(group_set=obj)
                .select_related('group_set')
                .order_by('name')
            )
        return CourseGroupSerializer(groups, many=True).data


class CourseGroupSetWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)

    def validate_name(self, value):
        course = self.context['course']
        query = GroupSet.objects.filter(course=course, name__iexact=value.strip())
        instance = self.context.get('instance')
        if instance:
            query = query.exclude(id=instance.id)
        if query.exists():
            raise serializers.ValidationError('A group set with this name already exists.')
        return value.strip()


class CourseGroupWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    group_set_id = serializers.UUIDField()

    def validate(self, attrs):
        course = self.context['course']
        group_set = GroupSet.objects.filter(id=attrs['group_set_id'], course=course).first()
        if not group_set:
            raise serializers.ValidationError({'group_set_id': 'Group set not found for this course.'})

        query = Group.objects.filter(course=course, group_set=group_set, name__iexact=attrs['name'].strip())
        instance = self.context.get('instance')
        if instance:
            query = query.exclude(id=instance.id)
        if query.exists():
            raise serializers.ValidationError({'name': 'A group with this name already exists in the selected set.'})

        attrs['name'] = attrs['name'].strip()
        attrs['group_set'] = group_set
        return attrs


class CourseGroupMemberCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(required=False)
    user_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_empty=False,
    )

    def validate(self, attrs):
        single_user_id = attrs.get('user_id')
        multiple_user_ids = attrs.get('user_ids') or []

        provided = bool(single_user_id) + bool(multiple_user_ids)
        if provided != 1:
            raise serializers.ValidationError('Provide either user_id or user_ids.')

        normalized = [single_user_id] if single_user_id else list(multiple_user_ids)
        deduped = []
        seen = set()
        for user_id in normalized:
            if user_id in seen:
                continue
            seen.add(user_id)
            deduped.append(user_id)
        attrs['resolved_user_ids'] = deduped
        return attrs
