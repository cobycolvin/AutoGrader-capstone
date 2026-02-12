from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from ..models import ProgrammingLanguage
from ..serializers.languages import ProgrammingLanguageSerializer


class ProgrammingLanguageViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ProgrammingLanguage.objects.filter(is_enabled=True).order_by('name')
    serializer_class = ProgrammingLanguageSerializer
    permission_classes = [IsAuthenticated]
