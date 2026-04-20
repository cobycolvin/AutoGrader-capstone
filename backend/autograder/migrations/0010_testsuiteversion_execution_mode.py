from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0009_calendarevent'),
    ]

    operations = [
        migrations.AddField(
            model_name='testsuiteversion',
            name='execution_mode',
            field=models.CharField(
                choices=[
                    ('LANGUAGE_TEMPLATE', 'Language template'),
                    ('PYTHON_RUNNER', 'Python runner'),
                ],
                default='LANGUAGE_TEMPLATE',
                max_length=30,
            ),
        ),
    ]
