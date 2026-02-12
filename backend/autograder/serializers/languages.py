from rest_framework import serializers

from ..models import ProgrammingLanguage


class ProgrammingLanguageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProgrammingLanguage
        fields = [
            'id',
            'name',
            'slug',
            'docker_image',
            'compile_cmd',
            'run_cmd_template',
            'is_enabled',
        ]
        read_only_fields = ['id']
