from django.urls import path

from .api.auth import api_csrf, api_login, api_logout, api_me, api_register

urlpatterns = [
    path('login/', api_login),
    path('register/', api_register),
    path('logout/', api_logout),
    path('me/', api_me),
    path('csrf/', api_csrf),
]
