from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('autograder', '0005_assignment_submission_requirements'),
    ]

    operations = [
        migrations.AddField(
            model_name='assignment',
            name='instructions',
            field=models.TextField(blank=True),
        ),
    ]
