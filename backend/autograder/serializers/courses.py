from django.contrib.auth import get_user_model
from rest_framework import serializers

from ..models import Course, Enrollment, EnrollmentRole, EnrollmentStatus, UserProfile


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
