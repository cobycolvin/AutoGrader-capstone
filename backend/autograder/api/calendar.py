from datetime import datetime, time

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import CalendarEvent, CalendarEventScope, Enrollment, EnrollmentRole, EnrollmentStatus
from ..serializers.calendar import CalendarEventCreateSerializer, CalendarEventSerializer


class CalendarEventViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return CalendarEventCreateSerializer
        return CalendarEventSerializer

    def get_queryset(self):
        user = self.request.user
        qs = CalendarEvent.objects.select_related('owner', 'course').order_by('start_at', 'title')

        if user.is_superuser:
            visible = qs
        else:
            enrolled_course_ids = list(
                Enrollment.objects.filter(
                    user=user,
                    status=EnrollmentStatus.ACTIVE,
                ).values_list('course_id', flat=True)
            )
            visible = qs.filter(
                Q(scope=CalendarEventScope.PERSONAL, owner=user)
                | Q(scope=CalendarEventScope.COURSE, course_id__in=enrolled_course_ids)
                | Q(scope=CalendarEventScope.GLOBAL)
            )

        course_id = self.request.query_params.get('course_id')
        if course_id:
            visible = visible.filter(course_id=course_id)

        start_at = self._parse_datetime_param(self.request.query_params.get('start'), bound='start')
        end_at = self._parse_datetime_param(self.request.query_params.get('end'), bound='end')
        if start_at and end_at and end_at < start_at:
            raise ValidationError({'end': 'end must be after start.'})
        if start_at:
            visible = visible.filter(
                Q(end_at__gte=start_at) | Q(end_at__isnull=True, start_at__gte=start_at)
            )
        if end_at:
            visible = visible.filter(start_at__lte=end_at)

        return visible

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        scope = serializer.validated_data.get('scope', CalendarEventScope.PERSONAL)
        course = serializer.validated_data.get('course')
        self._assert_can_write_scope(request.user, scope, course)
        serializer.save(owner=request.user, created_by=request.user)
        output = CalendarEventSerializer(serializer.instance, context=self.get_serializer_context())
        return Response(output.data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        instance = serializer.instance
        self._assert_can_edit_event(self.request.user, instance)
        next_scope = serializer.validated_data.get('scope', instance.scope)
        next_course = serializer.validated_data.get('course', instance.course)
        self._assert_can_write_scope(self.request.user, next_scope, next_course)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_can_edit_event(self.request.user, instance)
        instance.delete()

    def _assert_can_write_scope(self, user, scope, course):
        if user.is_superuser:
            return
        if scope == CalendarEventScope.PERSONAL:
            return
        if scope == CalendarEventScope.GLOBAL:
            raise PermissionDenied('Only superusers can create global events.')
        if scope == CalendarEventScope.COURSE:
            if not course:
                raise ValidationError({'course': 'Course is required for course events.'})
            if user.groups.filter(name='Instructor').exists():
                return
            allowed = Enrollment.objects.filter(
                course=course,
                user=user,
                status=EnrollmentStatus.ACTIVE,
                role__in=[EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA],
            ).exists()
            if not allowed:
                raise PermissionDenied('Only instructors or TAs can create course events.')
            return
        raise ValidationError({'scope': 'Unsupported scope value.'})

    def _assert_can_edit_event(self, user, event):
        if user.is_superuser:
            return
        if event.scope == CalendarEventScope.PERSONAL:
            if event.owner_id == user.id:
                return
            raise PermissionDenied('You can only edit your own personal events.')
        if event.scope == CalendarEventScope.COURSE:
            if user.groups.filter(name='Instructor').exists():
                return
            allowed = Enrollment.objects.filter(
                course=event.course,
                user=user,
                status=EnrollmentStatus.ACTIVE,
                role__in=[EnrollmentRole.INSTRUCTOR, EnrollmentRole.TA],
            ).exists()
            if allowed:
                return
            raise PermissionDenied('Only course instructors or TAs can edit this event.')
        raise PermissionDenied('Only superusers can edit global events.')

    def _parse_datetime_param(self, value, bound):
        if not value:
            return None
        parsed = parse_datetime(value)
        if parsed is None:
            parsed_date = parse_date(value)
            if parsed_date is None:
                raise ValidationError({bound: f'Invalid datetime/date: {value}'})
            if bound == 'start':
                parsed = datetime.combine(parsed_date, time.min)
            else:
                parsed = datetime.combine(parsed_date, time.max)
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
        return parsed
