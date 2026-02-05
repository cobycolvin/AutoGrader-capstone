import json

from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_exempt


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


def api_me(request):
    if not request.user.is_authenticated:
        return JsonResponse({'authenticated': False}, status=401)

    return JsonResponse({
        'authenticated': True,
        'username': request.user.username,
        'email': request.user.email,
    })


def api_csrf(request):
    return JsonResponse({'csrfToken': get_token(request)})
