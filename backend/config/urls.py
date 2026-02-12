"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from accounts import views as account_views
from autograder.api.admin import GroupViewSet, UserAdminViewSet, ProgrammingLanguageAdminViewSet
from autograder.api.assignments import AssignmentViewSet
from autograder.api.languages import ProgrammingLanguageViewSet
from autograder.api.test_templates import (
    TestTemplateListView,
    TestTemplateBundleView,
    TestTemplateBuildView,
)
from autograder.api.submissions import SubmissionViewSet
from autograder.api.calendar import CalendarEventViewSet
from autograder.api.courses import CourseCatalogView, CourseViewSet, MyCoursesView


def health(_request):
    return JsonResponse({'status': 'ok'})

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
    path('admin/', admin.site.urls),
    path('api/health/', health),
    path('api/login/', account_views.api_login),
    path('api/register/', account_views.api_register),
    path('api/logout/', account_views.api_logout),
    path('api/me/', account_views.api_me),
    path('api/csrf/', account_views.api_csrf),
    path('api/my-courses/', MyCoursesView.as_view()),
    path('api/course-catalog/', CourseCatalogView.as_view()),
    path('api/test-templates/', TestTemplateListView.as_view()),
    path('api/test-templates/<str:template_id>/bundle/', TestTemplateBundleView.as_view()),
    path('api/test-templates/build/', TestTemplateBuildView.as_view()),
    path('api/', include(router.urls)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
