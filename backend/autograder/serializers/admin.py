from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import serializers

from ..models import UserProfile


class GroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = Group
        fields = ['id', 'name']


class UserAdminSerializer(serializers.ModelSerializer):
    groups = serializers.PrimaryKeyRelatedField(queryset=Group.objects.all(), many=True, required=False)
    cwid = serializers.SerializerMethodField()
    middle_name = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)
    groups_display = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'is_active',
            'is_staff',
            'groups',
            'groups_display',
            'password',
            'cwid',
            'middle_name',
            'display_name',
        ]

    def get_groups_display(self, obj):
        return list(obj.groups.values_list('name', flat=True))

    def _get_profile(self, obj):
        try:
            return obj.profile
        except UserProfile.DoesNotExist:
            return None

    def get_cwid(self, obj):
        profile = self._get_profile(obj)
        return profile.cwid if profile else ''

    def get_middle_name(self, obj):
        profile = self._get_profile(obj)
        return profile.middle_name if profile else ''

    def get_display_name(self, obj):
        profile = self._get_profile(obj)
        return profile.display_name if profile else ''

    def validate(self, attrs):
        cwid = (self.initial_data.get('cwid') or '').strip()
        first_name = (self.initial_data.get('first_name') or '').strip()
        last_name = (self.initial_data.get('last_name') or '').strip()
        middle_name = (self.initial_data.get('middle_name') or '').strip()
        display_name = (self.initial_data.get('display_name') or '').strip()

        if not first_name or not last_name:
            raise serializers.ValidationError({'name': 'First and last name are required.'})

        if not cwid:
            raise serializers.ValidationError({'cwid': 'CWID is required.'})

        qs = UserProfile.objects.filter(cwid=cwid)
        if self.instance:
            qs = qs.exclude(user=self.instance)
        if qs.exists():
            raise serializers.ValidationError({'cwid': 'CWID already exists.'})

        attrs['_profile_data'] = {
            'cwid': cwid,
            'middle_name': middle_name,
            'display_name': display_name,
        }
        return attrs

    def create(self, validated_data):
        groups = validated_data.pop('groups', [])
        profile_data = validated_data.pop('_profile_data', {})
        cwid = profile_data.get('cwid')
        middle_name = profile_data.get('middle_name', '')
        display_name = profile_data.get('display_name', '')
        password = validated_data.pop('password', None)

        if not password:
            raise serializers.ValidationError({'password': 'Password is required.'})

        user = get_user_model().objects.create_user(
            password=password,
            **validated_data,
        )
        if groups:
            user.groups.set(groups)

        UserProfile.objects.create(
            user=user,
            first_name=user.first_name,
            middle_name=middle_name,
            last_name=user.last_name,
            display_name=display_name or f'{user.first_name} {user.last_name}'.strip(),
            cwid=cwid,
        )
        return user

    def update(self, instance, validated_data):
        groups = validated_data.pop('groups', None)
        profile_data = validated_data.pop('_profile_data', {})
        cwid = profile_data.get('cwid', None)
        middle_name = profile_data.get('middle_name', None)
        display_name = profile_data.get('display_name', None)
        password = validated_data.pop('password', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()

        if groups is not None:
            instance.groups.set(groups)

        profile, _ = UserProfile.objects.get_or_create(user=instance)
        if cwid is not None:
            profile.cwid = cwid
        if middle_name is not None:
            profile.middle_name = middle_name
        if display_name is not None:
            profile.display_name = display_name
        profile.first_name = instance.first_name
        profile.last_name = instance.last_name
        profile.save()

        return instance
