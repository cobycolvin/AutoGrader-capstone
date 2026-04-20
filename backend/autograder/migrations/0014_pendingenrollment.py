from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('autograder', '0013_grade_feedback'),
    ]

    operations = [
        migrations.CreateModel(
            name='PendingEnrollment',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('role', models.CharField(choices=[('STUDENT', 'Student'), ('INSTRUCTOR', 'Instructor'), ('TA', 'TA'), ('GRADER', 'Grader')], default='STUDENT', max_length=20)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('CLAIMED', 'Claimed')], default='PENDING', max_length=20)),
                ('student_name', models.CharField(max_length=200)),
                ('display_name', models.CharField(blank=True, max_length=200)),
                ('first_name', models.CharField(max_length=150)),
                ('middle_name', models.CharField(blank=True, max_length=150)),
                ('last_name', models.CharField(max_length=150)),
                ('cwid', models.CharField(max_length=32)),
                ('sis_login_id', models.CharField(max_length=150)),
                ('section', models.CharField(blank=True, max_length=100)),
                ('claimed_at', models.DateTimeField(blank=True, null=True)),
                ('claimed_by_user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='claimed_pending_enrollments', to=settings.AUTH_USER_MODEL)),
                ('course', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pending_enrollments', to='autograder.course')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_%(class)s_set', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'indexes': [models.Index(fields=['course', 'status'], name='idx_pending_course_status'), models.Index(fields=['cwid'], name='idx_pending_cwid'), models.Index(fields=['sis_login_id'], name='idx_pending_login')],
            },
        ),
        migrations.AddConstraint(
            model_name='pendingenrollment',
            constraint=models.UniqueConstraint(fields=('course', 'cwid', 'status'), name='uniq_pending_enrollment_course_cwid_status'),
        ),
    ]
