import json

from django.conf import settings
from django.contrib.auth import (
    authenticate,
    get_user_model,
    login,
    logout,
    update_session_auth_hash,
)
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import csrf_exempt

from autograder.models import UserProfile
from autograder.services.roster_import import claim_pending_enrollments_for_user


@csrf_exempt
def api_login(request):
    if request.method != 'POST':
        return JsonResponse({'detail': 'Method not allowed'}, status=405)

    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        payload = {}

    username = payload.get('username')
    password = payload.get('password')

    if not username or not password:
        return JsonResponse({'detail': 'Missing username or password'}, status=400)

    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({'detail': 'Invalid credentials'}, status=401)

    login(request, user)
    return JsonResponse({'ok': True, 'username': user.username})


@csrf_exempt
def api_logout(request):
    if request.method != 'POST':
        return JsonResponse({'detail': 'Method not allowed'}, status=405)

    logout(request)
    return JsonResponse({'ok': True})


@csrf_exempt
def api_register(request):
    if request.method != 'POST':
        return JsonResponse({'detail': 'Method not allowed'}, status=405)

    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        payload = {}

    username = (payload.get('username') or '').strip()
    email = (payload.get('email') or '').strip()
    password = payload.get('password') or ''
    first_name = (payload.get('first_name') or '').strip()
    middle_name = (payload.get('middle_name') or '').strip()
    last_name = (payload.get('last_name') or '').strip()
    cwid = (payload.get('cwid') or '').strip()

    if not username or not password or not email:
        return JsonResponse({'detail': 'Username, email, and password are required.'}, status=400)

    if not first_name or not last_name or not cwid:
        return JsonResponse(
            {'detail': 'First name, last name, and CWID are required.'},
            status=400,
        )

    user_model = get_user_model()

    if user_model.objects.filter(username=username).exists():
        return JsonResponse({'detail': 'Username already exists.'}, status=400)

    if user_model.objects.filter(email=email).exists():
        return JsonResponse({'detail': 'Email already exists.'}, status=400)

    if UserProfile.objects.filter(cwid=cwid).exists():
        return JsonResponse({'detail': 'CWID already exists.'}, status=400)

    try:
        with transaction.atomic():
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
            claim_pending_enrollments_for_user(user, cwid=cwid)
    except IntegrityError:
        return JsonResponse({'detail': 'Unable to create user.'}, status=400)

    login(request, user)
    return JsonResponse({'ok': True, 'username': user.username})


def api_me(request):
    if not request.user.is_authenticated:
        return JsonResponse({'authenticated': False}, status=401)

    return JsonResponse({
        'authenticated': True,
        'id': request.user.id,
        'username': request.user.username,
        'email': request.user.email,
        'is_superuser': request.user.is_superuser,
        'is_staff': request.user.is_staff,
        'is_instructor': request.user.groups.filter(name='Instructor').exists(),
        'is_ta': request.user.groups.filter(name='TA').exists(),
        'is_grader': request.user.groups.filter(name='Grader').exists(),
    })


def api_change_password(request):
    if request.method != 'POST':
        return JsonResponse({'detail': 'Method not allowed'}, status=405)

    if not request.user.is_authenticated:
        return JsonResponse({'detail': 'Authentication required.'}, status=401)

    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        payload = {}

    current_password = payload.get('current_password') or ''
    new_password = payload.get('new_password') or ''
    confirm_password = payload.get('confirm_password') or ''

    if not current_password or not new_password or not confirm_password:
        return JsonResponse(
            {'detail': 'Current password, new password, and confirmation are required.'},
            status=400,
        )

    if not request.user.check_password(current_password):
        return JsonResponse({'detail': 'Current password is incorrect.'}, status=400)

    if new_password != confirm_password:
        return JsonResponse({'detail': 'New password and confirmation must match.'}, status=400)

    if current_password == new_password:
        return JsonResponse({'detail': 'Choose a new password different from the current password.'}, status=400)

    try:
        validate_password(new_password, user=request.user)
    except ValidationError as exc:
        return JsonResponse({'detail': ' '.join(exc.messages)}, status=400)

    request.user.set_password(new_password)
    request.user.save(update_fields=['password'])
    update_session_auth_hash(request, request.user)
    return JsonResponse({'ok': True})


@csrf_exempt
def api_forgot_password(request):
    if request.method != 'POST':
        return JsonResponse({'detail': 'Method not allowed'}, status=405)

    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        payload = {}

    email = (payload.get('email') or '').strip()
    reset_url_base = (payload.get('reset_url_base') or '').strip()

    if not email:
        return JsonResponse({'detail': 'Email is required.'}, status=400)

    generic_response = JsonResponse({
        'ok': True,
        'detail': 'If an account exists for that email, a password reset link has been sent.',
    })

    user = get_user_model().objects.filter(email__iexact=email).first()
    if not user:
        return generic_response

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    base_url = reset_url_base or settings.FRONTEND_RESET_PASSWORD_URL
    reset_url = f'{base_url.rstrip("/")}/{uid}/{token}'

    send_mail(
        subject='Reset your Gradeforge password',
        message=(
            'Use the link below to reset your password:\n\n'
            f'{reset_url}\n\n'
            'If you did not request this reset, you can ignore this email.'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )

    return generic_response


@csrf_exempt
def api_reset_password(request):
    if request.method != 'POST':
        return JsonResponse({'detail': 'Method not allowed'}, status=405)

    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except json.JSONDecodeError:
        payload = {}

    uid = payload.get('uid') or ''
    token = payload.get('token') or ''
    new_password = payload.get('new_password') or ''
    confirm_password = payload.get('confirm_password') or ''

    if not uid or not token or not new_password or not confirm_password:
        return JsonResponse(
            {'detail': 'Reset link, new password, and confirmation are required.'},
            status=400,
        )

    if new_password != confirm_password:
        return JsonResponse({'detail': 'New password and confirmation must match.'}, status=400)

    try:
        user_id = force_str(urlsafe_base64_decode(uid))
        user = get_user_model().objects.filter(pk=user_id).first()
    except (TypeError, ValueError, OverflowError):
        user = None

    if not user or not default_token_generator.check_token(user, token):
        return JsonResponse({'detail': 'This password reset link is invalid or has expired.'}, status=400)

    try:
        validate_password(new_password, user=user)
    except ValidationError as exc:
        return JsonResponse({'detail': ' '.join(exc.messages)}, status=400)

    user.set_password(new_password)
    user.save(update_fields=['password'])
    return JsonResponse({'ok': True})


def api_csrf(request):
    return JsonResponse({'csrfToken': get_token(request)})
