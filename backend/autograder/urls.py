from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .api import (
    AssignmentViewSet,
    CalendarEventViewSet,
    CourseCatalogView,
    CourseViewSet,
    GroupViewSet,
    MyCoursesView,
    ProgrammingLanguageAdminViewSet,
    ProgrammingLanguageViewSet,
    SubmissionViewSet,
    UserAdminViewSet,
)
from .api.test_templates import (
    TestTemplateBuildView,
    TestTemplateBundleView,
    TestTemplateListView,
)

router = DefaultRouter()
router.register('courses', CourseViewSet, basename='course')
router.register('assignments', AssignmentViewSet, basename='assignment')
router.register('submissions', SubmissionViewSet, basename='submission')
router.register('programming-languages', ProgrammingLanguageViewSet, basename='programming-language')
router.register('calendar-events', CalendarEventViewSet, basename='calendar-event')
router.register('admin/groups', GroupViewSet, basename='admin-group')
router.register('admin/users', UserAdminViewSet, basename='admin-user')
router.register('admin/languages', ProgrammingLanguageAdminViewSet, basename='admin-language')

urlpatterns = [
    path('my-courses/', MyCoursesView.as_view()),
    path('course-catalog/', CourseCatalogView.as_view()),
    path('test-templates/', TestTemplateListView.as_view()),
    path('test-templates/<str:template_id>/bundle/', TestTemplateBundleView.as_view()),
    path('test-templates/build/', TestTemplateBuildView.as_view()),
    path('', include(router.urls)),
]
