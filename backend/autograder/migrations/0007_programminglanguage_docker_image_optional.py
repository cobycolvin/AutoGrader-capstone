from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('autograder', '0006_assignment_instructions'),
    ]

    operations = [
        migrations.AlterField(
            model_name='programminglanguage',
            name='docker_image',
            field=models.CharField(blank=True, max_length=200),
        ),
    ]
