from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0018_assignment_group_set'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='submission',
            constraint=models.UniqueConstraint(
                fields=('assignment', 'group', 'attempt_number'),
                name='uniq_submission_group_attempt',
            ),
        ),
    ]
