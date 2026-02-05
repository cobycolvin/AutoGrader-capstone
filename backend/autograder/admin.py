from django.contrib import admin

from .models import Course, Enrollment


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
