from rest_framework import serializers


class CourseGradeSummarySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    user_id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.EmailField()
    display_name = serializers.CharField()
    cwid = serializers.CharField()
    total_score = serializers.DecimalField(max_digits=10, decimal_places=2)
    total_max_score = serializers.DecimalField(max_digits=10, decimal_places=2)
    percent = serializers.FloatField()
