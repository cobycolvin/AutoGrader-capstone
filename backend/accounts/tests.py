import re

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from rest_framework.test import APITestCase


class ChangePasswordApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='anjan',
            email='anjan@example.com',
            password='pass12345',
        )

    def test_change_password_requires_authentication(self):
        response = self.client.post(
            '/api/change-password/',
            {
                'current_password': 'pass12345',
                'new_password': 'newpass12345',
                'confirm_password': 'newpass12345',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 401)

    def test_change_password_rejects_wrong_current_password(self):
        self.client.force_login(self.user)

        response = self.client.post(
            '/api/change-password/',
            {
                'current_password': 'wrongpass',
                'new_password': 'newpass12345',
                'confirm_password': 'newpass12345',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['detail'], 'Current password is incorrect.')

    def test_change_password_updates_password_and_keeps_session_valid(self):
        self.client.force_login(self.user)

        response = self.client.post(
            '/api/change-password/',
            {
                'current_password': 'pass12345',
                'new_password': 'newpass12345',
                'confirm_password': 'newpass12345',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('newpass12345'))

        me_response = self.client.get('/api/me/')
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()['username'], 'anjan')


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
    FRONTEND_RESET_PASSWORD_URL='http://localhost:5173/reset-password',
)
class ForgotPasswordApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='anjan',
            email='anjan@example.com',
            password='pass12345',
        )

    def test_forgot_password_returns_generic_success_and_sends_mail(self):
        response = self.client.post(
            '/api/forgot-password/',
            {
                'email': 'anjan@example.com',
                'reset_url_base': 'http://localhost:5173/reset-password',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['ok'])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('/reset-password/', mail.outbox[0].body)

    def test_forgot_password_does_not_leak_unknown_email(self):
        response = self.client.post(
            '/api/forgot-password/',
            {
                'email': 'missing@example.com',
                'reset_url_base': 'http://localhost:5173/reset-password',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['ok'])
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_password_updates_password_from_valid_token(self):
        self.client.post(
            '/api/forgot-password/',
            {
                'email': 'anjan@example.com',
                'reset_url_base': 'http://localhost:5173/reset-password',
            },
            format='json',
        )

        body = mail.outbox[0].body
        match = re.search(r'/reset-password/([^/]+)/([^/\s]+)', body)
        self.assertIsNotNone(match)
        uid, token = match.groups()

        response = self.client.post(
            '/api/reset-password/',
            {
                'uid': uid,
                'token': token,
                'new_password': 'newpass12345',
                'confirm_password': 'newpass12345',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('newpass12345'))

    def test_reset_password_rejects_invalid_token(self):
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))
        token = default_token_generator.make_token(self.user)

        response = self.client.post(
            '/api/reset-password/',
            {
                'uid': uid,
                'token': f'{token}-bad',
                'new_password': 'newpass12345',
                'confirm_password': 'newpass12345',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['detail'], 'This password reset link is invalid or has expired.')
