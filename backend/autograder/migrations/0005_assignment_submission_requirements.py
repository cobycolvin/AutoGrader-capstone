from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('autograder', '0004_userprofile_cwid_required'),
    ]

    operations = [
        migrations.AddField(
            model_name='assignment',
            name='submission_file_types',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='assignment',
            name='submission_max_size_mb',
            field=models.PositiveIntegerField(default=25),
        ),
        migrations.AddField(
            model_name='assignment',
            name='submission_max_attempts',
            field=models.PositiveIntegerField(default=3),
        ),
    ]
