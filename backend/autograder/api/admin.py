from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import viewsets

from ..permissions import IsSuperuser
from ..serializers.admin import GroupSerializer, UserAdminSerializer
from ..serializers.languages import ProgrammingLanguageSerializer
from ..models import ProgrammingLanguage


class GroupViewSet(viewsets.ModelViewSet):
    queryset = Group.objects.all().order_by('name')
    serializer_class = GroupSerializer
    permission_classes = [IsSuperuser]


class UserAdminViewSet(viewsets.ModelViewSet):
    queryset = get_user_model().objects.all().order_by('username')
    serializer_class = UserAdminSerializer
    permission_classes = [IsSuperuser]


class ProgrammingLanguageAdminViewSet(viewsets.ModelViewSet):
    queryset = ProgrammingLanguage.objects.all().order_by('name')
    serializer_class = ProgrammingLanguageSerializer
    permission_classes = [IsSuperuser]
