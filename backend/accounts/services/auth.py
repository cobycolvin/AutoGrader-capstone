import json

from django.contrib.auth import get_user_model
from django.db import IntegrityError

from autograder.models import UserProfile


def parse_json_body(request):
    try:
        return json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        return {}


def check_registration_conflicts(username, email, cwid):
    user_model = get_user_model()

    if user_model.objects.filter(username=username).exists():
        return 'Username already exists.'

    if user_model.objects.filter(email=email).exists():
        return 'Email already exists.'

    if UserProfile.objects.filter(cwid=cwid).exists():
        return 'CWID already exists.'

    return None


def create_user_with_profile(username, email, password, first_name, middle_name, last_name, cwid):
    user_model = get_user_model()

    try:
        user = user_model.objects.create_user(
            username=username,
            email=email,
            password=password,
            first_name=first_name,
            last_name=last_name,
        )
        display_name = f'{first_name} {last_name}'.strip()
        UserProfile.objects.create(
            user=user,
            display_name=display_name,
            first_name=first_name,
            middle_name=middle_name,
            last_name=last_name,
            cwid=cwid,
        )
        return user, None
    except IntegrityError:
        return None, 'Unable to create user.'


def build_me_payload(user):
    return {
        'authenticated': True,
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'is_superuser': user.is_superuser,
        'is_staff': user.is_staff,
        'is_instructor': user.groups.filter(name='Instructor').exists(),
    }
