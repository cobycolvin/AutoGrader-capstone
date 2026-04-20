from rest_framework import serializers

from ..models import CalendarEvent, CalendarEventScope


class CalendarEventSerializer(serializers.ModelSerializer):
    owner_id = serializers.IntegerField(source='owner.id', read_only=True)
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    course_code = serializers.CharField(source='course.code', read_only=True)
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = CalendarEvent
        fields = [
            'id',
            'title',
            'description',
            'scope',
            'event_type',
            'course',
            'course_code',
            'owner_id',
            'owner_username',
            'start_at',
            'end_at',
            'all_day',
            'timezone',
            'priority',
            'is_important',
            'can_edit',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'owner_id',
            'owner_username',
            'course_code',
            'can_edit',
            'created_at',
            'updated_at',
        ]

    def validate(self, attrs):
        instance = getattr(self, 'instance', None)
        start_at = attrs.get('start_at', instance.start_at if instance else None)
        end_at = attrs.get('end_at', instance.end_at if instance else None)
        if start_at and end_at and end_at < start_at:
            raise serializers.ValidationError({'end_at': 'End time must be after start time.'})

        scope = attrs.get('scope', instance.scope if instance else CalendarEventScope.PERSONAL)
        course = attrs.get('course', instance.course if instance else None)
        if scope == CalendarEventScope.COURSE and not course:
            raise serializers.ValidationError({'course': 'Course is required for course events.'})
        if scope != CalendarEventScope.COURSE and 'course' in attrs:
            attrs['course'] = None

        priority = attrs.get('priority', instance.priority if instance else 2)
        if priority is not None and (priority < 1 or priority > 3):
            raise serializers.ValidationError({'priority': 'Priority must be between 1 and 3.'})

        return attrs

    def get_can_edit(self, obj):
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            return False
        user = request.user
        if user.is_superuser:
            return True
        if obj.scope == CalendarEventScope.PERSONAL:
            return obj.owner_id == user.id
        if obj.scope == CalendarEventScope.GLOBAL:
            return False
        return user.groups.filter(name='Instructor').exists()


class CalendarEventCreateSerializer(CalendarEventSerializer):
    # Keep a narrow writable set on create/update from API clients.
    class Meta(CalendarEventSerializer.Meta):
        read_only_fields = CalendarEventSerializer.Meta.read_only_fields + ['owner_id', 'owner_username']
        extra_kwargs = {
            'scope': {'required': False},
            'event_type': {'required': False},
            'description': {'required': False, 'allow_blank': True},
            'course': {'required': False, 'allow_null': True},
            'end_at': {'required': False, 'allow_null': True},
            'timezone': {'required': False, 'allow_blank': True},
        }
