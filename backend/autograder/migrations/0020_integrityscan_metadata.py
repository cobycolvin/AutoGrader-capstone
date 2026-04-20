from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0019_submission_group_attempt_constraint'),
    ]

    operations = [
        migrations.AddField(
            model_name='integrityscan',
            name='algorithm_version',
            field=models.CharField(blank=True, default='local-v1', max_length=50),
        ),
        migrations.AddField(
            model_name='integrityscan',
            name='completed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='integrityscan',
            name='config_json',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='integrityscan',
            name='error_message',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='integrityscan',
            name='provider',
            field=models.CharField(
                choices=[('LOCAL', 'Local'), ('MOSS', 'MOSS')],
                default='LOCAL',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='integrityscan',
            name='result_url',
            field=models.URLField(blank=True),
        ),
    ]
