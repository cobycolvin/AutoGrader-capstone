import uuid

from django.db import migrations, models


def backfill_cwid(apps, schema_editor):
    UserProfile = apps.get_model('autograder', 'UserProfile')
    for profile in UserProfile.objects.filter(cwid__isnull=True).iterator():
        profile.cwid = uuid.uuid4().hex
        profile.save(update_fields=['cwid'])
    for profile in UserProfile.objects.filter(cwid='').iterator():
        profile.cwid = uuid.uuid4().hex
        profile.save(update_fields=['cwid'])


class Migration(migrations.Migration):
    dependencies = [
        ('autograder', '0003_userprofile_first_name_userprofile_last_name_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_cwid, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='userprofile',
            name='cwid',
            field=models.CharField(max_length=32, unique=True),
        ),
    ]
