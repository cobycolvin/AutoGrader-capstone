from django.contrib import admin

from .models import CalendarEvent, Course, Enrollment, ProgrammingLanguage


class EnrollmentInline(admin.TabularInline):
    model = Enrollment
    extra = 0
    autocomplete_fields = ['user']


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ('code', 'title', 'term', 'section', 'is_active')
    list_filter = ('is_active', 'term', 'section')
    search_fields = ('code', 'title', 'term', 'section')
    inlines = [EnrollmentInline]


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):
    list_display = ('course', 'user', 'role', 'status')
    list_filter = ('role', 'status', 'course')
    search_fields = ('course__code', 'course__title', 'user__username', 'user__email')


@admin.register(ProgrammingLanguage)
class ProgrammingLanguageAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'is_enabled')
    list_filter = ('is_enabled',)
    search_fields = ('name', 'slug')


@admin.register(CalendarEvent)
class CalendarEventAdmin(admin.ModelAdmin):
    list_display = ('title', 'scope', 'event_type', 'owner', 'course', 'start_at', 'is_important')
    list_filter = ('scope', 'event_type', 'is_important', 'all_day')
    search_fields = ('title', 'description', 'owner__username', 'owner__email', 'course__code', 'course__title')
    autocomplete_fields = ('owner', 'course')
