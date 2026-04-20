from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0011_assignmentinstructionasset'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ClassExecutionRun',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_classexecutionrun_set', to=settings.AUTH_USER_MODEL)),
                ('status', models.CharField(choices=[('QUEUED', 'Queued'), ('RUNNING', 'Running'), ('COMPLETED', 'Completed')], default='QUEUED', max_length=20)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('finished_at', models.DateTimeField(blank=True, null=True)),
                ('total_students', models.PositiveIntegerField(default=0)),
                ('total_submissions', models.PositiveIntegerField(default=0)),
                ('missing_submissions', models.PositiveIntegerField(default=0)),
                ('assignment', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='class_execution_runs', to='autograder.assignment')),
                ('test_suite_version', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='class_execution_runs', to='autograder.testsuiteversion')),
                ('triggered_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='triggered_class_execution_runs', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name='ClassExecutionItem',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_classexecutionitem_set', to=settings.AUTH_USER_MODEL)),
                ('status', models.CharField(choices=[('QUEUED', 'Queued'), ('RUNNING', 'Running'), ('COMPLETED', 'Completed'), ('FAILED', 'Failed')], default='QUEUED', max_length=20)),
                ('outcome', models.CharField(blank=True, choices=[('PASS', 'Pass'), ('FAIL', 'Fail'), ('INCOMPLETE', 'Incomplete')], max_length=20)),
                ('passed_tests', models.PositiveIntegerField(default=0)),
                ('total_tests', models.PositiveIntegerField(default=0)),
                ('summary', models.CharField(blank=True, max_length=255)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('finished_at', models.DateTimeField(blank=True, null=True)),
                ('class_execution_run', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='autograder.classexecutionrun')),
                ('grading_run', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='class_execution_items', to='autograder.gradingrun')),
                ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='class_execution_items', to=settings.AUTH_USER_MODEL)),
                ('submission', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='class_execution_items', to='autograder.submission')),
            ],
        ),
        migrations.AddIndex(
            model_name='classexecutionrun',
            index=models.Index(fields=['assignment', 'created_at'], name='idx_class_exec_run_assignment'),
        ),
        migrations.AddIndex(
            model_name='classexecutionrun',
            index=models.Index(fields=['assignment', 'status'], name='idx_class_exec_run_status'),
        ),
        migrations.AddIndex(
            model_name='classexecutionitem',
            index=models.Index(fields=['class_execution_run', 'status'], name='idx_class_exec_item_status'),
        ),
        migrations.AddIndex(
            model_name='classexecutionitem',
            index=models.Index(fields=['submission', 'status'], name='idx_class_exec_item_submission'),
        ),
        migrations.AddConstraint(
            model_name='classexecutionitem',
            constraint=models.UniqueConstraint(fields=('class_execution_run', 'submission'), name='uniq_class_exec_run_submission'),
        ),
    ]
