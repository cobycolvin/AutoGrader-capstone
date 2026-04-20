from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('autograder', '0016_rubricscore_submission_alter_rubricscore_grading_run_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='RubricAttachment',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('original_name', models.CharField(max_length=255)),
                ('file_key', models.CharField(max_length=512)),
                ('mime_type', models.CharField(blank=True, max_length=255)),
                ('file_size', models.PositiveBigIntegerField(default=0)),
                ('display_order', models.PositiveIntegerField(default=0)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_rubricattachment_set', to=settings.AUTH_USER_MODEL)),
                ('rubric_version', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='attachments', to='autograder.rubricversion')),
                ('uploaded_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='uploaded_rubric_attachments', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['display_order', 'created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='rubricattachment',
            index=models.Index(fields=['rubric_version', 'display_order'], name='idx_rubric_attach_order'),
        ),
    ]
