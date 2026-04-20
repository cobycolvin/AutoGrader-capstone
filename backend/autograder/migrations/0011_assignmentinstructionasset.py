from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0010_testsuiteversion_execution_mode'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AssignmentInstructionAsset',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_assignmentinstructionasset_set', to=settings.AUTH_USER_MODEL)),
                ('original_name', models.CharField(max_length=255)),
                ('file_key', models.CharField(max_length=512)),
                ('mime_type', models.CharField(blank=True, max_length=255)),
                ('file_size', models.PositiveBigIntegerField(default=0)),
                ('display_order', models.PositiveIntegerField(default=0)),
                ('assignment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='instruction_assets', to='autograder.assignment')),
                ('uploaded_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='uploaded_instruction_assets', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['display_order', 'created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='assignmentinstructionasset',
            index=models.Index(fields=['assignment', 'display_order'], name='idx_assign_instr_order'),
        ),
    ]
