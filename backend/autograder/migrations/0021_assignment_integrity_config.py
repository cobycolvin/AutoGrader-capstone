from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0020_integrityscan_metadata'),
    ]

    operations = [
        migrations.AddField(
            model_name='assignment',
            name='integrity_config_json',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
