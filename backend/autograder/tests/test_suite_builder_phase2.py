import json
import os
import shutil
import tempfile
import zipfile

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import (
    Assignment,
    Course,
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    ProgrammingLanguage,
    TestSuite,
    TestSuiteVisibility,
)


class TestSuiteBuilderPhase2Tests(APITestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp(prefix='gradeforge_test_media_')
        self.media_override = override_settings(MEDIA_ROOT=self.media_root)
        self.media_override.enable()
        self.addCleanup(self.media_override.disable)
        self.addCleanup(lambda: shutil.rmtree(self.media_root, ignore_errors=True))

        user_model = get_user_model()
        self.instructor = user_model.objects.create_user(username='instructor', password='test-pass')
        self.student = user_model.objects.create_user(username='student', password='test-pass')

        self.course = Course.objects.create(code='CPSC-101', title='Intro to Programming')
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

        self.python_language = ProgrammingLanguage.objects.create(
            name='Python',
            slug='python-tests',
            run_cmd_template='python {tests_dir}/run_tests.py {submission_dir} {workspace}',
        )
        self.java_language = ProgrammingLanguage.objects.create(
            name='Java',
            slug='java-tests',
            run_cmd_template='bash {tests_dir}/run_tests.sh',
        )

        self.assignment = Assignment.objects.create(
            course=self.course,
            title='Function Builder Assignment',
            language=self.python_language,
            max_score=100,
        )
        self.build_url = f'/api/assignments/{self.assignment.id}/test-suites/build/'

    def _function_payload(self, **overrides):
        payload = {
            'type': 'FUNCTION',
            'name': 'function-suite',
            'visibility': TestSuiteVisibility.PRIVATE,
            'set_active': True,
            'module_path': 'student.py',
            'function_tests': [
                {
                    'name': 'sum-basic',
                    'function_name': 'add',
                    'args': [2, 3],
                    'expected': 5,
                    'points': 5,
                }
            ],
            'timeout_ms': 1200,
        }
        payload.update(overrides)
        return payload

    def test_instructor_can_build_function_suite_and_bundle_contains_contract(self):
        self.client.force_authenticate(self.instructor)
        response = self.client.post(
            self.build_url,
            data=self._function_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['visibility'], TestSuiteVisibility.PRIVATE)
        self.assertTrue(response.data['is_active'])

        test_suite = TestSuite.objects.get(assignment=self.assignment)
        self.assertEqual(str(test_suite.active_version_id), str(response.data['id']))

        bundle_key = response.data['bundle_key']
        bundle_path = os.path.join(settings.MEDIA_ROOT, bundle_key)
        self.assertTrue(os.path.exists(bundle_path))

        with zipfile.ZipFile(bundle_path, 'r') as zip_ref:
            names = set(zip_ref.namelist())
            self.assertIn('README.md', names)
            self.assertIn('tests.json', names)
            self.assertIn('run_tests.py', names)
            tests_payload = json.loads(zip_ref.read('tests.json').decode('utf-8'))
            runner = zip_ref.read('run_tests.py').decode('utf-8')

        self.assertEqual(tests_payload['type'], 'FUNCTION')
        self.assertEqual(tests_payload['module_path'], 'student.py')
        self.assertEqual(len(tests_payload['tests']), 1)
        self.assertEqual(tests_payload['tests'][0]['function_name'], 'add')
        self.assertIn('import importlib.util', runner)
        self.assertIn('Function not found', runner)

    def test_build_function_suite_rejects_invalid_module_path(self):
        self.client.force_authenticate(self.instructor)
        response = self.client.post(
            self.build_url,
            data=self._function_payload(module_path='../student.py'),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('module_path', response.data)

    def test_build_function_suite_requires_function_cases(self):
        self.client.force_authenticate(self.instructor)
        response = self.client.post(
            self.build_url,
            data=self._function_payload(function_tests=[]),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('function_tests', response.data)

    def test_student_cannot_build_test_suite(self):
        self.client.force_authenticate(self.student)
        response = self.client.post(
            self.build_url,
            data=self._function_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_builder_rejects_non_python_assignment(self):
        self.assignment.language = self.java_language
        self.assignment.save(update_fields=['language'])

        self.client.force_authenticate(self.instructor)
        response = self.client.post(
            self.build_url,
            data=self._function_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'Builder currently supports Python assignments only.')

    def test_set_active_false_keeps_existing_active_version(self):
        self.client.force_authenticate(self.instructor)
        first = self.client.post(
            self.build_url,
            data=self._function_payload(name='active-suite', set_active=True),
            format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post(
            self.build_url,
            data=self._function_payload(
                name='inactive-suite',
                set_active=False,
                function_tests=[
                    {
                        'name': 'sum-alt',
                        'function_name': 'add',
                        'args': [10, 1],
                        'expected': 11,
                        'points': 7,
                    }
                ],
            ),
            format='json',
        )
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertFalse(second.data['is_active'])

        test_suite = TestSuite.objects.get(assignment=self.assignment)
        self.assertEqual(str(test_suite.active_version_id), str(first.data['id']))
