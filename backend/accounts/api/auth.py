from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_exempt

from ..services.auth import (
    build_me_payload,
    check_registration_conflicts,
    create_user_with_profile,
    parse_json_body,
)


@csrf_exempt
def api_login(request):
    if request.method != 'POST':
        return JsonResponse({'detail': 'Method not allowed'}, status=405)

    payload = parse_json_body(request)
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

    payload = parse_json_body(request)

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

    conflict_error = check_registration_conflicts(username=username, email=email, cwid=cwid)
    if conflict_error:
        return JsonResponse({'detail': conflict_error}, status=400)

    user, create_error = create_user_with_profile(
        username=username,
        email=email,
        password=password,
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        cwid=cwid,
    )
    if create_error:
        return JsonResponse({'detail': create_error}, status=400)

    login(request, user)
    return JsonResponse({'ok': True, 'username': user.username})


def api_me(request):
    if not request.user.is_authenticated:
        return JsonResponse({'authenticated': False}, status=401)

    return JsonResponse(build_me_payload(request.user))


def api_csrf(request):
    return JsonResponse({'csrfToken': get_token(request)})
