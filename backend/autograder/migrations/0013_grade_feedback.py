from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0012_classexecutionrun_classexecutionitem'),
    ]

    operations = [
        migrations.AddField(
            model_name='grade',
            name='feedback',
            field=models.TextField(blank=True, default=''),
        ),
    ]
