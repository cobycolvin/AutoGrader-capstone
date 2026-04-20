from django.conf import settings
import django.db.models.deletion
from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('autograder', '0026_rubrictemplate_rubrictemplateversion_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='RubricCriterionLevel',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('label', models.CharField(max_length=100)),
                ('min_points', models.DecimalField(decimal_places=2, max_digits=7)),
                ('max_points', models.DecimalField(decimal_places=2, max_digits=7)),
                ('description', models.TextField(blank=True)),
                ('order_index', models.PositiveIntegerField(default=0)),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='+',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('criterion', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='levels',
                    to='autograder.rubriccriterion',
                )),
            ],
            options={
                'ordering': ['-max_points'],
            },
        ),
        migrations.CreateModel(
            name='RubricTemplateCriterionLevel',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('label', models.CharField(max_length=100)),
                ('min_points', models.DecimalField(decimal_places=2, max_digits=7)),
                ('max_points', models.DecimalField(decimal_places=2, max_digits=7)),
                ('description', models.TextField(blank=True)),
                ('order_index', models.PositiveIntegerField(default=0)),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='+',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('criterion', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='levels',
                    to='autograder.rubrictemplatecriterion',
                )),
            ],
            options={
                'ordering': ['-max_points'],
            },
        ),
    ]
