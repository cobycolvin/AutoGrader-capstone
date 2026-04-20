import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
import hashlib
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .grader.runner import _combine_output, _persist_results, _resolve_run_command
from .models import (
    Assignment,
    AssignmentGroup,
    AssignmentGroupMode,
    AssignmentSubmissionMode,
    AssignmentInstructionAsset,
    ClassExecutionItem,
    ClassExecutionItemStatus,
    ClassExecutionOutcome,
    ClassExecutionRun,
    ClassExecutionRunStatus,
    Course,
    GradingExitStatus,
    GradingRun,
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    Grade,
    Group,
    GroupMember,
    GroupSet,
    IntegrityFinding,
    IntegrityScan,
    IntegrityScanProvider,
    IntegrityScanStatus,
    IntegrityScanType,
    PendingEnrollment,
    PendingEnrollmentStatus,
    ProgrammingLanguage,
    Rubric,
    RubricCriterion,
    RubricScore,
    RubricTemplate,
    RubricTemplateCriterion,
    RubricTemplateVersion,
    RubricVersion,
    Submission,
    SubmissionStatus,
    TestResult,
    TestResultStatus,
    TestSuite,
    TestSuiteExecutionMode,
    TestSuiteVersion,
    UserProfile,
)


class RubricApiTests(APITestCase):
    def setUp(self):
        super().setUp()
        self._media_dir = tempfile.mkdtemp(prefix='autograder_rubric_media_')
        self._media_override = override_settings(MEDIA_ROOT=self._media_dir)
        self._media_override.enable()
        self.addCleanup(self._media_override.disable)
        self.addCleanup(lambda: shutil.rmtree(self._media_dir, ignore_errors=True))

        user_model = get_user_model()
        self.instructor = user_model.objects.create_user(
            username='rubric-instructor',
            email='rubric-instructor@example.com',
            password='pass12345',
        )
        self.student = user_model.objects.create_user(
            username='rubric-student',
            email='rubric-student@example.com',
            password='pass12345',
        )
        self.course = Course.objects.create(code='CSCI3020', title='Software Engineering', term='Spring 2026', section='01')
        Enrollment.objects.create(
            course=self.course,
            user=self.instructor,
            role=EnrollmentRole.INSTRUCTOR,
            status=EnrollmentStatus.ACTIVE,
        )
        Enrollment.objects.create(
            course=self.course,
            user=self.student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        self.language = ProgrammingLanguage.objects.create(
            name='Java 17',
            slug='java17-rubrics',
            compile_cmd='',
            run_cmd_template='python {tests_dir}/run_tests.py {submission_dir} {workspace}',
            is_enabled=True,
        )
        self.assignment = Assignment.objects.create(
            course=self.course,
            title='Rubric Assignment',
            language=self.language,
            max_score=100,
        )
        self.client.force_authenticate(user=self.instructor)

    def _create_submission(self):
        return Submission.objects.create(
            assignment=self.assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/rubric-test.zip',
        )

    def _create_rubric_version(self, *, is_weighted=False, criteria=None):
        rubric = Rubric.objects.create(assignment=self.assignment)
        version = RubricVersion.objects.create(rubric=rubric, version_number=1, is_weighted=is_weighted)
        for index, criterion in enumerate(criteria or []):
            RubricCriterion.objects.create(
                rubric_version=version,
                name=criterion['name'],
                max_points=Decimal(str(criterion['max_points'])),
                weight=None if criterion.get('weight') is None else Decimal(str(criterion['weight'])),
                order_index=index,
            )
        rubric.active_version = version
        rubric.save(update_fields=['active_version'])
        return rubric, version

    def test_create_unweighted_rubric_clears_weights(self):
        response = self.client.post(
            f'/api/assignments/{self.assignment.id}/rubric/',
            {
                'is_weighted': False,
                'criteria': [
                    {'name': 'Correctness', 'max_points': 70, 'weight': 40, 'order_index': 0},
                    {'name': 'Style', 'max_points': 30, 'weight': 60, 'order_index': 1},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        version = RubricVersion.objects.get(rubric__assignment=self.assignment, version_number=1)
        criteria = list(RubricCriterion.objects.filter(rubric_version=version).order_by('order_index'))
        self.assertEqual(len(criteria), 2)
        self.assertIsNone(criteria[0].weight)
        self.assertIsNone(criteria[1].weight)
        self.assertEqual(response.data['is_weighted'], False)
        self.assertEqual(response.data['total_weight'], 0)

    def test_create_weighted_rubric_requires_weight_for_every_criterion(self):
        response = self.client.post(
            f'/api/assignments/{self.assignment.id}/rubric/',
            {
                'is_weighted': True,
                'criteria': [
                    {'name': 'Correctness', 'max_points': 70, 'weight': 70, 'order_index': 0},
                    {'name': 'Style', 'max_points': 30, 'weight': None, 'order_index': 1},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('criteria', response.data)

    def test_rubric_versions_include_weight_metadata(self):
        rubric = Rubric.objects.create(assignment=self.assignment)
        weighted = RubricVersion.objects.create(rubric=rubric, version_number=1, is_weighted=True)
        RubricCriterion.objects.create(
            rubric_version=weighted,
            name='Correctness',
            max_points=Decimal('80'),
            weight=Decimal('70'),
            order_index=0,
        )
        RubricCriterion.objects.create(
            rubric_version=weighted,
            name='Style',
            max_points=Decimal('20'),
            weight=Decimal('30'),
            order_index=1,
        )
        rubric.active_version = weighted
        rubric.save(update_fields=['active_version'])

        response = self.client.get(f'/api/assignments/{self.assignment.id}/rubric/versions/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['is_weighted'], True)
        self.assertEqual(response.data[0]['total_points'], 100)
        self.assertEqual(response.data[0]['total_weight'], 100)

    def test_submission_details_include_active_rubric_payload(self):
        submission = self._create_submission()
        self._create_rubric_version(
            criteria=[
                {'name': 'Correctness', 'max_points': 70},
                {'name': 'Design', 'max_points': 30},
            ],
        )

        response = self.client.get(f'/api/submissions/{submission.id}/details/')

        self.assertEqual(response.status_code, 200, response.data)
        rubric = response.data['rubric']
        self.assertTrue(rubric['available'])
        self.assertFalse(rubric['is_weighted'])
        self.assertEqual(rubric['version_number'], 1)
        self.assertEqual(Decimal(str(rubric['computed_score'])), Decimal('0.00'))
        self.assertEqual(Decimal(str(rubric['computed_max_score'])), Decimal('100.00'))
        self.assertEqual(len(rubric['criteria']), 2)
        self.assertEqual(rubric['criteria'][0]['name'], 'Correctness')
        self.assertEqual(Decimal(str(rubric['criteria'][0]['points_awarded'])), Decimal('0.00'))
        self.assertFalse(rubric['has_saved_scores'])

    def test_submission_rubric_grade_saves_scores_and_updates_grade(self):
        submission = self._create_submission()
        _rubric, version = self._create_rubric_version(
            criteria=[
                {'name': 'Correctness', 'max_points': 70},
                {'name': 'Design', 'max_points': 30},
            ],
        )
        criteria = list(RubricCriterion.objects.filter(rubric_version=version).order_by('order_index'))

        response = self.client.post(
            f'/api/submissions/{submission.id}/rubric-grade/',
            {
                'rubric_version_id': str(version.id),
                'criteria': [
                    {
                        'criterion_id': str(criteria[0].id),
                        'points_awarded': '63.00',
                        'comment': 'Mostly correct with one edge case missed.',
                    },
                    {
                        'criterion_id': str(criteria[1].id),
                        'points_awarded': '25.00',
                        'comment': 'Design is clear.',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        submission.refresh_from_db()
        self.assertEqual(RubricScore.objects.filter(submission=submission).count(), 2)
        self.assertEqual(Decimal(str(response.data['grade']['score'])), Decimal('88.00'))
        self.assertEqual(Decimal(str(response.data['grade']['max_score'])), Decimal('100.00'))
        self.assertTrue(response.data['rubric']['has_saved_scores'])
        self.assertEqual(Decimal(str(response.data['rubric']['computed_score'])), Decimal('88.00'))
        self.assertEqual(
            response.data['rubric']['criteria'][0]['comment'],
            'Mostly correct with one edge case missed.',
        )

        detail = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(Decimal(str(detail.data['grade']['score'])), Decimal('88.00'))
        self.assertEqual(Decimal(str(detail.data['rubric']['criteria'][1]['points_awarded'])), Decimal('25.00'))

    def test_submission_rubric_grade_computes_weighted_grade(self):
        submission = self._create_submission()
        _rubric, version = self._create_rubric_version(
            is_weighted=True,
            criteria=[
                {'name': 'Correctness', 'max_points': 80, 'weight': 70},
                {'name': 'Style', 'max_points': 20, 'weight': 30},
            ],
        )
        criteria = list(RubricCriterion.objects.filter(rubric_version=version).order_by('order_index'))

        response = self.client.post(
            f'/api/submissions/{submission.id}/rubric-grade/',
            {
                'criteria': [
                    {
                        'criterion_id': str(criteria[0].id),
                        'points_awarded': '80.00',
                        'comment': '',
                    },
                    {
                        'criterion_id': str(criteria[1].id),
                        'points_awarded': '10.00',
                        'comment': '',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Decimal(str(response.data['rubric']['computed_score'])), Decimal('85.00'))
        self.assertEqual(Decimal(str(response.data['grade']['score'])), Decimal('85.00'))
        self.assertEqual(Decimal(str(response.data['grade']['max_score'])), Decimal('100.00'))

    def test_submission_rubric_grade_rejects_student_submission_owner(self):
        submission = self._create_submission()
        _rubric, version = self._create_rubric_version(
            criteria=[
                {'name': 'Correctness', 'max_points': 100},
            ],
        )
        criterion = RubricCriterion.objects.get(rubric_version=version)
        self.client.force_authenticate(user=self.student)

        response = self.client.post(
            f'/api/submissions/{submission.id}/rubric-grade/',
            {
                'criteria': [
                    {
                        'criterion_id': str(criterion.id),
                        'points_awarded': '100.00',
                        'comment': 'Trying to self-grade.',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(RubricScore.objects.filter(submission=submission).count(), 0)

    def test_rubric_reference_files_are_informational_and_visible_to_students(self):
        submission = self._create_submission()
        _rubric, version = self._create_rubric_version(
            criteria=[
                {'name': 'Correctness', 'max_points': 100},
            ],
        )

        upload = SimpleUploadedFile(
            'rubric-guide.pdf',
            b'%PDF-1.4 rubric reference',
            content_type='application/pdf',
        )
        upload_response = self.client.post(
            f'/api/assignments/{self.assignment.id}/rubric-files/',
            {'files[]': [upload]},
        )

        self.assertEqual(upload_response.status_code, 201, upload_response.data)
        self.assertEqual(len(upload_response.data), 1)
        self.assertEqual(upload_response.data[0]['original_name'], 'rubric-guide.pdf')

        rubric_response = self.client.get(f'/api/assignments/{self.assignment.id}/rubric/')
        self.assertEqual(rubric_response.status_code, 200, rubric_response.data)
        self.assertEqual(len(rubric_response.data['attachments']), 1)
        self.assertEqual(rubric_response.data['attachments'][0]['original_name'], 'rubric-guide.pdf')

        self.client.force_authenticate(user=self.student)
        detail_response = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(detail_response.status_code, 200, detail_response.data)
        self.assertEqual(len(detail_response.data['rubric']['attachments']), 1)
        self.assertEqual(detail_response.data['rubric']['attachments'][0]['original_name'], 'rubric-guide.pdf')

        download_response = self.client.get(
            f"/api/assignments/{self.assignment.id}/rubric-files/{upload_response.data[0]['id']}/download/"
        )
        self.assertEqual(download_response.status_code, 200)

    def test_rubric_template_list_includes_standard_templates(self):
        response = self.client.get(f'/api/rubric-templates/?course_id={self.course.id}')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(any(template['scope'] == 'SYSTEM' for template in response.data))
        self.assertTrue(
            any(template['name'] == 'Programming Assignment Standard' for template in response.data),
            response.data,
        )
        programming_standard = next(
            template for template in response.data if template['name'] == 'Programming Assignment Standard'
        )
        first_criterion = programming_standard['active_version']['criteria'][0]
        self.assertEqual(len(first_criterion['levels']), 4)
        self.assertEqual(first_criterion['levels'][0]['label'], 'Exceeds expectations')

    def test_create_course_rubric_template(self):
        response = self.client.post(
            '/api/rubric-templates/',
            {
                'course_id': str(self.course.id),
                'name': 'Project grading baseline',
                'description': 'Use for multi-part project submissions.',
                'is_weighted': False,
                'criteria': [
                    {'name': 'Correctness', 'max_points': 70, 'order_index': 0},
                    {'name': 'Design', 'max_points': 30, 'order_index': 1},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        template = RubricTemplate.objects.get(id=response.data['id'])
        self.assertEqual(template.scope, 'COURSE')
        self.assertEqual(template.course_id, self.course.id)
        self.assertEqual(response.data['active_version']['criteria_count'], 2)
        self.assertEqual(response.data['active_version']['total_points'], 100)

    def test_update_course_rubric_template_creates_new_version(self):
        create_response = self.client.post(
            '/api/rubric-templates/',
            {
                'course_id': str(self.course.id),
                'name': 'Lab grading baseline',
                'description': 'Initial version.',
                'is_weighted': False,
                'criteria': [
                    {'name': 'Functionality', 'max_points': 80, 'order_index': 0},
                    {'name': 'Style', 'max_points': 20, 'order_index': 1},
                ],
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)

        template_id = create_response.data['id']
        update_response = self.client.post(
            f'/api/rubric-templates/{template_id}/versions/',
            {
                'name': 'Lab grading baseline',
                'description': 'Rebalanced for style and documentation.',
                'is_weighted': True,
                'criteria': [
                    {'name': 'Functionality', 'max_points': 70, 'weight': 70, 'order_index': 0},
                    {'name': 'Style', 'max_points': 20, 'weight': 20, 'order_index': 1},
                    {'name': 'Documentation', 'max_points': 10, 'weight': 10, 'order_index': 2},
                ],
            },
            format='json',
        )

        self.assertEqual(update_response.status_code, 201, update_response.data)
        template = RubricTemplate.objects.get(id=template_id)
        self.assertEqual(template.description, 'Rebalanced for style and documentation.')
        self.assertEqual(RubricTemplateVersion.objects.filter(template=template).count(), 2)
        self.assertEqual(update_response.data['active_version']['version_number'], 2)
        self.assertEqual(update_response.data['active_version']['criteria_count'], 3)
        self.assertTrue(update_response.data['active_version']['is_weighted'])

    def test_bootstrap_course_rubric_templates_creates_sample_templates_with_levels(self):
        response = self.client.post(
            '/api/rubric-templates/bootstrap/',
            {'course_id': str(self.course.id)},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created_count'], 4)
        self.assertIn('Programming Assignment Sample', response.data['created_names'])

        templates = RubricTemplate.objects.filter(course=self.course).order_by('name')
        self.assertEqual(templates.count(), 4)

        sample = templates.get(name='Programming Assignment Sample')
        criterion = RubricTemplateCriterion.objects.filter(template_version=sample.active_version).first()
        self.assertIsNotNone(criterion)
        self.assertEqual(criterion.levels.count(), 4)

    def test_bootstrap_course_rubric_templates_is_idempotent(self):
        first = self.client.post(
            '/api/rubric-templates/bootstrap/',
            {'course_id': str(self.course.id)},
            format='json',
        )
        second = self.client.post(
            '/api/rubric-templates/bootstrap/',
            {'course_id': str(self.course.id)},
            format='json',
        )

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data['created_count'], 0)
        self.assertEqual(RubricTemplate.objects.filter(course=self.course).count(), 4)


class AssignmentGroupSetHookupTests(APITestCase):
    def setUp(self):
        super().setUp()
        user_model = get_user_model()
        self.instructor = user_model.objects.create_user(
            username='assignment-groups-instructor',
            email='assignment-groups-instructor@example.com',
            password='pass12345',
        )
        self.other_instructor = user_model.objects.create_user(
            username='assignment-groups-other',
            email='assignment-groups-other@example.com',
            password='pass12345',
        )
        self.course = Course.objects.create(code='CSCI3300', title='Distributed Systems', term='Spring 2026', section='01')
        self.other_course = Course.objects.create(code='CSCI4300', title='AI Systems', term='Spring 2026', section='02')
        Enrollment.objects.create(
            course=self.course,
            user=self.instructor,
            role=EnrollmentRole.INSTRUCTOR,
            status=EnrollmentStatus.ACTIVE,
        )
        Enrollment.objects.create(
            course=self.other_course,
            user=self.other_instructor,
            role=EnrollmentRole.INSTRUCTOR,
            status=EnrollmentStatus.ACTIVE,
        )
        self.language = ProgrammingLanguage.objects.create(
            name='Python 3',
            slug='python3-assignment-groups',
            compile_cmd='',
            run_cmd_template='python {tests_dir}/run_tests.py {submission_dir} {workspace}',
            is_enabled=True,
        )
        self.group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        self.other_group_set = GroupSet.objects.create(course=self.other_course, name='Lab Pods')
        self.client.force_authenticate(user=self.instructor)

    def test_create_assignment_with_reusable_group_set(self):
        response = self.client.post(
            '/api/assignments/',
            {
                'course_id': str(self.course.id),
                'title': 'Grouped Assignment',
                'language_id': str(self.language.id),
                'allow_groups': True,
                'group_mode': 'REUSABLE_SET',
                'group_set_id': str(self.group_set.id),
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        assignment = Assignment.objects.get(id=response.data['id'])
        self.assertEqual(assignment.group_set_id, self.group_set.id)
        self.assertEqual(str(response.data['group_set']), str(self.group_set.id))
        self.assertEqual(response.data['group_set_name'], 'Project Teams')

    def test_reusable_group_set_must_belong_to_assignment_course(self):
        response = self.client.post(
            '/api/assignments/',
            {
                'course_id': str(self.course.id),
                'title': 'Bad Assignment',
                'language_id': str(self.language.id),
                'allow_groups': True,
                'group_mode': 'REUSABLE_SET',
                'group_set_id': str(self.other_group_set.id),
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('group_set_id', response.data)

    def test_disabling_groups_clears_assignment_group_set(self):
        assignment = Assignment.objects.create(
            course=self.course,
            title='Assignment',
            language=self.language,
            allow_groups=True,
            group_mode='REUSABLE_SET',
            group_set=self.group_set,
        )

        response = self.client.patch(
            f'/api/assignments/{assignment.id}/',
            {
                'allow_groups': False,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        assignment.refresh_from_db()
        self.assertFalse(assignment.allow_groups)
        self.assertIsNone(assignment.group_set)

    def test_create_assignment_with_specific_groups(self):
        team_alpha = Group.objects.create(course=self.course, group_set=self.group_set, name='Team Alpha')
        team_beta = Group.objects.create(course=self.course, group_set=self.group_set, name='Team Beta')

        response = self.client.post(
            '/api/assignments/',
            {
                'course_id': str(self.course.id),
                'title': 'Specific Teams Assignment',
                'language_id': str(self.language.id),
                'allow_groups': True,
                'group_mode': 'PER_ASSIGNMENT',
                'assignment_group_ids': [str(team_alpha.id), str(team_beta.id)],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        assignment = Assignment.objects.get(id=response.data['id'])
        self.assertEqual(assignment.group_mode, AssignmentGroupMode.PER_ASSIGNMENT)
        self.assertIsNone(assignment.group_set_id)
        self.assertEqual(
            set(AssignmentGroup.objects.filter(assignment=assignment).values_list('group_id', flat=True)),
            {team_alpha.id, team_beta.id},
        )
        self.assertEqual(
            sorted(group['name'] for group in response.data['assignment_groups']),
            ['Team Alpha', 'Team Beta'],
        )

    def test_specific_groups_must_belong_to_assignment_course(self):
        local_group = Group.objects.create(course=self.course, group_set=self.group_set, name='Local Team')
        foreign_group = Group.objects.create(course=self.other_course, group_set=self.other_group_set, name='Foreign Team')

        response = self.client.post(
            '/api/assignments/',
            {
                'course_id': str(self.course.id),
                'title': 'Bad Specific Team Assignment',
                'language_id': str(self.language.id),
                'allow_groups': True,
                'group_mode': 'PER_ASSIGNMENT',
                'assignment_group_ids': [str(local_group.id), str(foreign_group.id)],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('assignment_group_ids', response.data)

    def test_disabling_groups_clears_assignment_specific_groups(self):
        team_alpha = Group.objects.create(course=self.course, group_set=self.group_set, name='Team Alpha')
        assignment = Assignment.objects.create(
            course=self.course,
            title='Specific Group Assignment',
            language=self.language,
            allow_groups=True,
            group_mode=AssignmentGroupMode.PER_ASSIGNMENT,
        )
        AssignmentGroup.objects.create(assignment=assignment, group=team_alpha)

        response = self.client.patch(
            f'/api/assignments/{assignment.id}/',
            {
                'allow_groups': False,
                'assignment_group_ids': [],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        assignment.refresh_from_db()
        self.assertFalse(assignment.allow_groups)
        self.assertFalse(AssignmentGroup.objects.filter(assignment=assignment).exists())


class TestSuiteBuilderOOPTests(APITestCase):
    def setUp(self):
        super().setUp()
        self._media_dir = tempfile.mkdtemp(prefix='autograder_test_media_')
        self._media_override = override_settings(MEDIA_ROOT=self._media_dir)
        self._media_override.enable()
        self.addCleanup(self._media_override.disable)
        self.addCleanup(lambda: shutil.rmtree(self._media_dir, ignore_errors=True))

        user_model = get_user_model()
        self.instructor = user_model.objects.create_user(
            username='instructor',
            email='instructor@example.com',
            password='pass12345',
        )
        self.student = user_model.objects.create_user(
            username='student',
            email='student@example.com',
            password='pass12345',
        )
        self.grader = user_model.objects.create_user(
            username='grader',
            email='grader@example.com',
            password='pass12345',
        )
        self.ta = user_model.objects.create_user(
            username='ta',
            email='ta@example.com',
            password='pass12345',
        )

        self.course = Course.objects.create(code='CSCI101', title='Intro Programming', term='Spring 2026', section='01')
        Enrollment.objects.create(
            course=self.course,
            user=self.instructor,
            role=EnrollmentRole.INSTRUCTOR,
            status=EnrollmentStatus.ACTIVE,
        )
        Enrollment.objects.create(
            course=self.course,
            user=self.student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        Enrollment.objects.create(
            course=self.course,
            user=self.grader,
            role=EnrollmentRole.GRADER,
            status=EnrollmentStatus.ACTIVE,
        )
        Enrollment.objects.create(
            course=self.course,
            user=self.ta,
            role=EnrollmentRole.TA,
            status=EnrollmentStatus.ACTIVE,
        )

        self.python_language = ProgrammingLanguage.objects.create(
            name='Python 3',
            slug='python3',
            compile_cmd='',
            run_cmd_template='python {tests_dir}/run_tests.py {submission_dir} {workspace}',
            is_enabled=True,
        )
        self.java_language = ProgrammingLanguage.objects.create(
            name='Java 17',
            slug='java17',
            compile_cmd='',
            run_cmd_template='python {tests_dir}/run_tests.py {submission_dir} {workspace}',
            is_enabled=True,
        )

        self.python_assignment = Assignment.objects.create(
            course=self.course,
            title='Python OOP Assignment',
            language=self.python_language,
            max_score=100,
        )
        self.java_assignment = Assignment.objects.create(
            course=self.course,
            title='Java OOP Assignment',
            language=self.java_language,
            max_score=100,
        )

    def _build_url(self, assignment):
        return f'/api/assignments/{assignment.id}/test-suites/build/'

    def _read_bundle(self, bundle_key):
        bundle_path = Path(settings.MEDIA_ROOT) / bundle_key
        with zipfile.ZipFile(bundle_path, 'r') as zip_ref:
            names = set(zip_ref.namelist())
            tests_json = json.loads(zip_ref.read('tests.json').decode('utf-8'))
        return names, tests_json

    def _read_bundle_file(self, bundle_key, name):
        bundle_path = Path(settings.MEDIA_ROOT) / bundle_key
        with zipfile.ZipFile(bundle_path, 'r') as zip_ref:
            return zip_ref.read(name).decode('utf-8')

    def _run_generated_bundle(self, bundle_key, submission_files):
        bundle_path = Path(settings.MEDIA_ROOT) / bundle_key
        with tempfile.TemporaryDirectory(prefix='bundle_run_') as workspace:
            workspace_path = Path(workspace)
            submission_dir = workspace_path / 'submission'
            tests_dir = workspace_path / 'tests'
            submission_dir.mkdir(parents=True, exist_ok=True)
            tests_dir.mkdir(parents=True, exist_ok=True)

            for file_name, content in submission_files.items():
                target = submission_dir / file_name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding='utf-8')

            with zipfile.ZipFile(bundle_path, 'r') as zip_ref:
                zip_ref.extractall(tests_dir)

            command = [sys.executable, str(tests_dir / 'run_tests.py'), str(submission_dir), str(workspace_path)]
            subprocess.run(
                command,
                check=True,
                cwd=workspace_path,
                env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                capture_output=True,
                text=True,
            )
            with open(workspace_path / 'results.json', 'r', encoding='utf-8') as handle:
                return json.load(handle)

    def _zip_upload(self, filename='suite.zip'):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
            zip_ref.writestr('run_tests.py', 'print("ok")\n')
            zip_ref.writestr('tests.json', '{"tests":[]}')
        return SimpleUploadedFile(filename, buffer.getvalue(), content_type='application/zip')

    def _zip_upload_with_files(self, files, filename='suite.zip'):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
            for name, content in files.items():
                zip_ref.writestr(name, content)
        return SimpleUploadedFile(filename, buffer.getvalue(), content_type='application/zip')

    def _store_submission_zip(self, assignment, submitted_by, files, filename='submission.zip'):
        relative_path = f'submissions/{assignment.id}/{submitted_by.id}/{filename}'
        absolute_path = Path(settings.MEDIA_ROOT) / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(absolute_path, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
            for name, content in files.items():
                zip_ref.writestr(name, content)
        return relative_path

    def _store_test_suite_zip(self, assignment, files, filename='suite.zip'):
        relative_path = f'test_suites/{assignment.id}/private/{filename}'
        absolute_path = Path(settings.MEDIA_ROOT) / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(absolute_path, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
            for name, content in files.items():
                zip_ref.writestr(name, content)
        checksum = hashlib.sha256(absolute_path.read_bytes()).hexdigest()
        return relative_path, checksum

    def _create_active_test_suite_version(self, assignment, files, execution_mode=TestSuiteExecutionMode.PYTHON_RUNNER):
        bundle_key, checksum = self._store_test_suite_zip(
            assignment=assignment,
            files=files,
            filename='active-suite.zip',
        )
        test_suite = TestSuite.objects.create(assignment=assignment)
        version = TestSuiteVersion.objects.create(
            test_suite=test_suite,
            version_number=1,
            visibility='PRIVATE',
            execution_mode=execution_mode,
            bundle_key=bundle_key,
            checksum=checksum,
        )
        test_suite.active_version = version
        test_suite.save(update_fields=['active_version'])
        return version

    def test_build_io_java_suite_success(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'java-io-suite',
            'type': 'IO',
            'visibility': 'PRIVATE',
            'set_active': True,
            'timeout_ms': 2500,
            'main_class': 'Main',
            'tests': [
                {
                    'name': 'echo-case',
                    'input': 'hello\n',
                    'expected': 'HELLO',
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        self.assertEqual(version.execution_mode, TestSuiteExecutionMode.PYTHON_RUNNER)

        names, tests_json = self._read_bundle(version.bundle_key)
        self.assertIn('run_tests.py', names)
        self.assertIn('tests.json', names)
        self.assertIn('README.md', names)
        self.assertEqual(tests_json.get('type'), 'IO')
        self.assertEqual(tests_json.get('language'), 'java')
        self.assertEqual(tests_json.get('main_class'), 'Main')
        self.assertNotIn('points', tests_json['tests'][0])

    def test_build_io_java_requires_main_class(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'IO',
            'tests': [
                {
                    'name': 'echo-case',
                    'input': 'hello\n',
                    'expected': 'HELLO',
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('main_class', str(response.data))

    def test_build_io_python_bundle_emits_structured_case_details(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'python-io-suite',
            'type': 'IO',
            'tests': [
                {
                    'name': 'echo-case',
                    'input': 'hello\n',
                    'expected': 'HELLO',
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        results = self._run_generated_bundle(
            version.bundle_key,
            {
                'main.py': 'print(input().strip().upper())\n',
            },
        )

        test_result = results['tests'][0]
        self.assertEqual(test_result['status'], 'PASS', results)
        self.assertEqual(test_result['summary'], 'Output matched the expected result.', results)
        self.assertEqual(test_result['details']['input_preview'], 'hello\n')
        self.assertEqual(test_result['details']['expected_preview'], 'HELLO')
        self.assertIn('HELLO', test_result['details']['actual_preview'])
        self.assertEqual(test_result['details']['actual_exit_code'], 0)
        self.assertEqual(test_result['details']['expected_exit_code'], 0)

    def test_build_io_java_bundle_executes_submission(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'java-io-suite',
            'type': 'IO',
            'main_class': 'Main',
            'tests': [
                {
                    'name': 'echo-case',
                    'input': 'hello\n',
                    'expected': 'HELLO',
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        results = self._run_generated_bundle(
            version.bundle_key,
            {
                'Main.java': (
                    'import java.util.Scanner;\n'
                    'public class Main {\n'
                    '    public static void main(String[] args) {\n'
                    '        Scanner scanner = new Scanner(System.in);\n'
                    '        if (scanner.hasNextLine()) {\n'
                    '            System.out.println(scanner.nextLine().trim().toUpperCase());\n'
                    '        }\n'
                    '    }\n'
                    '}\n'
                )
            },
        )
        test_result = results['tests'][0]
        self.assertEqual(test_result['status'], 'PASS', results)
        self.assertEqual(test_result['summary'], 'Output matched the expected result.', results)
        self.assertEqual(test_result['details']['input_preview'], 'hello\n')
        self.assertEqual(test_result['details']['expected_preview'], 'HELLO')
        self.assertIn('HELLO', test_result['details']['actual_preview'])
        self.assertEqual(test_result['details']['actual_exit_code'], 0)

    def test_build_io_java_bundle_records_expected_and_actual_output_on_failure(self):
        if not shutil.which('javac'):
            self.skipTest('javac not available in test environment')

        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'java-io-suite',
            'type': 'IO',
            'main_class': 'Main',
            'tests': [
                {
                    'name': 'echo-case',
                    'input': 'hello\n',
                    'expected': 'HELLO',
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        results = self._run_generated_bundle(
            version.bundle_key,
            {
                'Main.java': (
                    'import java.util.Scanner;\n'
                    'public class Main {\n'
                    '    public static void main(String[] args) {\n'
                    '        Scanner scanner = new Scanner(System.in);\n'
                    '        if (scanner.hasNextLine()) {\n'
                    '            System.out.println(scanner.nextLine().trim().toLowerCase());\n'
                    '        }\n'
                    '    }\n'
                    '}\n'
                )
            },
        )

        test_result = results['tests'][0]
        self.assertEqual(test_result['status'], 'FAIL', results)
        self.assertEqual(test_result['failure_kind'], 'STDOUT_MISMATCH', results)
        self.assertEqual(test_result['summary'], 'Output did not match the expected result.', results)
        self.assertEqual(test_result['details']['input_preview'], 'hello\n')
        self.assertEqual(test_result['details']['expected_preview'], 'HELLO')
        self.assertIn('hello', test_result['details']['actual_preview'])

    def test_build_oop_python_suite_success(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'python-oop-suite',
            'type': 'OOP',
            'visibility': 'PRIVATE',
            'set_active': True,
            'timeout_ms': 3000,
            'module_path': 'main.py',
            'class_tests': [
                {
                    'name': 'player_add_goal',
                    'class_name': 'Player',
                    'constructor_args': ['Messi', 10],
                    'steps': [{'method': 'addGoal', 'args': []}, {'method': 'addGoal', 'args': []}],
                    'assert_method': 'getGoals',
                    'assert_args': [],
                    'expected': 2,
                    'points': 5,
                }
            ],
            'main_tests': [
                {
                    'name': 'main_flow',
                    'input': 'a b\n',
                    'expected': 'ok',
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        self.assertEqual(version.execution_mode, TestSuiteExecutionMode.PYTHON_RUNNER)
        self.assertEqual(version.visibility, 'PRIVATE')

        suite = TestSuite.objects.get(assignment=self.python_assignment)
        self.assertEqual(suite.active_version_id, version.id)

        names, tests_json = self._read_bundle(version.bundle_key)
        self.assertIn('run_tests.py', names)
        self.assertIn('tests.json', names)
        self.assertIn('README.md', names)
        self.assertEqual(tests_json.get('type'), 'OOP')
        self.assertEqual(tests_json.get('language'), 'python')
        self.assertEqual(tests_json.get('module_path'), 'main.py')
        self.assertNotIn('points', tests_json['class_tests'][0])
        self.assertNotIn('points', tests_json['main_tests'][0])

    def test_build_oop_java_suite_success(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'java-oop-suite',
            'type': 'OOP',
            'visibility': 'PRIVATE',
            'set_active': True,
            'timeout_ms': 3000,
            'class_tests': [
                {
                    'name': 'player_add_goal',
                    'class_name': 'Player',
                    'constructor_args': ['Messi', 10],
                    'steps': [{'method': 'addGoal', 'args': []}, {'method': 'addGoal', 'args': []}],
                    'assert_method': 'getGoals',
                    'assert_args': [],
                    'expected': 2,
                    'points': 5,
                }
            ],
            'main_tests': [],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        self.assertEqual(version.execution_mode, TestSuiteExecutionMode.PYTHON_RUNNER)

        names, tests_json = self._read_bundle(version.bundle_key)
        self.assertIn('run_tests.py', names)
        self.assertIn('tests.json', names)
        self.assertIn('GeneratedHarness.java', names)
        self.assertEqual(tests_json.get('type'), 'OOP')
        self.assertEqual(tests_json.get('language'), 'java')
        self.assertNotIn('points', tests_json['class_tests'][0])

    def test_build_oop_rejects_unsafe_module_path(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'OOP',
            'module_path': '../main.py',
            'class_tests': [
                {
                    'class_name': 'Player',
                    'constructor_args': [],
                    'steps': [],
                    'assert_method': 'getGoals',
                    'assert_args': [],
                    'expected': 0,
                    'points': 5,
                }
            ],
            'main_tests': [],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        detail = str(response.data.get('detail', response.data))
        self.assertIn('module_path', detail)

    def test_build_oop_java_rejects_non_scalar_values(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'OOP',
            'class_tests': [
                {
                    'class_name': 'Player',
                    'constructor_args': [{'invalid': True}],
                    'steps': [],
                    'assert_method': 'getGoals',
                    'assert_args': [],
                    'expected': 0,
                    'points': 5,
                }
            ],
            'main_tests': [],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        detail = str(response.data.get('detail', response.data))
        self.assertIn('string/number/boolean', detail)

    def test_build_oop_requires_instructor_or_ta(self):
        self.client.force_authenticate(user=self.student)
        payload = {
            'type': 'OOP',
            'module_path': 'main.py',
            'class_tests': [
                {
                    'class_name': 'Player',
                    'constructor_args': [],
                    'steps': [],
                    'assert_method': 'getGoals',
                    'assert_args': [],
                    'expected': 0,
                    'points': 5,
                }
            ],
            'main_tests': [],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 403)

    def test_build_oop_set_active_false_keeps_previous_active(self):
        self.client.force_authenticate(user=self.instructor)
        first_payload = {
            'name': 'suite-1',
            'type': 'OOP',
            'module_path': 'main.py',
            'set_active': True,
            'class_tests': [
                {
                    'class_name': 'Player',
                    'constructor_args': [],
                    'steps': [],
                    'assert_method': 'getGoals',
                    'assert_args': [],
                    'expected': 0,
                    'points': 5,
                }
            ],
            'main_tests': [],
        }
        first = self.client.post(self._build_url(self.python_assignment), first_payload, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        first_version = TestSuiteVersion.objects.get(id=first.data['id'])

        second_payload = {
            'name': 'suite-2',
            'type': 'OOP',
            'module_path': 'main.py',
            'set_active': False,
            'class_tests': [
                {
                    'class_name': 'Player',
                    'constructor_args': [],
                    'steps': [],
                    'assert_method': 'getGoals',
                    'assert_args': [],
                    'expected': 1,
                    'points': 5,
                }
            ],
            'main_tests': [],
        }
        second = self.client.post(self._build_url(self.python_assignment), second_payload, format='json')
        self.assertEqual(second.status_code, 201, second.data)

        suite = TestSuite.objects.get(assignment=self.python_assignment)
        self.assertEqual(suite.active_version_id, first_version.id)

    def test_build_file_io_python_suite_success(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'python-file-suite',
            'type': 'FILE_IO',
            'visibility': 'PRIVATE',
            'set_active': True,
            'entry_path': 'main.py',
            'cases': [
                {
                    'name': 'cargo-basic',
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': 'input.txt', 'content': '2 3\\n'}],
                    'expected_files': [
                        {
                            'path': 'output.txt',
                            'content': '5\n',
                            'comparison_mode': 'EXACT',
                        }
                    ],
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        self.assertEqual(version.execution_mode, TestSuiteExecutionMode.PYTHON_RUNNER)

        names, tests_json = self._read_bundle(version.bundle_key)
        self.assertIn('run_tests.py', names)
        self.assertIn('tests.json', names)
        self.assertIn('README.md', names)
        self.assertIn('cases/case-1-cargo-basic/input/input.txt', names)
        self.assertIn('cases/case-1-cargo-basic/expected/output.txt', names)
        self.assertEqual(tests_json.get('type'), 'FILE_IO')
        self.assertEqual(tests_json.get('language'), 'python')
        self.assertEqual(tests_json.get('entry_path'), 'main.py')
        self.assertNotIn('points', tests_json['cases'][0])

    def test_build_file_io_suite_bundles_grading_files_and_primary_entry(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'python-driver-suite',
            'type': 'FILE_IO',
            'visibility': 'PRIVATE',
            'set_active': True,
            'entry_path': 'driver.py',
            'primary_grading_file': 'driver.py',
            'grading_files': [
                {'path': 'driver.py', 'content': 'from solution import solve\nprint(solve())\n'},
                {'path': 'helpers/support.py', 'content': 'def suffix():\n    return "K"\n'},
            ],
            'cases': [
                {
                    'name': 'driver-case',
                    'expected_stdout': {
                        'content': 'OK',
                        'comparison_mode': 'TRIMMED',
                    },
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        names, tests_json = self._read_bundle(version.bundle_key)
        self.assertIn('grading/driver.py', names)
        self.assertIn('grading/helpers/support.py', names)
        self.assertEqual(tests_json.get('primary_grading_file'), 'driver.py')
        self.assertEqual(tests_json['grading_files'][0]['path'], 'driver.py')
        self.assertEqual(tests_json['grading_files'][0]['source'], 'grading/driver.py')
        self.assertEqual(tests_json['grading_files'][1]['path'], 'helpers/support.py')
        self.assertEqual(tests_json['grading_files'][1]['source'], 'grading/helpers/support.py')

    def test_generated_file_io_runner_uses_uploaded_grading_files(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'python-driver-suite',
            'type': 'FILE_IO',
            'visibility': 'PRIVATE',
            'set_active': True,
            'entry_path': 'driver.py',
            'primary_grading_file': 'driver.py',
            'grading_files': [
                {
                    'path': 'driver.py',
                    'content': 'from solution import solve\nfrom helpers.support import suffix\nprint(solve() + suffix())\n',
                },
                {
                    'path': 'helpers/support.py',
                    'content': 'def suffix():\n    return "K"\n',
                },
            ],
            'cases': [
                {
                    'name': 'driver-case',
                    'expected_stdout': {
                        'content': 'OK',
                        'comparison_mode': 'TRIMMED',
                    },
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        results = self._run_generated_bundle(
            TestSuiteVersion.objects.get(id=response.data['id']).bundle_key,
            {
                'solution.py': 'def solve():\n    return "O"\n',
            },
        )

        self.assertEqual(results['tests'][0]['status'], 'PASS', results)
        self.assertEqual(results['tests'][0]['summary'], 'All built-in checks passed.', results)

    def test_build_file_io_java_suite_success_with_packages(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'name': 'java-file-suite',
            'type': 'FILE_IO',
            'visibility': 'PRIVATE',
            'set_active': True,
            'main_class': 'shipping.LoadShipping',
            'cases': [
                {
                    'name': 'cargo-day-1',
                    'args': ['fixtures/day1items.txt', 'outputs/day1shipping.txt'],
                    'input_files': [{'path': 'fixtures/day1items.txt', 'content': '2 7\\nITEM1 2 4\\nITEM2 3 5\\n'}],
                    'expected_files': [
                        {
                            'path': 'outputs/day1shipping.txt',
                            'content': 'Plane 2 9\nITEM1\nITEM2\n\nTrucked 0\n',
                            'comparison_mode': 'EXACT',
                        }
                    ],
                    'points': 10,
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        self.assertEqual(version.execution_mode, TestSuiteExecutionMode.PYTHON_RUNNER)

        names, tests_json = self._read_bundle(version.bundle_key)
        self.assertIn('cases/case-1-cargo-day-1/input/fixtures/day1items.txt', names)
        self.assertIn('cases/case-1-cargo-day-1/expected/outputs/day1shipping.txt', names)
        self.assertEqual(tests_json.get('type'), 'FILE_IO')
        self.assertEqual(tests_json.get('language'), 'java')
        self.assertEqual(tests_json.get('main_class'), 'shipping.LoadShipping')
        self.assertNotIn('points', tests_json['cases'][0])

    def test_build_file_io_rejects_unsafe_fixture_path(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'entry_path': 'main.py',
            'cases': [
                {
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': '../secret.txt', 'content': 'bad'}],
                    'expected_files': [{'path': 'output.txt', 'content': 'ok', 'comparison_mode': 'EXACT'}],
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('safe relative path', str(response.data))

    def test_build_file_io_requires_entry_path_for_python(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'cases': [
                {
                    'args': ['input.txt', 'output.txt'],
                    'expected_files': [{'path': 'output.txt', 'content': 'ok', 'comparison_mode': 'EXACT'}],
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('entry_path', str(response.data))

    def test_build_file_io_requires_main_class_for_java(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'cases': [
                {
                    'args': ['input.txt', 'output.txt'],
                    'expected_files': [{'path': 'output.txt', 'content': 'ok', 'comparison_mode': 'EXACT'}],
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('main_class', str(response.data))

    def test_build_file_io_java_derives_main_class_from_uploaded_driver(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'grading_files': [
                {
                    'path': 'Driver.java',
                    'content': (
                        'public class Driver {\n'
                        '    public static void main(String[] args) {\n'
                        '        System.out.println("OK");\n'
                        '    }\n'
                        '}\n'
                    ),
                }
            ],
            'cases': [
                {
                    'name': 'driver-case',
                    'expected_stdout': {'content': 'OK', 'comparison_mode': 'TRIMMED'},
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        _names, tests_json = self._read_bundle(version.bundle_key)
        self.assertEqual(tests_json.get('main_class'), 'Driver')
        self.assertEqual(tests_json.get('primary_grading_file'), 'Driver.java')

    def test_build_file_io_java_helper_first_upload_still_picks_driver(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'grading_files': [
                {
                    'path': 'helpers/Support.java',
                    'content': 'public class Support { }\n',
                },
                {
                    'path': 'shipping/Driver.java',
                    'content': (
                        'package shipping;\n'
                        'public class Driver {\n'
                        '    public static void main(String[] args) {\n'
                        '        System.out.println("OK");\n'
                        '    }\n'
                        '}\n'
                    ),
                },
            ],
            'cases': [
                {
                    'name': 'driver-case',
                    'expected_stdout': {'content': 'OK', 'comparison_mode': 'TRIMMED'},
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        version = TestSuiteVersion.objects.get(id=response.data['id'])
        _names, tests_json = self._read_bundle(version.bundle_key)
        self.assertEqual(tests_json.get('main_class'), 'shipping.Driver')
        self.assertEqual(tests_json.get('primary_grading_file'), 'shipping/Driver.java')

    def test_build_file_io_java_rejects_ambiguous_uploaded_main_files(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'grading_files': [
                {
                    'path': 'Driver.java',
                    'content': (
                        'public class Driver {\n'
                        '    public static void main(String[] args) {}\n'
                        '}\n'
                    ),
                },
                {
                    'path': 'AltDriver.java',
                    'content': (
                        'public class AltDriver {\n'
                        '    public static void main(String[] args) {}\n'
                        '}\n'
                    ),
                },
            ],
            'cases': [
                {
                    'name': 'driver-case',
                    'expected_stdout': {'content': '', 'comparison_mode': 'TRIMMED'},
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('Multiple uploaded Java grading files contain main()', str(response.data))

    def test_build_file_io_rejects_builtin_case_without_expectations(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'entry_path': 'main.py',
            'cases': [
                {
                    'name': 'missing-expectation',
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': 'input.txt', 'content': '2 3'}],
                    'validation_mode': 'BUILT_IN',
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('Built-in validation', str(response.data))

    def test_build_file_io_rejects_custom_case_without_validator(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'entry_path': 'main.py',
            'cases': [
                {
                    'name': 'custom-no-validator',
                    'args': ['input.txt', 'output.txt'],
                    'validation_mode': 'CUSTOM',
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('validator_code', str(response.data))

    def test_build_file_io_rejects_missing_numeric_tolerance(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'entry_path': 'main.py',
            'cases': [
                {
                    'args': ['input.txt', 'output.txt'],
                    'expected_files': [
                        {
                            'path': 'output.txt',
                            'content': '5',
                            'comparison_mode': 'NUMERIC_TOLERANCE',
                        }
                    ],
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('numeric_tolerance', str(response.data))

    def test_generated_file_io_python_bundle_runner_passes(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'entry_path': 'main.py',
            'cases': [
                {
                    'name': 'sum-case',
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': 'input.txt', 'content': '2 3'}],
                    'expected_files': [{'path': 'output.txt', 'content': '5\n', 'comparison_mode': 'TRIMMED'}],
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        results = self._run_generated_bundle(
            TestSuiteVersion.objects.get(id=response.data['id']).bundle_key,
            {
                'main.py': (
                    'import sys\n'
                    'src, dest = sys.argv[1], sys.argv[2]\n'
                    'with open(src, "r", encoding="utf-8") as handle:\n'
                    '    nums = [int(value) for value in handle.read().split()]\n'
                    'with open(dest, "w", encoding="utf-8") as handle:\n'
                    '    handle.write(f"{sum(nums)}\\n")\n'
                )
            },
        )
        self.assertEqual(results['tests'][0]['status'], 'PASS', results)
        self.assertNotIn('points', results['tests'][0])
        self.assertNotIn('max_points', results['tests'][0])

    def test_generated_file_io_runner_supports_custom_validator(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'entry_path': 'main.py',
            'validator_code': (
                'def validate_case(case, context):\n'
                '    actual = context["read_text"]("output.txt").strip()\n'
                '    return {"passed": actual in {"5", "05"}, "message": f"actual={actual}"}\n'
            ),
            'cases': [
                {
                    'name': 'custom-sum',
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': 'input.txt', 'content': '2 3'}],
                    'validation_mode': 'CUSTOM',
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        version = TestSuiteVersion.objects.get(id=response.data['id'])
        self.assertIn('def validate_case', self._read_bundle_file(version.bundle_key, 'validator.py'))

        results = self._run_generated_bundle(
            version.bundle_key,
            {
                'main.py': (
                    'import sys\n'
                    'src, dest = sys.argv[1], sys.argv[2]\n'
                    'with open(src, "r", encoding="utf-8") as handle:\n'
                    '    nums = [int(value) for value in handle.read().split()]\n'
                    'with open(dest, "w", encoding="utf-8") as handle:\n'
                    '    handle.write("05")\n'
                )
            },
        )
        self.assertEqual(results['tests'][0]['status'], 'PASS', results)
        self.assertIn('actual=05', results['tests'][0]['message'])

    def test_generated_file_io_runner_emits_structured_output_mismatch_feedback(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'entry_path': 'main.py',
            'cases': [
                {
                    'name': 'mismatch-case',
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': 'input.txt', 'content': '2 3'}],
                    'expected_files': [{'path': 'output.txt', 'content': '5\n', 'comparison_mode': 'TRIMMED'}],
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        results = self._run_generated_bundle(
            TestSuiteVersion.objects.get(id=response.data['id']).bundle_key,
            {
                'main.py': (
                    'import sys\n'
                    'src, dest = sys.argv[1], sys.argv[2]\n'
                    'with open(dest, "w", encoding="utf-8") as handle:\n'
                    '    handle.write("6\\n")\n'
                )
            },
        )

        test_result = results['tests'][0]
        self.assertEqual(test_result['status'], 'FAIL', results)
        self.assertEqual(test_result['failure_kind'], 'OUTPUT_MISMATCH', results)
        self.assertIn('did not match', test_result['summary'])
        self.assertEqual(test_result['details']['target'], 'output.txt')
        self.assertEqual(test_result['details']['comparison_mode'], 'TRIMMED')
        self.assertIn('5', test_result['details']['expected_preview'])
        self.assertIn('6', test_result['details']['actual_preview'])

    def test_generated_file_io_java_runner_emits_compile_error_feedback(self):
        if not shutil.which('javac'):
            self.skipTest('javac not available in test environment')

        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'main_class': 'LoadShipping',
            'cases': [
                {
                    'name': 'compile-error-case',
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': 'input.txt', 'content': '2 3'}],
                    'expected_files': [{'path': 'output.txt', 'content': '5\n', 'comparison_mode': 'TRIMMED'}],
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        results = self._run_generated_bundle(
            TestSuiteVersion.objects.get(id=response.data['id']).bundle_key,
            {
                'LoadShipping.java': (
                    'public class LoadShipping {\n'
                    '  public static void main(String[] args) {\n'
                    '    System.out.println("broken")\n'
                    '  }\n'
                    '}\n'
                )
            },
        )

        test_result = results['tests'][0]
        self.assertEqual(test_result['status'], 'FAIL', results)
        self.assertEqual(test_result['failure_kind'], 'COMPILE_ERROR', results)
        self.assertIn('compilation failed', test_result['summary'].lower())
        self.assertIn('stderr_preview', test_result['details'])

    def test_generated_file_io_runner_isolates_each_case_workspace(self):
        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'entry_path': 'main.py',
            'cases': [
                {
                    'name': 'case-a',
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': 'input.txt', 'content': 'A'}],
                    'expected_files': [{'path': 'output.txt', 'content': 'A', 'comparison_mode': 'EXACT'}],
                    'points': 5,
                },
                {
                    'name': 'case-b',
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': 'input.txt', 'content': 'B'}],
                    'expected_files': [{'path': 'output.txt', 'content': 'B', 'comparison_mode': 'EXACT'}],
                    'points': 5,
                },
            ],
        }

        response = self.client.post(self._build_url(self.python_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        results = self._run_generated_bundle(
            TestSuiteVersion.objects.get(id=response.data['id']).bundle_key,
            {
                'main.py': (
                    'import os\n'
                    'import sys\n'
                    'src, dest = sys.argv[1], sys.argv[2]\n'
                    'with open(src, "r", encoding="utf-8") as handle:\n'
                    '    data = handle.read()\n'
                    'mode = "a" if os.path.exists(dest) else "w"\n'
                    'with open(dest, mode, encoding="utf-8") as handle:\n'
                    '    handle.write(data)\n'
                )
            },
        )

        self.assertEqual([entry['status'] for entry in results['tests']], ['PASS', 'PASS'], results)

    def test_generated_file_io_java_bundle_supports_packaged_source_tree(self):
        if not shutil.which('javac') or not shutil.which('java'):
            self.skipTest('javac/java not available in test environment')

        self.client.force_authenticate(user=self.instructor)
        payload = {
            'type': 'FILE_IO',
            'main_class': 'shipping.LoadShipping',
            'cases': [
                {
                    'name': 'java-package-case',
                    'args': ['input.txt', 'output.txt'],
                    'input_files': [{'path': 'input.txt', 'content': '2 3'}],
                    'expected_files': [{'path': 'output.txt', 'content': '5\n', 'comparison_mode': 'TRIMMED'}],
                    'points': 5,
                }
            ],
        }

        response = self.client.post(self._build_url(self.java_assignment), payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        results = self._run_generated_bundle(
            TestSuiteVersion.objects.get(id=response.data['id']).bundle_key,
            {
                'shipping/LoadShipping.java': (
                    'package shipping;\n'
                    'import java.nio.file.Files;\n'
                    'import java.nio.file.Path;\n'
                    'public class LoadShipping {\n'
                    '  public static void main(String[] args) throws Exception {\n'
                    '    String text = Files.readString(Path.of(args[0])).trim();\n'
                    '    String[] parts = text.split("\\\\s+");\n'
                    '    int sum = Integer.parseInt(parts[0]) + Integer.parseInt(parts[1]);\n'
                    '    Files.writeString(Path.of(args[1]), sum + "\\n");\n'
                    '  }\n'
                    '}\n'
                )
            },
        )
        self.assertEqual(results['tests'][0]['status'], 'PASS', results)

    def test_upload_raw_files_auto_zips_and_sets_python_runner_when_run_tests_present(self):
        self.client.force_authenticate(user=self.instructor)
        run_tests = SimpleUploadedFile(
            'run_tests.py',
            b'print("ok")\n',
            content_type='text/x-python',
        )
        tests_json = SimpleUploadedFile(
            'tests.json',
            b'{"tests": []}',
            content_type='application/json',
        )

        response = self.client.post(
            f'/api/assignments/{self.python_assignment.id}/test-suites/',
            {
                'visibility': 'PRIVATE',
                'files': [run_tests, tests_json],
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.data)
        version = TestSuiteVersion.objects.get(id=response.data['id'])
        self.assertEqual(version.execution_mode, TestSuiteExecutionMode.PYTHON_RUNNER)

        names, _ = self._read_bundle(version.bundle_key)
        self.assertIn('run_tests.py', names)
        self.assertIn('tests.json', names)

    def test_upload_raw_files_allows_execution_mode_override(self):
        self.client.force_authenticate(user=self.instructor)
        run_tests = SimpleUploadedFile(
            'run_tests.py',
            b'print("ok")\n',
            content_type='text/x-python',
        )

        response = self.client.post(
            f'/api/assignments/{self.python_assignment.id}/test-suites/',
            {
                'visibility': 'PRIVATE',
                'execution_mode': TestSuiteExecutionMode.LANGUAGE_TEMPLATE,
                'files': [run_tests],
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.data)
        version = TestSuiteVersion.objects.get(id=response.data['id'])
        self.assertEqual(version.execution_mode, TestSuiteExecutionMode.LANGUAGE_TEMPLATE)

    def test_upload_single_zip_via_files_field_is_accepted(self):
        self.client.force_authenticate(user=self.instructor)
        zip_file = self._zip_upload('from-files.zip')

        response = self.client.post(
            f'/api/assignments/{self.python_assignment.id}/test-suites/',
            {
                'visibility': 'PRIVATE',
                'files': [zip_file],
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.data)
        version = TestSuiteVersion.objects.get(id=response.data['id'])
        self.assertEqual(version.execution_mode, TestSuiteExecutionMode.LANGUAGE_TEMPLATE)

    def test_upload_mix_of_zip_and_raw_files_is_rejected(self):
        self.client.force_authenticate(user=self.instructor)
        zip_file = self._zip_upload('mixed.zip')
        raw_file = SimpleUploadedFile(
            'run_tests.py',
            b'print("ok")\n',
            content_type='text/x-python',
        )

        response = self.client.post(
            f'/api/assignments/{self.python_assignment.id}/test-suites/',
            {
                'visibility': 'PRIVATE',
                'files': [zip_file, raw_file],
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 400)
        detail = str(response.data.get('detail', response.data))
        self.assertIn('one .zip file or raw files', detail)

    def test_test_suite_file_preview_returns_content(self):
        self.client.force_authenticate(user=self.instructor)
        zip_file = self._zip_upload_with_files(
            {
                'run_tests.py': 'print("ok")\n',
                'tests.json': '{"tests":[]}',
            },
            filename='preview.zip',
        )
        upload = self.client.post(
            f'/api/assignments/{self.python_assignment.id}/test-suites/',
            {'visibility': 'PRIVATE', 'file': zip_file},
            format='multipart',
        )
        self.assertEqual(upload.status_code, 201, upload.data)
        version_id = upload.data['id']

        response = self.client.get(
            f'/api/assignments/{self.python_assignment.id}/test-suites/{version_id}/file/',
            {'name': 'run_tests.py'},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['name'], 'run_tests.py')
        self.assertIn('print("ok")', response.data['content'])
        self.assertFalse(response.data['truncated'])

    def test_test_suite_file_preview_rejects_unsafe_path(self):
        self.client.force_authenticate(user=self.instructor)
        zip_file = self._zip_upload('unsafe-preview.zip')
        upload = self.client.post(
            f'/api/assignments/{self.python_assignment.id}/test-suites/',
            {'visibility': 'PRIVATE', 'file': zip_file},
            format='multipart',
        )
        self.assertEqual(upload.status_code, 201, upload.data)
        version_id = upload.data['id']

        response = self.client.get(
            f'/api/assignments/{self.python_assignment.id}/test-suites/{version_id}/file/',
            {'name': '../run_tests.py'},
        )
        self.assertEqual(response.status_code, 400)
        detail = str(response.data.get('detail', response.data))
        self.assertIn('name query parameter', detail)

    def test_test_suite_file_preview_returns_binary_payload(self):
        self.client.force_authenticate(user=self.instructor)
        zip_file = self._zip_upload_with_files(
            {
                'binary.dat': b'\x00\x01\x02',
            },
            filename='binary-preview.zip',
        )
        upload = self.client.post(
            f'/api/assignments/{self.python_assignment.id}/test-suites/',
            {'visibility': 'PRIVATE', 'file': zip_file},
            format='multipart',
        )
        self.assertEqual(upload.status_code, 201, upload.data)
        version_id = upload.data['id']

        response = self.client.get(
            f'/api/assignments/{self.python_assignment.id}/test-suites/{version_id}/file/',
            {'name': 'binary.dat'},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data.get('encoding'), 'base64')
        self.assertFalse(response.data.get('is_text'))
        self.assertTrue(response.data.get('content'))

    def test_submission_upload_multiple_raw_files_auto_zips(self):
        self.client.force_authenticate(user=self.student)
        main_file = SimpleUploadedFile(
            'main.py',
            b'print("hello")\n',
            content_type='text/x-python',
        )
        helper_file = SimpleUploadedFile(
            'helper.py',
            b'def add(a, b):\n    return a + b\n',
            content_type='text/x-python',
        )

        response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.python_assignment.id),
                'files': [main_file, helper_file],
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.data)

        submission = Submission.objects.get(id=response.data['id'])
        stored_path = Path(settings.MEDIA_ROOT) / submission.source_bundle_key
        self.assertTrue(zipfile.is_zipfile(stored_path))
        with zipfile.ZipFile(stored_path, 'r') as zip_ref:
            names = set(zip_ref.namelist())
        self.assertIn('main.py', names)
        self.assertIn('helper.py', names)

    def test_submission_upload_single_raw_file_auto_zips_with_original_name(self):
        self.client.force_authenticate(user=self.student)
        program_file = SimpleUploadedFile(
            'Program4.java',
            b'public class Program4 { public static void main(String[] args) {} }\n',
            content_type='text/x-java-source',
        )

        response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.java_assignment.id),
                'file': program_file,
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 201, response.data)

        submission = Submission.objects.get(id=response.data['id'])
        stored_path = Path(settings.MEDIA_ROOT) / submission.source_bundle_key
        self.assertTrue(zipfile.is_zipfile(stored_path))
        with zipfile.ZipFile(stored_path, 'r') as zip_ref:
            names = set(zip_ref.namelist())
        self.assertEqual(names, {'Program4.java'})

    def test_submission_upload_rejects_mixed_single_and_multiple_fields(self):
        self.client.force_authenticate(user=self.student)
        zip_upload = self._zip_upload('submission.zip')
        raw_file = SimpleUploadedFile(
            'main.py',
            b'print("hello")\n',
            content_type='text/x-python',
        )

        response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.python_assignment.id),
                'file': zip_upload,
                'files': [raw_file],
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 400)
        detail = str(response.data.get('detail', response.data))
        self.assertIn('either file or files[]', detail)

    def test_submission_upload_validates_allowed_types_for_raw_files(self):
        self.client.force_authenticate(user=self.student)
        self.python_assignment.submission_file_types = ['.py']
        self.python_assignment.save(update_fields=['submission_file_types'])

        code_file = SimpleUploadedFile(
            'main.py',
            b'print("hello")\n',
            content_type='text/x-python',
        )
        text_file = SimpleUploadedFile(
            'notes.txt',
            b'readme',
            content_type='text/plain',
        )

        response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.python_assignment.id),
                'files': [code_file, text_file],
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 400)
        detail = str(response.data.get('files', response.data))
        self.assertIn('.txt', detail)

    def test_submission_upload_rejected_for_workspace_only_assignment(self):
        self.client.force_authenticate(user=self.student)
        self.python_assignment.submission_mode = AssignmentSubmissionMode.WORKSPACE
        self.python_assignment.save(update_fields=['submission_mode'])

        main_file = SimpleUploadedFile(
            'main.py',
            b'print("hello")\n',
            content_type='text/x-python',
        )

        response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.python_assignment.id),
                'files': [main_file],
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 400)
        detail = str(response.data.get('detail', response.data))
        self.assertIn('workspace editor only', detail)

    def test_workspace_endpoint_rejected_for_upload_only_assignment(self):
        self.client.force_authenticate(user=self.student)
        self.python_assignment.submission_mode = AssignmentSubmissionMode.UPLOAD
        self.python_assignment.save(update_fields=['submission_mode'])

        response = self.client.get(f'/api/assignments/{self.python_assignment.id}/workspace/')
        self.assertEqual(response.status_code, 400, response.data)
        detail = str(response.data.get('detail', response.data))
        self.assertIn('uploaded files only', detail)

    def test_assignment_api_rejects_workspace_mode_without_language(self):
        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            '/api/assignments/',
            {
                'course_id': str(self.course.id),
                'title': 'Workspace without language',
                'submission_mode': AssignmentSubmissionMode.WORKSPACE,
                'language_id': None,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        detail = str(response.data.get('submission_mode', response.data))
        self.assertIn('Choose a programming language', detail)

    def test_submission_upload_forbidden_for_grader(self):
        self.client.force_authenticate(user=self.grader)
        main_file = SimpleUploadedFile(
            'main.py',
            b'print("grader attempt")\n',
            content_type='text/x-python',
        )

        response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.python_assignment.id),
                'files': [main_file],
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 403, response.data)

    def test_grouped_submission_attempts_increment_by_group(self):
        second_student = get_user_model().objects.create_user(
            username='student_two',
            email='student_two@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=second_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        team = Group.objects.create(course=self.course, group_set=group_set, name='Team Alpha')
        GroupMember.objects.create(group=team, user=self.student)
        GroupMember.objects.create(group=team, user=second_student)
        self.python_assignment.allow_groups = True
        self.python_assignment.group_mode = AssignmentGroupMode.REUSABLE_SET
        self.python_assignment.group_set = group_set
        self.python_assignment.save(update_fields=['allow_groups', 'group_mode', 'group_set'])

        first_upload = SimpleUploadedFile('main.py', b'print("first")\n', content_type='text/x-python')
        self.client.force_authenticate(user=self.student)
        first_response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.python_assignment.id),
                'group_id': str(team.id),
                'files': [first_upload],
            },
            format='multipart',
        )
        self.assertEqual(first_response.status_code, 201, first_response.data)
        first_submission = Submission.objects.get(id=first_response.data['id'])
        self.assertEqual(first_submission.attempt_number, 1)
        self.assertEqual(first_submission.group_id, team.id)
        self.assertIn(f'groups/{team.id}', first_submission.source_bundle_key)

        second_upload = SimpleUploadedFile('main.py', b'print("second")\n', content_type='text/x-python')
        self.client.force_authenticate(user=second_student)
        second_response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.python_assignment.id),
                'group_id': str(team.id),
                'files': [second_upload],
            },
            format='multipart',
        )
        self.assertEqual(second_response.status_code, 201, second_response.data)
        second_submission = Submission.objects.get(id=second_response.data['id'])
        self.assertEqual(second_submission.attempt_number, 2)
        self.assertEqual(second_submission.group_id, team.id)

    def test_group_member_can_view_teammate_submission(self):
        second_student = get_user_model().objects.create_user(
            username='student_three',
            email='student_three@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=second_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        team = Group.objects.create(course=self.course, group_set=group_set, name='Team Beta')
        GroupMember.objects.create(group=team, user=self.student)
        GroupMember.objects.create(group=team, user=second_student)
        self.python_assignment.allow_groups = True
        self.python_assignment.group_mode = AssignmentGroupMode.REUSABLE_SET
        self.python_assignment.group_set = group_set
        self.python_assignment.save(update_fields=['allow_groups', 'group_mode', 'group_set'])

        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            group=team,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key=f'submissions/{self.python_assignment.id}/groups/{team.id}/sample.zip',
        )

        self.client.force_authenticate(user=second_student)
        list_response = self.client.get(f'/api/submissions/?assignment_id={self.python_assignment.id}')
        self.assertEqual(list_response.status_code, 200, list_response.data)
        self.assertEqual(len(list_response.data), 1)
        self.assertEqual(list_response.data[0]['group_name'], 'Team Beta')
        self.assertEqual(list_response.data[0]['group_member_usernames'], ['student', 'student_three'])

        detail_response = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(detail_response.status_code, 200, detail_response.data)
        self.assertEqual(detail_response.data['submission']['group_name'], 'Team Beta')

    def test_submission_groups_endpoint_returns_current_students_valid_groups(self):
        other_student = get_user_model().objects.create_user(
            username='student_four',
            email='student_four@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=other_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        team_a = Group.objects.create(course=self.course, group_set=group_set, name='Team A')
        team_b = Group.objects.create(course=self.course, group_set=group_set, name='Team B')
        GroupMember.objects.create(group=team_a, user=self.student)
        GroupMember.objects.create(group=team_b, user=other_student)
        self.python_assignment.allow_groups = True
        self.python_assignment.group_mode = AssignmentGroupMode.REUSABLE_SET
        self.python_assignment.group_set = group_set
        self.python_assignment.save(update_fields=['allow_groups', 'group_mode', 'group_set'])

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/assignments/{self.python_assignment.id}/submission-groups/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['allow_groups'])
        self.assertEqual(response.data['group_set_name'], 'Project Teams')
        self.assertEqual(len(response.data['groups']), 1)
        self.assertEqual(response.data['groups'][0]['name'], 'Team A')
        self.assertEqual(response.data['groups'][0]['member_usernames'], ['student'])

    def test_submission_groups_endpoint_returns_assignment_specific_groups(self):
        other_student = get_user_model().objects.create_user(
            username='student_five',
            email='student_five@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=other_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        team_a = Group.objects.create(course=self.course, group_set=group_set, name='Team A')
        team_b = Group.objects.create(course=self.course, group_set=group_set, name='Team B')
        GroupMember.objects.create(group=team_a, user=self.student)
        GroupMember.objects.create(group=team_b, user=other_student)
        self.python_assignment.allow_groups = True
        self.python_assignment.group_mode = AssignmentGroupMode.PER_ASSIGNMENT
        self.python_assignment.group_set = None
        self.python_assignment.save(update_fields=['allow_groups', 'group_mode', 'group_set'])
        AssignmentGroup.objects.create(assignment=self.python_assignment, group=team_a)
        AssignmentGroup.objects.create(assignment=self.python_assignment, group=team_b)

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/assignments/{self.python_assignment.id}/submission-groups/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['group_mode'], AssignmentGroupMode.PER_ASSIGNMENT)
        self.assertEqual(len(response.data['groups']), 1)
        self.assertEqual(response.data['groups'][0]['name'], 'Team A')

    def test_grouped_submission_attempts_increment_by_assignment_groups(self):
        second_student = get_user_model().objects.create_user(
            username='student_six',
            email='student_six@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=second_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        team = Group.objects.create(course=self.course, group_set=group_set, name='Team Gamma')
        GroupMember.objects.create(group=team, user=self.student)
        GroupMember.objects.create(group=team, user=second_student)
        self.python_assignment.allow_groups = True
        self.python_assignment.group_mode = AssignmentGroupMode.PER_ASSIGNMENT
        self.python_assignment.group_set = None
        self.python_assignment.save(update_fields=['allow_groups', 'group_mode', 'group_set'])
        AssignmentGroup.objects.create(assignment=self.python_assignment, group=team)

        first_upload = SimpleUploadedFile('main.py', b'print(\"first\")\\n', content_type='text/x-python')
        self.client.force_authenticate(user=self.student)
        first_response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.python_assignment.id),
                'group_id': str(team.id),
                'files': [first_upload],
            },
            format='multipart',
        )
        self.assertEqual(first_response.status_code, 201, first_response.data)

        second_upload = SimpleUploadedFile('main.py', b'print(\"second\")\\n', content_type='text/x-python')
        self.client.force_authenticate(user=second_student)
        second_response = self.client.post(
            '/api/submissions/',
            {
                'assignment_id': str(self.python_assignment.id),
                'group_id': str(team.id),
                'files': [second_upload],
            },
            format='multipart',
        )
        self.assertEqual(second_response.status_code, 201, second_response.data)
        second_submission = Submission.objects.get(id=second_response.data['id'])
        self.assertEqual(second_submission.group_id, team.id)
        self.assertEqual(second_submission.attempt_number, 2)

    def test_submission_details_allows_instructor_to_review_student_submission(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/sample.zip',
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['submission']['id'], str(submission.id))
        self.assertEqual(response.data['submission']['submitted_by'], self.student.id)

    def test_submission_details_exposes_console_capability_for_builder_io_suite(self):
        bundle_key = self._store_submission_zip(
            assignment=self.python_assignment,
            submitted_by=self.student,
            files={'main.py': 'print(input().strip().upper())\n'},
            filename='console-capable.zip',
        )
        self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': json.dumps(
                    {
                        'type': 'IO',
                        'tests': [
                            {'name': 'echo-case', 'input': 'hello\n', 'expected': 'HELLO'},
                        ],
                    }
                ),
            },
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key=bundle_key,
        )

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['console']['available'])
        self.assertEqual(response.data['console']['command_preview'], 'python main.py')
        self.assertTrue(response.data['console']['supports_stdin'])

    def test_submission_details_include_configured_io_case_definition(self):
        bundle_key = self._store_submission_zip(
            assignment=self.python_assignment,
            submitted_by=self.student,
            files={'main.py': 'print(input().strip().upper())\n'},
            filename='io-details.zip',
        )
        version = self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': json.dumps(
                    {
                        'type': 'IO',
                        'tests': [
                            {'name': 'echo-case', 'input': 'hello\n', 'expected': 'HELLO'},
                        ],
                    }
                ),
            },
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key=bundle_key,
        )
        run = GradingRun.objects.create(
            submission=submission,
            test_suite_version_private=version,
            worker_id='local-runner',
            started_at=timezone.now(),
            exit_status=GradingExitStatus.OK,
            result_json={
                'tests': [
                    {'name': 'echo-case', 'status': 'PASS', 'time_ms': 12},
                ]
            },
        )
        TestResult.objects.create(
            grading_run=run,
            test_name='echo-case',
            status=TestResultStatus.PASS,
            points_awarded=Decimal('0'),
            time_ms=12,
            message='',
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['test_results'][0]['test_name'], 'echo-case')
        self.assertEqual(response.data['test_results'][0]['details']['input_preview'], 'hello\n')
        self.assertEqual(response.data['test_results'][0]['details']['expected_preview'], 'HELLO')
        self.assertEqual(response.data['test_results'][0]['summary'], 'Configured test details are available.')

    def test_submission_console_run_executes_python_io_submission(self):
        bundle_key = self._store_submission_zip(
            assignment=self.python_assignment,
            submitted_by=self.student,
            files={'main.py': 'print(input().strip().upper())\n'},
            filename='console-run.zip',
        )
        self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': json.dumps(
                    {
                        'type': 'IO',
                        'tests': [
                            {'name': 'echo-case', 'input': 'hello\n', 'expected': 'HELLO'},
                        ],
                    }
                ),
            },
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key=bundle_key,
        )

        self.client.force_authenticate(user=self.student)
        response = self.client.post(
            f'/api/submissions/{submission.id}/console-run/',
            {'stdin': 'hello from console\n'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['stdout'], 'HELLO FROM CONSOLE\n')
        self.assertEqual(response.data['stderr'], '')
        self.assertEqual(response.data['exit_status'], GradingExitStatus.OK)
        self.assertEqual(response.data['returncode'], 0)
        self.assertEqual(GradingRun.objects.filter(submission=submission).count(), 0)

    def test_submission_console_run_executes_java_io_submission(self):
        bundle_key = self._store_submission_zip(
            assignment=self.java_assignment,
            submitted_by=self.student,
            files={
                'Main.java': (
                    'import java.util.Scanner;\n'
                    'public class Main {\n'
                    '    public static void main(String[] args) {\n'
                    '        Scanner scanner = new Scanner(System.in);\n'
                    '        if (scanner.hasNextLine()) {\n'
                    '            System.out.println(scanner.nextLine().trim().toUpperCase());\n'
                    '        }\n'
                    '    }\n'
                    '}\n'
                )
            },
            filename='console-run-java.zip',
        )
        self._create_active_test_suite_version(
            self.java_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': json.dumps(
                    {
                        'type': 'IO',
                        'language': 'java',
                        'main_class': 'Main',
                        'tests': [
                            {'name': 'echo-case', 'input': 'hello\n', 'expected': 'HELLO'},
                        ],
                    }
                ),
            },
        )
        submission = Submission.objects.create(
            assignment=self.java_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key=bundle_key,
        )

        self.client.force_authenticate(user=self.student)
        detail = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertTrue(detail.data['console']['available'])
        self.assertEqual(detail.data['console']['command_preview'], 'java Main')
        self.assertTrue(detail.data['console']['supports_stdin'])

        response = self.client.post(
            f'/api/submissions/{submission.id}/console-run/',
            {'stdin': 'hello from console\n'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['stdout'], 'HELLO FROM CONSOLE\n')
        self.assertEqual(response.data['stderr'], '')
        self.assertEqual(response.data['exit_status'], GradingExitStatus.OK)
        self.assertEqual(response.data['returncode'], 0)
        self.assertEqual(GradingRun.objects.filter(submission=submission).count(), 0)

    def test_submission_console_run_rejects_file_io_submission(self):
        bundle_key = self._store_submission_zip(
            assignment=self.python_assignment,
            submitted_by=self.student,
            files={
                'main.py': (
                    'import sys\n'
                    'with open(sys.argv[2], "w", encoding="utf-8") as handle:\n'
                    '    handle.write("ok\\n")\n'
                )
            },
            filename='console-file-io.zip',
        )
        self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': json.dumps(
                    {
                        'type': 'FILE_IO',
                        'language': 'python',
                        'entry_path': 'main.py',
                        'cases': [
                            {
                                'name': 'file-case',
                                'args': ['input.txt', 'output.txt'],
                            }
                        ],
                    }
                ),
            },
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key=bundle_key,
        )

        self.client.force_authenticate(user=self.student)
        detail = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertFalse(detail.data['console']['available'])
        self.assertIn('file-based suites', detail.data['console']['reason'])

        response = self.client.post(
            f'/api/submissions/{submission.id}/console-run/',
            {'stdin': 'ignored\n'},
            format='json',
        )
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIn('file-based suites', str(response.data['detail']))

    def test_submission_details_exposes_file_run_capability_for_builder_file_io_suite(self):
        bundle_key = self._store_submission_zip(
            assignment=self.python_assignment,
            submitted_by=self.student,
            files={'main.py': 'print("ready")\n'},
            filename='file-run-capable.zip',
        )
        self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': json.dumps(
                    {
                        'type': 'FILE_IO',
                        'language': 'python',
                        'entry_path': 'main.py',
                        'cases': [
                            {
                                'name': 'sample-case',
                                'args': ['input.txt', 'output.txt'],
                                'stdin': '',
                                'input_files': [
                                    {
                                        'path': 'input.txt',
                                        'source': 'cases/case-1-sample/input/input.txt',
                                    }
                                ],
                                'expected_files': [],
                            }
                        ],
                    }
                ),
                'cases/case-1-sample/input/input.txt': 'hello world\n',
            },
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key=bundle_key,
        )

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['file_run']['available'])
        self.assertEqual(response.data['file_run']['command_preview'], 'python main.py input.txt output.txt')
        self.assertEqual(response.data['file_run']['default_args'], ['input.txt', 'output.txt'])
        self.assertEqual(response.data['file_run']['default_input_files'][0]['path'], 'input.txt')
        self.assertEqual(response.data['file_run']['default_input_files'][0]['content'], 'hello world\n')

    def test_submission_file_run_executes_python_file_io_submission(self):
        bundle_key = self._store_submission_zip(
            assignment=self.python_assignment,
            submitted_by=self.student,
            files={
                'main.py': (
                    'import pathlib, sys\n'
                    'src, dst = sys.argv[1], sys.argv[2]\n'
                    'text = pathlib.Path(src).read_text(encoding="utf-8")\n'
                    'pathlib.Path(dst).write_text(text.upper(), encoding="utf-8")\n'
                    'print("processed")\n'
                )
            },
            filename='file-run.zip',
        )
        self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': json.dumps(
                    {
                        'type': 'FILE_IO',
                        'language': 'python',
                        'entry_path': 'main.py',
                        'cases': [
                            {
                                'name': 'sample-case',
                                'args': ['input.txt', 'output.txt'],
                                'stdin': '',
                                'input_files': [
                                    {
                                        'path': 'input.txt',
                                        'source': 'cases/case-1-sample/input/input.txt',
                                    }
                                ],
                                'expected_files': [],
                            }
                        ],
                    }
                ),
                'cases/case-1-sample/input/input.txt': 'hello world\n',
            },
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key=bundle_key,
        )

        self.client.force_authenticate(user=self.student)
        response = self.client.post(
            f'/api/submissions/{submission.id}/file-run/',
            {
                'args': ['input.txt', 'output.txt'],
                'input_files': [{'path': 'input.txt', 'content': 'hello world\n'}],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['stdout'], 'processed\n')
        self.assertEqual(response.data['stderr'], '')
        self.assertEqual(response.data['exit_status'], GradingExitStatus.OK)
        self.assertEqual(response.data['returncode'], 0)
        produced_files = response.data['produced_files']
        self.assertEqual(len(produced_files), 1)
        self.assertEqual(produced_files[0]['name'], 'output.txt')
        self.assertTrue(produced_files[0]['is_text'])
        self.assertEqual(produced_files[0]['content'], 'HELLO WORLD\n')
        self.assertEqual(GradingRun.objects.filter(submission=submission).count(), 0)

    def test_submission_manifest_and_file_preview_for_instructor(self):
        bundle_key = self._store_submission_zip(
            assignment=self.python_assignment,
            submitted_by=self.student,
            files={
                'main.py': 'print("hello")\n',
                'notes.txt': 'sample notes',
            },
            filename='preview.zip',
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key=bundle_key,
        )

        self.client.force_authenticate(user=self.instructor)
        manifest = self.client.get(f'/api/submissions/{submission.id}/manifest/')
        self.assertEqual(manifest.status_code, 200, manifest.data)
        self.assertEqual(manifest.data.get('file_count'), 2)
        names = {entry.get('name') for entry in manifest.data.get('files', [])}
        self.assertIn('main.py', names)

        preview = self.client.get(
            f'/api/submissions/{submission.id}/file/',
            {'name': 'main.py'},
        )
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data.get('name'), 'main.py')
        self.assertTrue(preview.data.get('is_text'))
        self.assertIn('print("hello")', preview.data.get('content', ''))

    def test_assignment_instruction_files_upload_list_preview_download_and_delete(self):
        upload = SimpleUploadedFile(
            'assignment-guide.txt',
            b'Follow the spec exactly.\nUse helper classes where needed.\n',
            content_type='text/plain',
        )

        self.client.force_authenticate(user=self.instructor)
        create_response = self.client.post(
            f'/api/assignments/{self.python_assignment.id}/instruction-files/',
            {'files[]': [upload]},
            format='multipart',
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        self.assertEqual(len(create_response.data), 1)
        asset_id = create_response.data[0]['id']

        self.client.force_authenticate(user=self.student)
        list_response = self.client.get(f'/api/assignments/{self.python_assignment.id}/instruction-files/')
        self.assertEqual(list_response.status_code, 200, list_response.data)
        self.assertEqual(len(list_response.data), 1)
        self.assertEqual(list_response.data[0]['original_name'], 'assignment-guide.txt')

        preview_response = self.client.get(
            f'/api/assignments/{self.python_assignment.id}/instruction-files/{asset_id}/preview/',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.data)
        self.assertEqual(preview_response.data['encoding'], 'text')
        self.assertIn('Follow the spec exactly.', preview_response.data['content'])

        download_response = self.client.get(
            f'/api/assignments/{self.python_assignment.id}/instruction-files/{asset_id}/download/',
        )
        self.assertEqual(download_response.status_code, 200)
        self.assertIn('attachment;', download_response['Content-Disposition'])

        delete_response = self.client.delete(
            f'/api/assignments/{self.python_assignment.id}/instruction-files/{asset_id}/',
        )
        self.assertEqual(delete_response.status_code, 403)

        self.client.force_authenticate(user=self.ta)
        delete_response = self.client.delete(
            f'/api/assignments/{self.python_assignment.id}/instruction-files/{asset_id}/',
        )
        self.assertEqual(delete_response.status_code, 204)

        self.client.force_authenticate(user=self.instructor)
        list_after_delete = self.client.get(f'/api/assignments/{self.python_assignment.id}/instruction-files/')
        self.assertEqual(list_after_delete.status_code, 200, list_after_delete.data)
        self.assertEqual(list_after_delete.data, [])

    def test_submission_file_preview_allowed_for_ta(self):
        bundle_key = self._store_submission_zip(
            assignment=self.python_assignment,
            submitted_by=self.student,
            files={
                'main.py': 'print("from ta check")\n',
            },
            filename='ta-preview.zip',
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key=bundle_key,
        )

        self.client.force_authenticate(user=self.ta)
        preview = self.client.get(
            f'/api/submissions/{submission.id}/file/',
            {'name': 'main.py'},
        )
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertIn('from ta check', preview.data.get('content', ''))

    def test_submission_rerun_queues_finalized_submission_for_instructor(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key='submissions/rerun.zip',
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(f'/api/submissions/{submission.id}/rerun/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], SubmissionStatus.QUEUED)

        submission.refresh_from_db()
        self.assertEqual(submission.status, SubmissionStatus.QUEUED)

        detail = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertFalse(detail.data.get('permissions', {}).get('can_rerun'))

    def test_submission_rerun_forbidden_for_student(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key='submissions/rerun-student.zip',
        )

        self.client.force_authenticate(user=self.student)
        response = self.client.post(f'/api/submissions/{submission.id}/rerun/')
        self.assertEqual(response.status_code, 403)

    def test_submission_rerun_rejects_already_running_submission(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.RUNNING,
            source_bundle_key='submissions/rerun-running.zip',
        )

        self.client.force_authenticate(user=self.ta)
        response = self.client.post(f'/api/submissions/{submission.id}/rerun/')
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIn('already running', str(response.data.get('detail', '')))

    def test_class_execution_run_start_creates_items_for_latest_submissions(self):
        older = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key='submissions/older.zip',
        )
        latest = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=2,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/latest.zip',
        )
        self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': '{"tests":[]}\n',
            },
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(f'/api/assignments/{self.python_assignment.id}/class-runs/', {}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['run']['total_students'], 1)
        self.assertEqual(response.data['run']['total_submissions'], 1)
        self.assertEqual(response.data['run']['queued_items'], 1)
        self.assertEqual(len(response.data['items']), 1)
        self.assertEqual(response.data['items'][0]['submission_id'], str(latest.id))

        run = ClassExecutionRun.objects.get(id=response.data['run']['id'])
        item = ClassExecutionItem.objects.get(class_execution_run=run)
        self.assertEqual(item.submission_id, latest.id)
        self.assertNotEqual(item.submission_id, older.id)

    def test_class_execution_run_start_rejects_second_active_run(self):
        self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': '{"tests":[]}\n',
            },
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/class-run.zip',
        )

        self.client.force_authenticate(user=self.instructor)
        first = self.client.post(f'/api/assignments/{self.python_assignment.id}/class-runs/', {}, format='json')
        self.assertEqual(first.status_code, 201, first.data)

        second = self.client.post(f'/api/assignments/{self.python_assignment.id}/class-runs/', {}, format='json')
        self.assertEqual(second.status_code, 409, second.data)
        self.assertIn('already in progress', str(second.data.get('detail', '')))

    def test_class_execution_run_detail_aggregates_test_results(self):
        version = self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': 'print("ok")\n',
                'tests.json': '{"tests":[]}\n',
            },
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/class-run-detail.zip',
        )
        run = ClassExecutionRun.objects.create(
            assignment=self.python_assignment,
            test_suite_version=version,
            triggered_by=self.instructor,
            created_by=self.instructor,
            status=ClassExecutionRunStatus.COMPLETED,
            total_students=1,
            total_submissions=1,
            missing_submissions=0,
        )
        grading_run = GradingRun.objects.create(
            submission=submission,
            test_suite_version_private=version,
            worker_id='class-run:test',
            started_at=timezone.now(),
            finished_at=timezone.now(),
            exit_status=GradingExitStatus.OK,
            result_json={
                'tests': [
                    {'name': 'dataset-1', 'status': 'PASS', 'time_ms': 15, 'summary': 'ok'},
                    {'name': 'dataset-2', 'status': 'FAIL', 'time_ms': 31, 'summary': 'wrong output'},
                ]
            },
        )
        ClassExecutionItem.objects.create(
            class_execution_run=run,
            submission=submission,
            student=self.student,
            grading_run=grading_run,
            created_by=self.instructor,
            status=ClassExecutionItemStatus.COMPLETED,
            outcome=ClassExecutionOutcome.FAIL,
            passed_tests=1,
            total_tests=2,
            summary='wrong output',
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(f'/api/assignments/{self.python_assignment.id}/class-runs/{run.id}/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['run']['pass_count'], 0)
        self.assertEqual(response.data['run']['fail_count'], 1)
        self.assertEqual(len(response.data['tests']), 2)
        test_names = {entry['name'] for entry in response.data['tests']}
        self.assertEqual(test_names, {'dataset-1', 'dataset-2'})
        self.assertEqual(response.data['items'][0]['summary'], 'wrong output')

    def test_worker_processes_class_execution_item(self):
        version = self._create_active_test_suite_version(
            self.python_assignment,
            files={
                'run_tests.py': (
                    'import json, os, sys\n'
                    'workspace = sys.argv[2]\n'
                    'with open(os.path.join(workspace, "results.json"), "w", encoding="utf-8") as handle:\n'
                    '    json.dump({"tests": [{"name": "dataset-1", "status": "PASS", "time_ms": 12, "summary": "ok"}]}, handle)\n'
                ),
                'tests.json': '{"tests":[{"name":"dataset-1"}]}\n',
            },
        )
        bundle_key = self._store_submission_zip(
            assignment=self.python_assignment,
            submitted_by=self.student,
            files={'main.py': 'print("hello")\n'},
            filename='class-run-worker.zip',
        )
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key=bundle_key,
        )
        run = ClassExecutionRun.objects.create(
            assignment=self.python_assignment,
            test_suite_version=version,
            triggered_by=self.instructor,
            created_by=self.instructor,
            status=ClassExecutionRunStatus.QUEUED,
            total_students=1,
            total_submissions=1,
            missing_submissions=0,
        )
        item = ClassExecutionItem.objects.create(
            class_execution_run=run,
            submission=submission,
            student=self.student,
            created_by=self.instructor,
            status=ClassExecutionItemStatus.QUEUED,
        )

        call_command('run_grader_worker', once=True)

        item.refresh_from_db()
        run.refresh_from_db()
        submission.refresh_from_db()
        self.assertEqual(item.status, ClassExecutionItemStatus.COMPLETED)
        self.assertEqual(item.outcome, ClassExecutionOutcome.PASS)
        self.assertEqual(item.passed_tests, 1)
        self.assertEqual(item.total_tests, 1)
        self.assertTrue(item.grading_run_id)
        self.assertEqual(run.status, ClassExecutionRunStatus.COMPLETED)
        self.assertEqual(submission.status, SubmissionStatus.GRADED)
        self.assertTrue(item.grading_run.worker_id.startswith('class-run:'))

    def test_submission_grade_override_updates_target_submission(self):
        first = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key='submissions/first.zip',
        )
        second = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=2,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/second.zip',
        )
        Grade.objects.create(submission=first, score=Decimal('10.00'), max_score=Decimal('100.00'))
        Grade.objects.create(submission=second, score=Decimal('20.00'), max_score=Decimal('100.00'))

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/submissions/{first.id}/grade/',
            {
                'score': '89.50',
                'max_score': '100.00',
                'feedback': 'Strong solution. Clean up the edge-case handling for invalid input.',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        first.refresh_from_db()
        updated_first = Grade.objects.get(submission=first)
        unchanged_second = Grade.objects.get(submission=second)
        self.assertEqual(first.status, SubmissionStatus.FAILED)
        self.assertEqual(updated_first.score, Decimal('89.50'))
        self.assertEqual(updated_first.max_score, Decimal('100.00'))
        self.assertEqual(updated_first.feedback, 'Strong solution. Clean up the edge-case handling for invalid input.')
        self.assertEqual(unchanged_second.score, Decimal('20.00'))

    def test_submission_grade_override_forbidden_for_student(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/only.zip',
        )
        Grade.objects.create(submission=submission, score=Decimal('60.00'), max_score=Decimal('100.00'))

        self.client.force_authenticate(user=self.student)
        response = self.client.post(
            f'/api/submissions/{submission.id}/grade/',
            {
                'score': '80.00',
                'max_score': '100.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_submission_grade_override_allowed_for_grader(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key='submissions/grader-target.zip',
        )
        Grade.objects.create(submission=submission, score=Decimal('40.00'), max_score=Decimal('100.00'))

        self.client.force_authenticate(user=self.grader)
        response = self.client.post(
            f'/api/submissions/{submission.id}/grade/',
            {
                'score': '78.00',
                'max_score': '100.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        submission.refresh_from_db()
        grade = Grade.objects.get(submission=submission)
        self.assertEqual(submission.status, SubmissionStatus.FAILED)
        self.assertEqual(grade.score, Decimal('78.00'))

        detail = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertTrue(detail.data.get('permissions', {}).get('can_edit_grade'))

    def test_submission_detail_returns_manual_feedback_to_submission_owner(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/student-feedback.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('84.00'),
            max_score=Decimal('100.00'),
            feedback='Good structure overall. Fix the missing validation for empty input.',
        )

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/submissions/{submission.id}/details/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data.get('grade', {}).get('feedback'),
            'Good structure overall. Fix the missing validation for empty input.',
        )

    def test_course_people_import_preview_summarizes_matches(self):
        active_student = get_user_model().objects.create_user(
            username='acharyas1',
            email='acharyas1@example.com',
            password='pass12345',
        )
        UserProfile.objects.create(
            user=active_student,
            display_name='Sujit Acharya',
            first_name='Sujit',
            last_name='Acharya',
            cwid='30154740',
        )
        Enrollment.objects.create(
            course=self.course,
            user=active_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )

        dropped_student = get_user_model().objects.create_user(
            username='mainalia',
            email='mainalia@example.com',
            password='pass12345',
        )
        UserProfile.objects.create(
            user=dropped_student,
            display_name='Aryan Mainali',
            first_name='Aryan',
            last_name='Mainali',
            cwid='30161954',
        )
        Enrollment.objects.create(
            course=self.course,
            user=dropped_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.DROPPED,
        )

        existing_user = get_user_model().objects.create_user(
            username='amgaina',
            email='amgaina@example.com',
            password='pass12345',
        )

        conflict_cwid_user = get_user_model().objects.create_user(
            username='conflictcwid',
            email='conflictcwid@example.com',
            password='pass12345',
        )
        UserProfile.objects.create(
            user=conflict_cwid_user,
            display_name='Conflict Cwid',
            first_name='Conflict',
            last_name='Cwid',
            cwid='40000001',
        )
        conflict_username_user = get_user_model().objects.create_user(
            username='karkibi',
            email='karkibi@example.com',
            password='pass12345',
        )
        UserProfile.objects.create(
            user=conflict_username_user,
            display_name='Conflict Username',
            first_name='Conflict',
            last_name='Username',
            cwid='40000002',
        )

        csv_content = (
            'Student,ID,SIS User ID,SIS Login ID,Section\n'
            '"Acharya, Sujit",4790,30154740,acharyas1,Spring 2026 - 64251\n'
            '"Amgain, Abhishek",2478,30155555,amgaina,Spring 2026 - 64251\n'
            '"Mainali, Aryan",4787,30161954,mainalia,Spring 2026 - 64251\n'
            '"Jones, Aiden",4148,30153984,jonesaj,Spring 2026 - 64251\n'
            '"Karki, Binit",5774,40000001,karkibi,Spring 2026 - 64251\n'
        )
        upload = SimpleUploadedFile('roster.csv', csv_content.encode('utf-8'), content_type='text/csv')

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/people/import-preview/',
            {'file': upload},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['summary']['already_enrolled_count'], 1)
        self.assertEqual(response.data['summary']['enroll_count'], 1)
        self.assertEqual(response.data['summary']['reactivate_count'], 1)
        self.assertEqual(response.data['summary']['pending_count'], 1)
        self.assertEqual(response.data['summary']['conflict_count'], 1)

        rows_by_username = {row['username']: row for row in response.data['rows']}
        self.assertEqual(rows_by_username['acharyas1']['action'], 'ALREADY_ENROLLED')
        self.assertEqual(rows_by_username['amgaina']['action'], 'ENROLL_EXISTING_USER')
        self.assertEqual(rows_by_username['mainalia']['action'], 'REACTIVATE_ENROLLMENT')
        self.assertEqual(rows_by_username['jonesaj']['action'], 'ADD_PENDING_ENROLLMENT')
        self.assertEqual(rows_by_username['karkibi']['action'], 'CONFLICT')

    def test_course_people_import_creates_pending_entries_and_enrolls_existing_students(self):
        dropped_student = get_user_model().objects.create_user(
            username='mainalia',
            email='mainalia@example.com',
            password='pass12345',
        )
        UserProfile.objects.create(
            user=dropped_student,
            display_name='Aryan Mainali',
            first_name='Aryan',
            last_name='Mainali',
            cwid='30161954',
        )
        dropped_enrollment = Enrollment.objects.create(
            course=self.course,
            user=dropped_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.DROPPED,
        )

        existing_user = get_user_model().objects.create_user(
            username='amgaina',
            email='amgaina@example.com',
            password='pass12345',
        )

        csv_content = (
            'Student,ID,SIS User ID,SIS Login ID,Section\n'
            '"Amgain, Abhishek",2478,30155555,amgaina,Spring 2026 - 64251\n'
            '"Mainali, Aryan",4787,30161954,mainalia,Spring 2026 - 64251\n'
            '"Jones, Aiden",4148,30153984,jonesaj,Spring 2026 - 64251\n'
        )
        upload = SimpleUploadedFile('roster.csv', csv_content.encode('utf-8'), content_type='text/csv')

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/people/import/',
            {'file': upload},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['summary']['processed_count'], 3)
        self.assertEqual(response.data['summary']['pending_count'], 1)
        self.assertEqual(response.data['summary']['enrolled_count'], 1)
        self.assertEqual(response.data['summary']['reactivated_count'], 1)

        self.assertFalse(get_user_model().objects.filter(username='jonesaj').exists())
        pending = PendingEnrollment.objects.get(course=self.course, cwid='30153984', status=PendingEnrollmentStatus.PENDING)
        self.assertEqual(pending.sis_login_id, 'jonesaj')
        self.assertEqual(pending.display_name, 'Aiden Jones')

        existing_enrollment = Enrollment.objects.get(course=self.course, user=existing_user)
        self.assertEqual(existing_enrollment.status, EnrollmentStatus.ACTIVE)
        self.assertEqual(existing_enrollment.role, EnrollmentRole.STUDENT)
        self.assertEqual(existing_user.profile.cwid, '30155555')

        dropped_enrollment.refresh_from_db()
        self.assertEqual(dropped_enrollment.status, EnrollmentStatus.ACTIVE)

    def test_course_people_pending_endpoint_returns_pending_roster_for_staff(self):
        PendingEnrollment.objects.create(
            course=self.course,
            created_by=self.instructor,
            student_name='Jones, Aiden',
            display_name='Aiden Jones',
            first_name='Aiden',
            last_name='Jones',
            cwid='30153984',
            sis_login_id='jonesaj',
            section='Spring 2026 - 64251',
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(f'/api/courses/{self.course.id}/people/pending/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['cwid'], '30153984')
        self.assertEqual(response.data[0]['sis_login_id'], 'jonesaj')

    def test_register_claims_pending_enrollments_by_cwid(self):
        PendingEnrollment.objects.create(
            course=self.course,
            created_by=self.instructor,
            student_name='Jones, Aiden',
            display_name='Aiden Jones',
            first_name='Aiden',
            last_name='Jones',
            cwid='30153984',
            sis_login_id='jonesaj',
            section='Spring 2026 - 64251',
        )

        response = self.client.post(
            '/api/register/',
            data=json.dumps(
                {
                    'username': 'jonesaj',
                    'email': 'jonesaj@example.com',
                    'password': 'pass12345',
                    'first_name': 'Aiden',
                    'last_name': 'Jones',
                    'cwid': '30153984',
                }
            ),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)

        new_user = get_user_model().objects.get(username='jonesaj')
        self.assertTrue(
            Enrollment.objects.filter(
                course=self.course,
                user=new_user,
                role=EnrollmentRole.STUDENT,
                status=EnrollmentStatus.ACTIVE,
            ).exists()
        )

        pending = PendingEnrollment.objects.get(course=self.course, cwid='30153984', status=PendingEnrollmentStatus.CLAIMED)
        self.assertEqual(pending.claimed_by_user_id, new_user.id)
        self.assertIsNotNone(pending.claimed_at)

    def test_course_people_import_preview_forbidden_for_student(self):
        csv_content = 'Student,ID,SIS User ID,SIS Login ID,Section\n"Jones, Aiden",4148,30153984,jonesaj,Spring 2026 - 64251\n'
        upload = SimpleUploadedFile('roster.csv', csv_content.encode('utf-8'), content_type='text/csv')

        self.client.force_authenticate(user=self.student)
        response = self.client.post(
            f'/api/courses/{self.course.id}/people/import-preview/',
            {'file': upload},
        )
        self.assertEqual(response.status_code, 403)

    def test_course_grades_grader_returns_student_totals(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/grader-course-grades.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('71.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.grader)
        response = self.client.get(f'/api/courses/{self.course.id}/grades/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 1)
        row = response.data[0]
        self.assertEqual(row['user_id'], self.student.id)
        self.assertEqual(Decimal(str(row['total_score'])), Decimal('71.00'))
        self.assertEqual(Decimal(str(row['total_max_score'])), Decimal('200.00'))

    def test_course_grade_override_allowed_for_grader(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/grader-override.zip',
        )
        Grade.objects.create(submission=submission, score=Decimal('55.00'), max_score=Decimal('100.00'))

        self.client.force_authenticate(user=self.grader)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/override/',
            {
                'assignment_id': str(self.python_assignment.id),
                'user_id': self.student.id,
                'score': '86.00',
                'max_score': '100.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        updated = Grade.objects.get(submission=submission)
        self.assertEqual(updated.score, Decimal('86.00'))

    def test_course_grades_student_returns_assignment_rows(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/sample.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('88.50'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/courses/{self.course.id}/grades/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 2)
        self.assertTrue(all('assignment_title' in row for row in response.data))
        self.assertTrue(all('score' in row for row in response.data))

        by_assignment = {row['assignment_id']: row for row in response.data}
        graded_row = by_assignment[str(self.python_assignment.id)]
        self.assertEqual(graded_row['status'], SubmissionStatus.GRADED)
        self.assertEqual(Decimal(str(graded_row['score'])), Decimal('88.50'))
        self.assertEqual(Decimal(str(graded_row['max_score'])), Decimal('100.00'))

        unsubmitted_row = by_assignment[str(self.java_assignment.id)]
        self.assertEqual(unsubmitted_row['status'], 'NOT_SUBMITTED')
        self.assertEqual(Decimal(str(unsubmitted_row['score'])), Decimal('0.00'))
        self.assertEqual(Decimal(str(unsubmitted_row['max_score'])), Decimal('100.00'))

    def test_course_grades_instructor_returns_student_totals(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/sample.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('75.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(f'/api/courses/{self.course.id}/grades/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 1)
        row = response.data[0]
        self.assertIn('total_score', row)
        self.assertNotIn('assignment_title', row)
        self.assertEqual(row['user_id'], self.student.id)
        self.assertEqual(Decimal(str(row['total_score'])), Decimal('75.00'))
        self.assertEqual(Decimal(str(row['total_max_score'])), Decimal('200.00'))
        self.assertAlmostEqual(float(row['percent']), 37.5)

    def test_course_grades_student_view_for_instructor_returns_assignment_rows(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=2,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/student-view.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('82.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(
            f'/api/courses/{self.course.id}/grades/',
            {'view': 'student', 'user_id': self.student.id},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 2)
        row = next(item for item in response.data if item['assignment_id'] == str(self.python_assignment.id))
        self.assertEqual(row['status'], SubmissionStatus.GRADED)
        self.assertEqual(row['attempt_number'], 2)
        self.assertEqual(Decimal(str(row['score'])), Decimal('82.00'))

    def test_course_grades_student_view_returns_group_submission_for_teammate(self):
        user_model = get_user_model()
        teammate = user_model.objects.create_user(
            username='group_teammate',
            email='group_teammate@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=teammate,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        group = Group.objects.create(course=self.course, group_set=group_set, name='Team Gamma')
        GroupMember.objects.create(group=group, user=self.student)
        GroupMember.objects.create(group=group, user=teammate)
        self.python_assignment.allow_groups = True
        self.python_assignment.group_mode = AssignmentGroupMode.REUSABLE_SET
        self.python_assignment.group_set = group_set
        self.python_assignment.save(update_fields=['allow_groups', 'group_mode', 'group_set'])

        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            group=group,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/group-student-view.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('84.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=teammate)
        response = self.client.get(f'/api/courses/{self.course.id}/grades/')
        self.assertEqual(response.status_code, 200, response.data)
        row = next(item for item in response.data if item['assignment_id'] == str(self.python_assignment.id))
        self.assertEqual(Decimal(str(row['score'])), Decimal('84.00'))
        self.assertEqual(row['group_name'], 'Team Gamma')
        self.assertEqual(row['submitted_by_username'], self.student.username)
        self.assertEqual(row['group_member_usernames'], sorted([self.student.username, teammate.username]))

    def test_course_grades_student_view_requires_user_id(self):
        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(
            f'/api/courses/{self.course.id}/grades/',
            {'view': 'student'},
        )
        self.assertEqual(response.status_code, 400)
        detail = str(response.data.get('detail', response.data))
        self.assertIn('user_id is required', detail)

    def test_course_grades_student_view_forbidden_for_student_requesting_other_user(self):
        user_model = get_user_model()
        other_student = user_model.objects.create_user(
            username='student_b',
            email='student_b@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=other_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )

        self.client.force_authenticate(user=self.student)
        response = self.client.get(
            f'/api/courses/{self.course.id}/grades/',
            {'view': 'student', 'user_id': other_student.id},
        )
        self.assertEqual(response.status_code, 403)

    def test_course_grades_assignment_view_for_instructor_returns_student_rows(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=2,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/sample.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('92.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(
            f'/api/courses/{self.course.id}/grades/',
            {'view': 'assignment', 'assignment_id': str(self.python_assignment.id)},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 1)
        row = response.data[0]
        self.assertEqual(row['user_id'], self.student.id)
        self.assertEqual(row['assignment_id'], str(self.python_assignment.id))
        self.assertEqual(row['grade_state'], 'GRADED')
        self.assertEqual(row['status'], SubmissionStatus.GRADED)
        self.assertEqual(row['attempt_number'], 2)
        self.assertEqual(Decimal(str(row['score'])), Decimal('92.00'))
        self.assertEqual(Decimal(str(row['max_score'])), Decimal('100.00'))

    def test_course_grades_assignment_view_distinguishes_graded_ungraded_and_missing(self):
        user_model = get_user_model()
        student_ungraded = user_model.objects.create_user(
            username='student_ungraded',
            email='student_ungraded@example.com',
            password='pass12345',
        )
        student_missing = user_model.objects.create_user(
            username='student_missing',
            email='student_missing@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=student_ungraded,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        Enrollment.objects.create(
            course=self.course,
            user=student_missing,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        self.python_assignment.due_at = timezone.now() - timedelta(days=1)
        self.python_assignment.save(update_fields=['due_at'])

        graded_submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/graded-state.zip',
        )
        Grade.objects.create(
            submission=graded_submission,
            score=Decimal('92.00'),
            max_score=Decimal('100.00'),
        )

        Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=student_ungraded,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key='submissions/ungraded-state.zip',
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(
            f'/api/courses/{self.course.id}/grades/',
            {'view': 'assignment', 'assignment_id': str(self.python_assignment.id)},
        )
        self.assertEqual(response.status_code, 200, response.data)

        rows_by_user = {row['user_id']: row for row in response.data}
        self.assertEqual(rows_by_user[self.student.id]['grade_state'], 'GRADED')
        self.assertEqual(rows_by_user[student_ungraded.id]['grade_state'], 'UNGRADED')
        self.assertEqual(rows_by_user[student_missing.id]['grade_state'], 'MISSING')

    def test_course_grades_assignment_view_returns_not_submitted_before_due_date(self):
        user_model = get_user_model()
        student_not_submitted = user_model.objects.create_user(
            username='student_not_submitted',
            email='student_not_submitted@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=student_not_submitted,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        self.java_assignment.due_at = timezone.now() + timedelta(days=2)
        self.java_assignment.save(update_fields=['due_at'])

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(
            f'/api/courses/{self.course.id}/grades/',
            {'view': 'assignment', 'assignment_id': str(self.java_assignment.id)},
        )
        self.assertEqual(response.status_code, 200, response.data)

        row = next(item for item in response.data if item['user_id'] == student_not_submitted.id)
        self.assertEqual(row['grade_state'], 'NOT_SUBMITTED')
        self.assertEqual(row['attempt_number'], None)

    def test_course_grades_assignment_view_shows_group_submission_for_each_member(self):
        user_model = get_user_model()
        teammate = user_model.objects.create_user(
            username='assignment_group_teammate',
            email='assignment_group_teammate@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=teammate,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        group_set = GroupSet.objects.create(course=self.course, name='Assignment Teams')
        group = Group.objects.create(course=self.course, group_set=group_set, name='Team Delta')
        GroupMember.objects.create(group=group, user=self.student)
        GroupMember.objects.create(group=group, user=teammate)
        self.python_assignment.allow_groups = True
        self.python_assignment.group_mode = AssignmentGroupMode.REUSABLE_SET
        self.python_assignment.group_set = group_set
        self.python_assignment.save(update_fields=['allow_groups', 'group_mode', 'group_set'])

        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            group=group,
            attempt_number=2,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/group-assignment-view.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('92.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(
            f'/api/courses/{self.course.id}/grades/',
            {'view': 'assignment', 'assignment_id': str(self.python_assignment.id)},
        )
        self.assertEqual(response.status_code, 200, response.data)

        rows_by_user = {row['user_id']: row for row in response.data}
        for user_id in [self.student.id, teammate.id]:
            self.assertEqual(rows_by_user[user_id]['group_name'], 'Team Delta')
            self.assertEqual(rows_by_user[user_id]['submitted_by_username'], self.student.username)
            self.assertEqual(rows_by_user[user_id]['group_member_usernames'], sorted([self.student.username, teammate.username]))
            self.assertEqual(Decimal(str(rows_by_user[user_id]['score'])), Decimal('92.00'))

    def test_course_grades_assignment_view_requires_assignment_id(self):
        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(
            f'/api/courses/{self.course.id}/grades/',
            {'view': 'assignment'},
        )
        self.assertEqual(response.status_code, 400)
        detail = str(response.data.get('detail', response.data))
        self.assertIn('assignment_id is required', detail)

    def test_course_grade_override_updates_latest_submission_grade(self):
        first = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/first.zip',
        )
        second = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=2,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/second.zip',
        )
        Grade.objects.create(submission=first, score=Decimal('10.00'), max_score=Decimal('100.00'))
        Grade.objects.create(submission=second, score=Decimal('20.00'), max_score=Decimal('100.00'))

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/override/',
            {
                'assignment_id': str(self.python_assignment.id),
                'user_id': self.student.id,
                'score': '93.50',
                'max_score': '100.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        updated_latest = Grade.objects.get(submission=second)
        unchanged_first = Grade.objects.get(submission=first)
        self.assertEqual(updated_latest.score, Decimal('93.50'))
        self.assertEqual(updated_latest.max_score, Decimal('100.00'))
        self.assertEqual(unchanged_first.score, Decimal('10.00'))
        second.refresh_from_db()
        self.assertEqual(second.status, SubmissionStatus.GRADED)

    def test_course_grade_override_updates_group_submission_for_teammate(self):
        user_model = get_user_model()
        teammate = user_model.objects.create_user(
            username='override_group_teammate',
            email='override_group_teammate@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=teammate,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        group_set = GroupSet.objects.create(course=self.course, name='Override Teams')
        group = Group.objects.create(course=self.course, group_set=group_set, name='Team Epsilon')
        GroupMember.objects.create(group=group, user=self.student)
        GroupMember.objects.create(group=group, user=teammate)
        self.python_assignment.allow_groups = True
        self.python_assignment.group_mode = AssignmentGroupMode.REUSABLE_SET
        self.python_assignment.group_set = group_set
        self.python_assignment.save(update_fields=['allow_groups', 'group_mode', 'group_set'])

        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            group=group,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/group-override.zip',
        )
        Grade.objects.create(submission=submission, score=Decimal('50.00'), max_score=Decimal('100.00'))

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/override/',
            {
                'assignment_id': str(self.python_assignment.id),
                'user_id': teammate.id,
                'score': '91.00',
                'max_score': '100.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        updated_grade = Grade.objects.get(submission=submission)
        self.assertEqual(updated_grade.score, Decimal('91.00'))
        self.assertEqual(response.data['user_id'], teammate.id)

    def test_course_grade_override_preserves_submission_run_status(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key='submissions/preserve-run-status.zip',
        )
        Grade.objects.create(submission=submission, score=Decimal('40.00'), max_score=Decimal('100.00'))

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/override/',
            {
                'assignment_id': str(self.python_assignment.id),
                'user_id': self.student.id,
                'score': '77.00',
                'max_score': '100.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        submission.refresh_from_db()
        self.assertEqual(submission.status, SubmissionStatus.FAILED)
        self.assertEqual(response.data['status'], SubmissionStatus.FAILED)
        self.assertEqual(response.data['grade_state'], 'GRADED')

    def test_course_grades_export_overall_returns_csv(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/export-overall.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('60.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(f'/api/courses/{self.course.id}/grades/export/?view=overall')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/csv')
        self.assertIn('attachment;', response['Content-Disposition'])
        content = response.content.decode('utf-8')
        self.assertIn('User ID,Username,Display Name,Email,CWID,Total Score,Total Max Score,Percent', content)
        self.assertIn('60.00,200.00', content)

    def test_course_grades_export_student_returns_csv(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/export-student.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('91.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.get(
            f'/api/courses/{self.course.id}/grades/export/',
            {'view': 'student', 'user_id': self.student.id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/csv')
        content = response.content.decode('utf-8')
        self.assertIn('Assignment ID,Assignment,Due At,Status,Attempt,Submitted At,Score,Max Score,Percent', content)
        self.assertIn('91.00', content)

    def test_course_grades_report_returns_selected_students_and_assignments(self):
        user_model = get_user_model()
        second_student = user_model.objects.create_user(
            username='student_report',
            email='student_report@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=second_student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )

        graded_submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/report-graded.zip',
        )
        Grade.objects.create(
            submission=graded_submission,
            score=Decimal('88.00'),
            max_score=Decimal('100.00'),
        )
        Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=second_student,
            attempt_number=1,
            status=SubmissionStatus.FAILED,
            source_bundle_key='submissions/report-ungraded.zip',
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/report/',
            {
                'user_ids': [self.student.id, second_student.id],
                'assignment_ids': [str(self.python_assignment.id)],
                'include_all_assignments': False,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['students']), 2)
        self.assertEqual(len(response.data['assignments']), 1)

        rows_by_user = {row['user_id']: row for row in response.data['rows']}
        first_cell = rows_by_user[self.student.id]['cells'][str(self.python_assignment.id)]
        second_cell = rows_by_user[second_student.id]['cells'][str(self.python_assignment.id)]
        self.assertEqual(first_cell['grade_state'], 'GRADED')
        self.assertEqual(Decimal(str(first_cell['score'])), Decimal('88.00'))
        self.assertEqual(second_cell['grade_state'], 'UNGRADED')
        self.assertEqual(second_cell['status'], SubmissionStatus.FAILED)

    def test_course_grades_report_includes_group_context_for_group_members(self):
        user_model = get_user_model()
        teammate = user_model.objects.create_user(
            username='report_group_teammate',
            email='report_group_teammate@example.com',
            password='pass12345',
        )
        Enrollment.objects.create(
            course=self.course,
            user=teammate,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        group_set = GroupSet.objects.create(course=self.course, name='Report Teams')
        group = Group.objects.create(course=self.course, group_set=group_set, name='Team Zeta')
        GroupMember.objects.create(group=group, user=self.student)
        GroupMember.objects.create(group=group, user=teammate)
        self.python_assignment.allow_groups = True
        self.python_assignment.group_mode = AssignmentGroupMode.REUSABLE_SET
        self.python_assignment.group_set = group_set
        self.python_assignment.save(update_fields=['allow_groups', 'group_mode', 'group_set'])

        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            group=group,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/report-group.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('90.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/report/',
            {
                'user_ids': [self.student.id, teammate.id],
                'assignment_ids': [str(self.python_assignment.id)],
                'include_all_assignments': False,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        rows_by_user = {row['user_id']: row for row in response.data['rows']}
        teammate_cell = rows_by_user[teammate.id]['cells'][str(self.python_assignment.id)]
        self.assertEqual(teammate_cell['group_name'], 'Team Zeta')
        self.assertEqual(teammate_cell['submitted_by_username'], self.student.username)
        self.assertEqual(teammate_cell['group_member_usernames'], sorted([self.student.username, teammate.username]))

    def test_course_grades_report_returns_all_assignments_when_requested(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/report-all-assignments.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('64.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/report/',
            {
                'user_ids': [self.student.id],
                'include_all_assignments': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['assignments']), 2)
        row = response.data['rows'][0]
        self.assertEqual(row['user_id'], self.student.id)
        self.assertIn(str(self.python_assignment.id), row['cells'])
        self.assertIn(str(self.java_assignment.id), row['cells'])
        self.assertEqual(row['cells'][str(self.java_assignment.id)]['grade_state'], 'NOT_SUBMITTED')

    def test_course_grades_report_export_returns_csv(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/report-export.zip',
        )
        Grade.objects.create(
            submission=submission,
            score=Decimal('93.00'),
            max_score=Decimal('100.00'),
        )

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/report/export/',
            {
                'user_ids': [self.student.id],
                'assignment_ids': [str(self.python_assignment.id)],
                'include_all_assignments': False,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/csv')
        content = response.content.decode('utf-8')
        self.assertIn('User ID,Username,Display Name,Email,CWID,Total Score,Total Max Score,Total Percent', content)
        self.assertIn('Python OOP Assignment Score', content)
        self.assertIn('93.00', content)

    def test_course_grades_report_forbidden_for_student(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/report/',
            {
                'user_ids': [self.student.id],
                'include_all_assignments': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_course_grade_override_forbidden_for_student(self):
        submission = Submission.objects.create(
            assignment=self.python_assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.GRADED,
            source_bundle_key='submissions/only.zip',
        )
        Grade.objects.create(submission=submission, score=Decimal('60.00'), max_score=Decimal('100.00'))

        self.client.force_authenticate(user=self.student)
        response = self.client.post(
            f'/api/courses/{self.course.id}/grades/override/',
            {
                'assignment_id': str(self.python_assignment.id),
                'user_id': self.student.id,
                'score': '80.00',
                'max_score': '100.00',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 403)


class CourseGroupsApiTests(APITestCase):
    def setUp(self):
        super().setUp()
        user_model = get_user_model()
        self.instructor = user_model.objects.create_user(
            username='groups_instructor',
            email='groups_instructor@example.com',
            password='pass12345',
        )
        self.ta = user_model.objects.create_user(
            username='groups_ta',
            email='groups_ta@example.com',
            password='pass12345',
        )
        self.student = user_model.objects.create_user(
            username='groups_student',
            email='groups_student@example.com',
            password='pass12345',
        )
        self.student_two = user_model.objects.create_user(
            username='groups_student_two',
            email='groups_student_two@example.com',
            password='pass12345',
        )
        self.course = Course.objects.create(
            code='CSCI4500',
            title='Distributed Systems',
            term='Spring 2026',
            section='01',
        )
        Enrollment.objects.create(
            course=self.course,
            user=self.instructor,
            role=EnrollmentRole.INSTRUCTOR,
            status=EnrollmentStatus.ACTIVE,
        )
        Enrollment.objects.create(
            course=self.course,
            user=self.ta,
            role=EnrollmentRole.TA,
            status=EnrollmentStatus.ACTIVE,
        )
        Enrollment.objects.create(
            course=self.course,
            user=self.student,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )
        Enrollment.objects.create(
            course=self.course,
            user=self.student_two,
            role=EnrollmentRole.STUDENT,
            status=EnrollmentStatus.ACTIVE,
        )

    def test_instructor_can_create_group_set_group_and_member(self):
        self.client.force_authenticate(user=self.instructor)

        set_response = self.client.post(
            f'/api/courses/{self.course.id}/groups/sets/',
            {'name': 'Project Teams'},
            format='json',
        )
        self.assertEqual(set_response.status_code, 201, set_response.data)
        group_set_id = set_response.data['id']

        group_response = self.client.post(
            f'/api/courses/{self.course.id}/groups/items/',
            {'name': 'Team Alpha', 'group_set_id': group_set_id},
            format='json',
        )
        self.assertEqual(group_response.status_code, 201, group_response.data)
        group_id = group_response.data['id']

        member_response = self.client.post(
            f'/api/courses/{self.course.id}/groups/items/{group_id}/members/',
            {'user_id': self.student.id},
            format='json',
        )
        self.assertEqual(member_response.status_code, 201, member_response.data)
        self.assertEqual(member_response.data['added_count'], 1)
        self.assertEqual(member_response.data['members'][0]['user_id'], self.student.id)

        payload_response = self.client.get(f'/api/courses/{self.course.id}/groups/')
        self.assertEqual(payload_response.status_code, 200, payload_response.data)
        self.assertEqual(len(payload_response.data['group_sets']), 1)
        self.assertEqual(payload_response.data['group_sets'][0]['name'], 'Project Teams')
        self.assertEqual(payload_response.data['group_sets'][0]['group_count'], 1)
        self.assertEqual(payload_response.data['group_sets'][0]['member_count'], 1)
        self.assertEqual(payload_response.data['group_sets'][0]['groups'][0]['name'], 'Team Alpha')
        self.assertEqual(payload_response.data['group_sets'][0]['groups'][0]['members'][0]['user_id'], self.student.id)

    def test_instructor_can_add_multiple_group_members_at_once(self):
        group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        group = Group.objects.create(course=self.course, group_set=group_set, name='Team Alpha')

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/groups/items/{group.id}/members/',
            {'user_ids': [self.student.id, self.student_two.id]},
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['added_count'], 2)
        returned_ids = {member['user_id'] for member in response.data['members']}
        self.assertEqual(returned_ids, {self.student.id, self.student_two.id})
        self.assertEqual(GroupMember.objects.filter(group=group).count(), 2)

    def test_student_cannot_manage_groups(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.get(f'/api/courses/{self.course.id}/groups/')
        self.assertEqual(response.status_code, 403)

    def test_ta_can_manage_groups(self):
        self.client.force_authenticate(user=self.ta)
        response = self.client.post(
            f'/api/courses/{self.course.id}/groups/sets/',
            {'name': 'Lab Teams'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_student_cannot_join_two_groups_in_same_set(self):
        group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        group_a = Group.objects.create(course=self.course, group_set=group_set, name='Team A')
        group_b = Group.objects.create(course=self.course, group_set=group_set, name='Team B')
        GroupMember.objects.create(group=group_a, user=self.student)

        self.client.force_authenticate(user=self.instructor)
        response = self.client.post(
            f'/api/courses/{self.course.id}/groups/items/{group_b.id}/members/',
            {'user_id': self.student.id},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('another group in this set', str(response.data))

    def test_cannot_delete_non_empty_group_set(self):
        group_set = GroupSet.objects.create(course=self.course, name='Project Teams')
        Group.objects.create(course=self.course, group_set=group_set, name='Team A')

        self.client.force_authenticate(user=self.instructor)
        response = self.client.delete(f'/api/courses/{self.course.id}/groups/sets/{group_set.id}/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('Remove all groups', str(response.data))


class IntegrityApiTests(APITestCase):
    def setUp(self):
        super().setUp()
        self._media_dir = tempfile.mkdtemp(prefix='autograder_integrity_media_')
        self._media_override = override_settings(MEDIA_ROOT=self._media_dir)
        self._media_override.enable()
        self.addCleanup(self._media_override.disable)
        self.addCleanup(lambda: shutil.rmtree(self._media_dir, ignore_errors=True))

        user_model = get_user_model()
        self.instructor = user_model.objects.create_user(
            username='integrity-instructor',
            email='integrity-instructor@example.com',
            password='pass12345',
        )
        self.student_a = user_model.objects.create_user(
            username='integrity-student-a',
            email='integrity-student-a@example.com',
            password='pass12345',
        )
        self.student_b = user_model.objects.create_user(
            username='integrity-student-b',
            email='integrity-student-b@example.com',
            password='pass12345',
        )
        self.student_c = user_model.objects.create_user(
            username='integrity-student-c',
            email='integrity-student-c@example.com',
            password='pass12345',
        )
        self.course = Course.objects.create(
            code='CSCI4500',
            title='Integrity Testing',
            term='Spring 2026',
            section='01',
        )
        Enrollment.objects.create(
            course=self.course,
            user=self.instructor,
            role=EnrollmentRole.INSTRUCTOR,
            status=EnrollmentStatus.ACTIVE,
        )
        for student in [self.student_a, self.student_b, self.student_c]:
            Enrollment.objects.create(
                course=self.course,
                user=student,
                role=EnrollmentRole.STUDENT,
                status=EnrollmentStatus.ACTIVE,
            )
        self.language = ProgrammingLanguage.objects.create(
            name='Java 17',
            slug='java17-integrity',
            compile_cmd='',
            run_cmd_template='',
            is_enabled=True,
        )
        self.assignment = Assignment.objects.create(
            course=self.course,
            title='Integrity Assignment',
            language=self.language,
            max_score=100,
        )
        self.client.force_authenticate(user=self.instructor)

    def _store_submission_bundle(self, assignment, owner_segment, filename, files_payload):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
            for name, content in files_payload.items():
                zip_ref.writestr(name, content)
        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        return storage.save(
            os.path.join('submissions', str(assignment.id), owner_segment, filename),
            ContentFile(buffer.getvalue(), name=filename),
        )

    def _create_submission(self, *, assignment, submitted_by, attempt_number, files_payload, group=None):
        owner_segment = f'groups/{group.id}' if group else str(submitted_by.id)
        stored_path = self._store_submission_bundle(
            assignment,
            owner_segment,
            f'{attempt_number}.zip',
            files_payload,
        )
        return Submission.objects.create(
            assignment=assignment,
            submitted_by=submitted_by,
            group=group,
            attempt_number=attempt_number,
            status=SubmissionStatus.GRADED,
            source_bundle_key=stored_path,
        )

    def _create_active_test_suite_bundle(self, assignment, tests_payload):
        payload_bytes = json.dumps(tests_payload, indent=2).encode('utf-8')
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
            zip_ref.writestr('tests.json', payload_bytes)
            zip_ref.writestr('README.md', 'integrity test bundle')
        content = buffer.getvalue()
        checksum = hashlib.sha256(content).hexdigest()
        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        bundle_key = storage.save(
            os.path.join('test_suites', str(assignment.id), 'private', 'v1_integrity-auto.zip'),
            ContentFile(content, name='v1_integrity-auto.zip'),
        )
        test_suite, _ = TestSuite.objects.get_or_create(assignment=assignment)
        version = TestSuiteVersion.objects.create(
            test_suite=test_suite,
            version_number=1,
            visibility='PRIVATE',
            execution_mode=TestSuiteExecutionMode.PYTHON_RUNNER,
            bundle_key=bundle_key,
            checksum=checksum,
        )
        test_suite.active_version = version
        test_suite.save(update_fields=['active_version'])
        return version

    def test_integrity_scan_uses_latest_submission_per_student_owner(self):
        older = self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_a,
            attempt_number=1,
            files_payload={
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        int total = 0;
                        for (int i = 0; i < 10; i++) {
                            total += i;
                        }
                        System.out.println(total);
                    }
                }
                """,
            },
        )
        latest = self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_a,
            attempt_number=2,
            files_payload={
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        int sum = 0;
                        for (int value = 0; value < 10; value++) {
                            sum += value;
                        }
                        System.out.println(sum);
                    }
                }
                """,
            },
        )
        peer = self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_b,
            attempt_number=1,
            files_payload={
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        int result = 0;
                        for (int cursor = 0; cursor < 10; cursor++) {
                            result += cursor;
                        }
                        System.out.println(result);
                    }
                }
                """,
            },
        )
        self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_c,
            attempt_number=1,
            files_payload={
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        System.out.println("different");
                    }
                }
                """,
            },
        )

        response = self.client.post(
            f'/api/assignments/{self.assignment.id}/integrity-scans/',
            {'threshold': 25, 'latest_only': True},
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], IntegrityScanStatus.DONE)
        self.assertEqual(response.data['provider'], IntegrityScanProvider.LOCAL)
        self.assertEqual(response.data['scan_type'], IntegrityScanType.PLAGIARISM)
        self.assertGreaterEqual(response.data['findings_count'], 1)

        scan_id = response.data['id']
        findings_response = self.client.get(
            f'/api/assignments/{self.assignment.id}/integrity-scans/{scan_id}/findings/'
        )
        self.assertEqual(findings_response.status_code, 200, findings_response.data)
        findings = findings_response.data['findings']
        self.assertTrue(findings)
        finding = findings[0]
        compared_ids = {
            finding['submission_context']['id'],
            finding['matched_submission_context']['id'],
        }
        self.assertEqual(compared_ids, {str(latest.id), str(peer.id)})
        self.assertNotIn(str(older.id), compared_ids)
        self.assertGreater(float(finding['score']), 25)
        self.assertTrue(finding['matched_files'])

    def test_integrity_scan_uses_group_owners_for_group_assignments(self):
        group_set = GroupSet.objects.create(course=self.course, name='Capstone Teams')
        group_a = Group.objects.create(course=self.course, group_set=group_set, name='Capstone 1')
        group_b = Group.objects.create(course=self.course, group_set=group_set, name='Capstone 2')
        GroupMember.objects.create(group=group_a, user=self.student_a)
        GroupMember.objects.create(group=group_a, user=self.student_b)
        GroupMember.objects.create(group=group_b, user=self.student_c)

        grouped_assignment = Assignment.objects.create(
            course=self.course,
            title='Grouped Integrity Assignment',
            language=self.language,
            max_score=100,
            allow_groups=True,
            group_mode=AssignmentGroupMode.REUSABLE_SET,
            group_set=group_set,
        )
        left = self._create_submission(
            assignment=grouped_assignment,
            submitted_by=self.student_a,
            group=group_a,
            attempt_number=1,
            files_payload={
                'Inventory.java': """
                public class Inventory {
                    public int add(int left, int right) {
                        return left + right;
                    }
                }
                """,
            },
        )
        right = self._create_submission(
            assignment=grouped_assignment,
            submitted_by=self.student_c,
            group=group_b,
            attempt_number=1,
            files_payload={
                'Inventory.java': """
                public class Inventory {
                    public int add(int a, int b) {
                        return a + b;
                    }
                }
                """,
            },
        )

        response = self.client.post(
            f'/api/assignments/{grouped_assignment.id}/integrity-scans/',
            {'threshold': 20, 'latest_only': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], IntegrityScanStatus.DONE)

        findings_response = self.client.get(
            f'/api/assignments/{grouped_assignment.id}/integrity-scans/{response.data["id"]}/findings/'
        )
        self.assertEqual(findings_response.status_code, 200, findings_response.data)
        findings = findings_response.data['findings']
        self.assertEqual(len(findings), 1)
        finding = findings[0]
        self.assertEqual(
            {finding['owner_label'], finding['matched_owner_label']},
            {group_a.name, group_b.name},
        )
        self.assertIn(self.student_a.username, finding['owner_members'] + finding['matched_owner_members'])
        self.assertIn(self.student_c.username, finding['owner_members'] + finding['matched_owner_members'])
        compared_ids = {
            finding['submission_context']['id'],
            finding['matched_submission_context']['id'],
        }
        self.assertEqual(compared_ids, {str(left.id), str(right.id)})

    def test_student_cannot_access_assignment_integrity_scans(self):
        self.client.force_authenticate(user=self.student_a)
        response = self.client.get(f'/api/assignments/{self.assignment.id}/integrity-scans/')
        self.assertEqual(response.status_code, 403)

    def test_integrity_settings_round_trip(self):
        update_response = self.client.put(
            f'/api/assignments/{self.assignment.id}/integrity-settings/',
            {
                'threshold': 42,
                'latest_only': False,
                'excluded_paths': ['Driver.java', 'starter/Helper.java'],
            },
            format='json',
        )
        self.assertEqual(update_response.status_code, 200, update_response.data)
        self.assertEqual(update_response.data['threshold'], 42)
        self.assertEqual(update_response.data['excluded_paths'], ['Driver.java', 'starter/Helper.java'])
        self.assertEqual(update_response.data['manual_excluded_paths'], ['Driver.java', 'starter/Helper.java'])
        self.assertEqual(update_response.data['auto_excluded_paths'], [])
        self.assertEqual(update_response.data['effective_excluded_paths'], ['Driver.java', 'starter/Helper.java'])

        get_response = self.client.get(f'/api/assignments/{self.assignment.id}/integrity-settings/')
        self.assertEqual(get_response.status_code, 200, get_response.data)
        self.assertEqual(get_response.data['threshold'], 42)
        self.assertEqual(get_response.data['latest_only'], False)
        self.assertEqual(get_response.data['excluded_paths'], ['Driver.java', 'starter/Helper.java'])
        self.assertEqual(get_response.data['auto_excluded_paths'], [])

    def test_integrity_settings_include_auto_excluded_assignment_files(self):
        self._create_active_test_suite_bundle(
            self.assignment,
            {
                'type': 'FILE_IO',
                'language': 'java',
                'main_class': 'Driver',
                'grading_files': [
                    {'path': 'Driver.java', 'source': 'grading/Driver.java'},
                    {'path': 'starter/Helper.java', 'source': 'grading/starter/Helper.java'},
                ],
            },
        )
        storage = FileSystemStorage(location=settings.MEDIA_ROOT)
        starter_buffer = io.BytesIO()
        with zipfile.ZipFile(starter_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
            zip_ref.writestr('starter/Inventory.java', 'public class Inventory {}')
            zip_ref.writestr('README.md', '# not source')
        starter_key = storage.save(
            os.path.join('assignment_files', str(self.assignment.id), 'starter.zip'),
            ContentFile(
                starter_buffer.getvalue(),
                name='starter.zip',
            ),
        )
        AssignmentInstructionAsset.objects.create(
            assignment=self.assignment,
            original_name='starter.zip',
            file_key=starter_key,
            mime_type='application/zip',
            file_size=0,
            display_order=1,
        )

        response = self.client.get(f'/api/assignments/{self.assignment.id}/integrity-settings/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['excluded_paths'], [])
        self.assertCountEqual(
            response.data['auto_excluded_paths'],
            ['Driver.java', 'starter/Helper.java', 'starter/Inventory.java'],
        )
        self.assertCountEqual(
            response.data['effective_excluded_paths'],
            ['Driver.java', 'starter/Helper.java', 'starter/Inventory.java'],
        )

    def test_integrity_scan_can_ignore_shared_starter_file_paths(self):
        self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_a,
            attempt_number=1,
            files_payload={
                'Driver.java': """
                public class Driver {
                    public static void main(String[] args) {
                        System.out.println("starter");
                    }
                }
                """,
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        int total = 0;
                        for (int i = 0; i < 8; i++) {
                            total += i;
                        }
                        System.out.println(total);
                    }
                }
                """,
            },
        )
        self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_b,
            attempt_number=1,
            files_payload={
                'Driver.java': """
                public class Driver {
                    public static void main(String[] args) {
                        System.out.println("starter");
                    }
                }
                """,
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        int[] values = {2, 4, 6};
                        int index = 0;
                        while (index < values.length) {
                            System.out.println(values[index]);
                            index++;
                        }
                    }
                }
                """,
            },
        )

        response = self.client.post(
            f'/api/assignments/{self.assignment.id}/integrity-scans/',
            {'threshold': 60, 'latest_only': True, 'excluded_paths': ['Driver.java']},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['excluded_paths'], ['Driver.java'])

        findings_response = self.client.get(
            f'/api/assignments/{self.assignment.id}/integrity-scans/{response.data["id"]}/findings/'
        )
        self.assertEqual(findings_response.status_code, 200, findings_response.data)
        self.assertEqual(findings_response.data['findings'], [])

    def test_integrity_scan_auto_ignores_active_suite_grading_files(self):
        self._create_active_test_suite_bundle(
            self.assignment,
            {
                'type': 'FILE_IO',
                'language': 'java',
                'main_class': 'Driver',
                'grading_files': [
                    {'path': 'Driver.java', 'source': 'grading/Driver.java'},
                ],
            },
        )
        self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_a,
            attempt_number=1,
            files_payload={
                'Driver.java': """
                public class Driver {
                    public static void main(String[] args) {
                        System.out.println("starter");
                    }
                }
                """,
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        System.out.println("alpha");
                    }
                }
                """,
            },
        )
        self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_b,
            attempt_number=1,
            files_payload={
                'Driver.java': """
                public class Driver {
                    public static void main(String[] args) {
                        System.out.println("starter");
                    }
                }
                """,
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        int[] values = {2, 4, 6};
                        int index = 0;
                        while (index < values.length) {
                            System.out.println(values[index]);
                            index++;
                        }
                    }
                }
                """,
            },
        )

        response = self.client.post(
            f'/api/assignments/{self.assignment.id}/integrity-scans/',
            {'threshold': 60, 'latest_only': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['auto_excluded_paths'], ['Driver.java'])
        self.assertEqual(response.data['excluded_paths'], ['Driver.java'])

        findings_response = self.client.get(
            f'/api/assignments/{self.assignment.id}/integrity-scans/{response.data["id"]}/findings/'
        )
        self.assertEqual(findings_response.status_code, 200, findings_response.data)
        self.assertEqual(findings_response.data['findings'], [])

    def test_integrity_finding_review_returns_matched_sources(self):
        left = self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_a,
            attempt_number=1,
            files_payload={
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        int sum = 0;
                        for (int i = 0; i < 5; i++) {
                            sum += i;
                        }
                        System.out.println(sum);
                    }
                }
                """,
            },
        )
        right = self._create_submission(
            assignment=self.assignment,
            submitted_by=self.student_b,
            attempt_number=1,
            files_payload={
                'Main.java': """
                public class Main {
                    public static void main(String[] args) {
                        int total = 0;
                        for (int cursor = 0; cursor < 5; cursor++) {
                            total += cursor;
                        }
                        System.out.println(total);
                    }
                }
                """,
            },
        )

        response = self.client.post(
            f'/api/assignments/{self.assignment.id}/integrity-scans/',
            {'threshold': 20, 'latest_only': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)

        scan = IntegrityScan.objects.get(id=response.data['id'])
        finding = IntegrityFinding.objects.get(scan=scan)
        review_response = self.client.get(
            f'/api/assignments/{self.assignment.id}/integrity-scans/{scan.id}/findings/{finding.id}/review/'
        )
        self.assertEqual(review_response.status_code, 200, review_response.data)
        self.assertEqual(review_response.data['finding']['id'], str(finding.id))
        self.assertTrue(review_response.data['matched_files'])
        self.assertIn('public class Main', review_response.data['left_source'])
        self.assertIn('public class Main', review_response.data['right_source'])
        selected_pair = review_response.data['selected_pair']
        self.assertEqual(selected_pair['left_path'], 'Main.java')
        self.assertEqual(selected_pair['right_path'], 'Main.java')
        self.assertTrue(selected_pair['matched_regions'])
        self.assertEqual(
            {review_response.data['finding']['submission_context']['id'], review_response.data['finding']['matched_submission_context']['id']},
            {str(left.id), str(right.id)},
        )


class RunnerExecutionModeTests(TestCase):
    def setUp(self):
        self.language = ProgrammingLanguage.objects.create(
            name='Python 3',
            slug='python3-runner-tests',
            compile_cmd='',
            run_cmd_template='python {tests_dir}/run.py {submission_dir} {workspace}',
            is_enabled=True,
        )
        self.course = Course.objects.create(code='CSCI202', title='Runner Tests', term='Spring 2026', section='01')
        user_model = get_user_model()
        self.student = user_model.objects.create_user(
            username='runner_student',
            email='runner_student@example.com',
            password='pass12345',
        )
        self.assignment = Assignment.objects.create(
            course=self.course,
            title='Runner Assignment',
            language=self.language,
            max_score=100,
        )
        self.submission = Submission.objects.create(
            assignment=self.assignment,
            submitted_by=self.student,
            attempt_number=1,
            status=SubmissionStatus.RUNNING,
            source_bundle_key='submissions/runner.zip',
        )

    def test_resolve_run_command_uses_generated_python_runner(self):
        language = ProgrammingLanguage(
            name='Java 17',
            slug='java17',
            compile_cmd='',
            run_cmd_template='echo "{tests_dir}" "{submission_dir}" "{workspace}"',
            is_enabled=True,
        )
        version = TestSuiteVersion(execution_mode=TestSuiteExecutionMode.PYTHON_RUNNER)

        with tempfile.TemporaryDirectory(prefix='runner_tests_') as tests_dir:
            candidate = Path(tests_dir) / 'run_tests.py'
            candidate.write_text('print("ok")', encoding='utf-8')
            cmd = _resolve_run_command(
                language=language,
                test_version=version,
                submission_dir='/tmp/submission',
                tests_dir=tests_dir,
                workspace='/tmp/workspace',
            )

        self.assertIn(str(candidate), cmd)
        self.assertIn(sys.executable, cmd)
        self.assertIn('/tmp/submission', cmd)
        self.assertIn('/tmp/workspace', cmd)

    def test_resolve_run_command_falls_back_to_language_template(self):
        language = ProgrammingLanguage(
            name='Python 3',
            slug='python3',
            compile_cmd='',
            run_cmd_template='python {tests_dir}/run.py {submission_dir} {workspace}',
            is_enabled=True,
        )
        version = TestSuiteVersion(execution_mode=TestSuiteExecutionMode.PYTHON_RUNNER)

        cmd = _resolve_run_command(
            language=language,
            test_version=version,
            submission_dir='/tmp/submission',
            tests_dir='/tmp/tests',
            workspace='/tmp/workspace',
        )
        self.assertEqual(cmd, 'python /tmp/tests/run.py /tmp/submission /tmp/workspace')

    def test_combine_output_does_not_emit_empty_test_marker(self):
        combined = _combine_output(None, {'stderr': ''}, 'stderr')
        self.assertEqual(combined, '')

    def test_persist_results_marks_failed_when_any_test_fails_and_does_not_create_grade(self):
        run = GradingRun.objects.create(
            submission=self.submission,
            worker_id='test-worker',
            exit_status=GradingExitStatus.OK,
        )

        _persist_results(
            run=run,
            submission=self.submission,
            results_payload={
                'tests': [
                    {'name': 'case-1', 'status': 'PASS'},
                    {'name': 'case-2', 'status': 'FAIL'},
                ]
            },
            stdout_key='',
            stderr_key='',
            exit_status=GradingExitStatus.OK,
            max_score=self.assignment.max_score,
        )

        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, SubmissionStatus.FAILED)
        self.assertFalse(Grade.objects.filter(submission=self.submission).exists())

    def test_persist_results_preserves_manual_grade_and_updates_latest_run(self):
        existing_run = GradingRun.objects.create(
            submission=self.submission,
            worker_id='previous-worker',
            exit_status=GradingExitStatus.OK,
        )
        grade = Grade.objects.create(
            submission=self.submission,
            latest_grading_run=existing_run,
            score=Decimal('87.00'),
            max_score=Decimal('100.00'),
        )
        next_run = GradingRun.objects.create(
            submission=self.submission,
            worker_id='next-worker',
            exit_status=GradingExitStatus.OK,
        )

        _persist_results(
            run=next_run,
            submission=self.submission,
            results_payload={'tests': [{'name': 'case-1', 'status': 'PASS'}]},
            stdout_key='',
            stderr_key='',
            exit_status=GradingExitStatus.OK,
            max_score=self.assignment.max_score,
        )

        self.submission.refresh_from_db()
        grade.refresh_from_db()
        self.assertEqual(self.submission.status, SubmissionStatus.GRADED)
        self.assertEqual(grade.score, Decimal('87.00'))
        self.assertEqual(grade.max_score, Decimal('100.00'))
        self.assertEqual(grade.latest_grading_run_id, next_run.id)


class SeedLanguagesCommandTests(TestCase):
    def test_seed_languages_creates_python_and_java_defaults(self):
        stdout = io.StringIO()

        call_command('seed_languages', stdout=stdout)

        python_language = ProgrammingLanguage.objects.get(slug='python3')
        java_language = ProgrammingLanguage.objects.get(slug='java17')

        self.assertEqual(python_language.name, 'Python 3')
        self.assertEqual(java_language.name, 'Java 17')
        self.assertEqual(
            python_language.run_cmd_template,
            'python {tests_dir}/run_tests.py {submission_dir} {workspace}',
        )
        self.assertEqual(
            java_language.run_cmd_template,
            'python {tests_dir}/run_tests.py {submission_dir} {workspace}',
        )
        self.assertTrue(python_language.is_enabled)
        self.assertTrue(java_language.is_enabled)
        self.assertIn('Created language: Python 3 (python3)', stdout.getvalue())
        self.assertIn('Created language: Java 17 (java17)', stdout.getvalue())

    def test_seed_languages_updates_existing_defaults_without_duplicates(self):
        ProgrammingLanguage.objects.create(
            name='Python old',
            slug='python3',
            docker_image='legacy:image',
            compile_cmd='python -m py_compile main.py',
            run_cmd_template='python legacy.py',
            is_enabled=False,
        )

        stdout = io.StringIO()
        call_command('seed_languages', stdout=stdout)

        self.assertEqual(ProgrammingLanguage.objects.filter(slug='python3').count(), 1)
        python_language = ProgrammingLanguage.objects.get(slug='python3')
        self.assertEqual(python_language.name, 'Python 3')
        self.assertEqual(python_language.docker_image, '')
        self.assertEqual(python_language.compile_cmd, '')
        self.assertEqual(
            python_language.run_cmd_template,
            'python {tests_dir}/run_tests.py {submission_dir} {workspace}',
        )
        self.assertTrue(python_language.is_enabled)
        self.assertIn('Updated language: Python 3 (python3)', stdout.getvalue())
