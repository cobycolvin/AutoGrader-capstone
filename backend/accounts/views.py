import json

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db import IntegrityError
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_exempt

from autograder.models import UserProfile


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
    })


def api_csrf(request):
    return JsonResponse({'csrfToken': get_token(request)})
