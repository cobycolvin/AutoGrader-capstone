from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from autograder.models import UserProfile


class AccountsAuthApiTests(APITestCase):
    register_url = '/api/register/'
    login_url = '/api/login/'
    logout_url = '/api/logout/'
    me_url = '/api/me/'

    def _register_payload(self, **overrides):
        payload = {
            'username': 'student1',
            'email': 'student1@example.com',
            'password': 'test-pass-123',
            'first_name': 'Jane',
            'middle_name': 'Q',
            'last_name': 'Student',
            'cwid': 'CWID1001',
        }
        payload.update(overrides)
        return payload

    def test_register_requires_profile_fields(self):
        response = self.client.post(
            self.register_url,
            data=self._register_payload(cwid=''),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'First name, last name, and CWID are required.')

    def test_register_creates_user_and_profile(self):
        payload = self._register_payload()
        response = self.client.post(self.register_url, data=payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['ok'])
        self.assertEqual(response.data['username'], payload['username'])

        user_model = get_user_model()
        user = user_model.objects.get(username=payload['username'])
        profile = UserProfile.objects.get(user=user)
        self.assertEqual(profile.cwid, payload['cwid'])
        self.assertEqual(profile.first_name, payload['first_name'])
        self.assertEqual(profile.last_name, payload['last_name'])

    def test_register_rejects_duplicate_username(self):
        first_payload = self._register_payload()
        second_payload = self._register_payload(
            email='student2@example.com',
            cwid='CWID1002',
        )

        first = self.client.post(self.register_url, data=first_payload, format='json')
        self.assertEqual(first.status_code, status.HTTP_200_OK)

        second = self.client.post(self.register_url, data=second_payload, format='json')
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(second.data['detail'], 'Username already exists.')

    def test_login_and_me_flow(self):
        payload = self._register_payload(
            username='student3',
            email='student3@example.com',
            cwid='CWID1003',
        )
        register = self.client.post(self.register_url, data=payload, format='json')
        self.assertEqual(register.status_code, status.HTTP_200_OK)

        logout = self.client.post(self.logout_url)
        self.assertEqual(logout.status_code, status.HTTP_200_OK)

        bad_login = self.client.post(
            self.login_url,
            data={'username': payload['username'], 'password': 'wrong-pass'},
            format='json',
        )
        self.assertEqual(bad_login.status_code, status.HTTP_401_UNAUTHORIZED)

        login = self.client.post(
            self.login_url,
            data={'username': payload['username'], 'password': payload['password']},
            format='json',
        )
        self.assertEqual(login.status_code, status.HTTP_200_OK)

        me = self.client.get(self.me_url)
        self.assertEqual(me.status_code, status.HTTP_200_OK)
        self.assertTrue(me.data['authenticated'])
        self.assertEqual(me.data['username'], payload['username'])

    def test_logout_requires_post(self):
        response = self.client.get(self.logout_url)

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(response.data['detail'], 'Method not allowed')
