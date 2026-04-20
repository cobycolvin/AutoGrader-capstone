from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0017_rubricattachment'),
    ]

    operations = [
        migrations.AddField(
            model_name='assignment',
            name='group_set',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name='assignments',
                to='autograder.groupset',
            ),
        ),
    ]
