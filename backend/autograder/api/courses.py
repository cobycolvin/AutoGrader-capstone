from rest_framework import viewsets

from ..models import Course
from ..permissions import IsSuperuser
from ..serializers.courses import CourseSerializer


class CourseViewSet(viewsets.ModelViewSet):
    queryset = Course.objects.all().order_by('code', 'term', 'section')
    serializer_class = CourseSerializer
    permission_classes = [IsSuperuser]
