import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0023_remove_submissiondraft_chk_submission_draft_owner_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AIDetectionScan',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('status', models.CharField(
                    choices=[('PENDING', 'Pending'), ('RUNNING', 'Running'), ('DONE', 'Done'), ('FAILED', 'Failed')],
                    default='PENDING',
                    max_length=20,
                )),
                ('model_version', models.CharField(blank=True, default='v1-xgboost', max_length=50)),
                ('overall_score', models.FloatField(blank=True, null=True)),
                ('verdict', models.CharField(
                    blank=True,
                    choices=[('CLEAN', 'Clean'), ('LIKELY_AI', 'Likely AI'), ('CONFIRMED_AI', 'Confirmed AI')],
                    max_length=20,
                    null=True,
                )),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('error_message', models.TextField(blank=True)),
                ('submission', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ai_detection_scans',
                    to='autograder.submission',
                )),
                ('requested_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='requested_ai_scans',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='created_aidetectionscan_set',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='AIDetectionFinding',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('file_path', models.CharField(max_length=512)),
                ('start_line', models.PositiveIntegerField()),
                ('end_line', models.PositiveIntegerField()),
                ('confidence', models.FloatField()),
                ('scan', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='findings',
                    to='autograder.aidetectionscan',
                )),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='created_aidetectionfinding_set',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['file_path', 'start_line'],
            },
        ),
    ]
