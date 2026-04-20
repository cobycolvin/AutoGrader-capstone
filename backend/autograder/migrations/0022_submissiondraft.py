from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0021_assignment_integrity_config'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='SubmissionDraft',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_submissiondraft_set', to=settings.AUTH_USER_MODEL)),
                ('source_bundle_key', models.CharField(blank=True, max_length=512)),
                ('manifest_json', models.JSONField(blank=True, default=list)),
                ('revision', models.PositiveIntegerField(default=1)),
                ('starter_code_version', models.CharField(blank=True, max_length=100)),
                ('assignment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='submission_drafts', to='autograder.assignment')),
                ('group', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='submission_drafts', to='autograder.group')),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='submission_drafts', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(
            model_name='submissiondraft',
            constraint=models.CheckConstraint(
                check=(
                    models.Q(user__isnull=False, group__isnull=True)
                    | models.Q(user__isnull=True, group__isnull=False)
                ),
                name='chk_submission_draft_owner',
            ),
        ),
        migrations.AddConstraint(
            model_name='submissiondraft',
            constraint=models.UniqueConstraint(
                condition=models.Q(user__isnull=False),
                fields=('assignment', 'user'),
                name='uniq_submission_draft_assignment_user',
            ),
        ),
        migrations.AddConstraint(
            model_name='submissiondraft',
            constraint=models.UniqueConstraint(
                condition=models.Q(group__isnull=False),
                fields=('assignment', 'group'),
                name='uniq_submission_draft_assignment_group',
            ),
        ),
        migrations.AddIndex(
            model_name='submissiondraft',
            index=models.Index(fields=['assignment', 'updated_at'], name='idx_draft_assignment_updated'),
        ),
    ]
