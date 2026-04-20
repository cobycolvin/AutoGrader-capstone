import csv
import io
from collections import Counter

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from ..models import (
    Enrollment,
    EnrollmentRole,
    EnrollmentStatus,
    PendingEnrollment,
    PendingEnrollmentStatus,
    UserProfile,
)

REQUIRED_HEADERS = ['Student', 'SIS User ID', 'SIS Login ID']
OPTIONAL_HEADERS = ['Section']

ACTION_ADD_PENDING = 'ADD_PENDING_ENROLLMENT'
ACTION_REFRESH_PENDING = 'REFRESH_PENDING_ENROLLMENT'
ACTION_ENROLL = 'ENROLL_EXISTING_USER'
ACTION_REACTIVATE = 'REACTIVATE_ENROLLMENT'
ACTION_ALREADY = 'ALREADY_ENROLLED'
ACTION_CONFLICT = 'CONFLICT'
ACTION_INVALID = 'INVALID'

ACTIONABLE_ACTIONS = {
    ACTION_ADD_PENDING,
    ACTION_REFRESH_PENDING,
    ACTION_ENROLL,
    ACTION_REACTIVATE,
}


def _canonical_header(value):
    text = str(value or '').strip()
    normalized = ' '.join(text.split()).lower()
    mapping = {
        'student': 'Student',
        'sis user id': 'SIS User ID',
        'sis login id': 'SIS Login ID',
        'section': 'Section',
    }
    return mapping.get(normalized, text)


def _normalize_cell(value):
    return str(value or '').strip()


def _parse_student_name(raw_name):
    text = _normalize_cell(raw_name)
    if not text:
        return {
            'first_name': '',
            'middle_name': '',
            'last_name': '',
            'display_name': '',
            'valid': False,
            'note': 'Student name is required.',
        }

    if ',' in text:
        last_name, remainder = [part.strip() for part in text.split(',', 1)]
        pieces = remainder.split()
        first_name = pieces[0] if pieces else ''
        middle_name = ' '.join(pieces[1:]) if len(pieces) > 1 else ''
        display_name = ' '.join(part for part in [first_name, middle_name, last_name] if part)
        valid = bool(first_name and last_name)
        return {
            'first_name': first_name,
            'middle_name': middle_name,
            'last_name': last_name,
            'display_name': display_name or text,
            'valid': valid,
            'note': '' if valid else 'Student name must include first and last name.',
        }

    pieces = text.split()
    if len(pieces) < 2:
        return {
            'first_name': pieces[0] if pieces else '',
            'middle_name': '',
            'last_name': '',
            'display_name': text,
            'valid': False,
            'note': 'Student name must include first and last name.',
        }

    return {
        'first_name': pieces[0],
        'middle_name': ' '.join(pieces[1:-1]),
        'last_name': pieces[-1],
        'display_name': text,
        'valid': True,
        'note': '',
    }


def _decode_csv(uploaded_file):
    uploaded_file.seek(0)
    raw = uploaded_file.read()
    if isinstance(raw, bytes):
        return raw.decode('utf-8-sig')
    return str(raw)


def _parse_csv_rows(uploaded_file):
    content = _decode_csv(uploaded_file)
    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        raise ValueError('CSV file is missing a header row.')

    headers = [_canonical_header(header) for header in reader.fieldnames]
    missing_headers = [header for header in REQUIRED_HEADERS if header not in headers]
    if missing_headers:
        raise ValueError(f'Missing required columns: {", ".join(missing_headers)}')

    reader.fieldnames = headers
    rows = []
    for index, row in enumerate(reader, start=2):
        normalized = {key: _normalize_cell(value) for key, value in row.items()}
        if not any(normalized.values()):
            continue
        rows.append({'row_number': index, **normalized})

    return headers, rows


def _build_preview_rows(course, parsed_rows):
    cwid_counts = Counter(row.get('SIS User ID', '') for row in parsed_rows if row.get('SIS User ID'))
    username_counts = Counter(row.get('SIS Login ID', '') for row in parsed_rows if row.get('SIS Login ID'))

    cwids = [row.get('SIS User ID', '') for row in parsed_rows if row.get('SIS User ID')]
    usernames = [row.get('SIS Login ID', '') for row in parsed_rows if row.get('SIS Login ID')]

    profiles = UserProfile.objects.select_related('user').filter(cwid__in=cwids)
    profile_by_cwid = {profile.cwid: profile for profile in profiles}

    user_model = get_user_model()
    users = user_model.objects.filter(username__in=usernames)
    user_by_username = {user.username: user for user in users}

    matched_user_ids = {profile.user_id for profile in profiles} | {user.id for user in users}
    enrollments = Enrollment.objects.filter(course=course, user_id__in=matched_user_ids)
    enrollment_by_user_id = {enrollment.user_id: enrollment for enrollment in enrollments}

    pending_rows = PendingEnrollment.objects.filter(
        course=course,
        status=PendingEnrollmentStatus.PENDING,
        cwid__in=cwids,
    )
    pending_by_cwid = {pending.cwid: pending for pending in pending_rows}

    preview_rows = []
    for row in parsed_rows:
        student_name = row.get('Student', '')
        cwid = row.get('SIS User ID', '')
        username = row.get('SIS Login ID', '')
        section = row.get('Section', '')
        name_parts = _parse_student_name(student_name)

        action = None
        note = ''
        matched_user = None
        matched_by = ''
        matched_pending = None

        if not cwid or not username:
            action = ACTION_INVALID
            note = 'SIS User ID and SIS Login ID are required.'
        elif not name_parts['valid']:
            action = ACTION_INVALID
            note = name_parts['note']
        elif cwid_counts.get(cwid, 0) > 1 or username_counts.get(username, 0) > 1:
            action = ACTION_CONFLICT
            note = 'Duplicate SIS User ID or SIS Login ID found in this CSV.'
        else:
            profile_match = profile_by_cwid.get(cwid)
            username_match = user_by_username.get(username)

            if profile_match and username_match and profile_match.user_id != username_match.id:
                action = ACTION_CONFLICT
                note = 'SIS User ID and SIS Login ID match different existing accounts.'
            elif profile_match:
                matched_user = profile_match.user
                matched_by = 'CWID'
                if username_match and username_match.id == matched_user.id:
                    note = 'Matched by SIS User ID and login.'
                elif username_match is None and matched_user.username != username:
                    note = 'Matched by SIS User ID. CSV login does not match the existing username.'
                enrollment = enrollment_by_user_id.get(matched_user.id)
                if enrollment and enrollment.status == EnrollmentStatus.ACTIVE:
                    action = ACTION_ALREADY
                elif enrollment:
                    action = ACTION_REACTIVATE
                else:
                    action = ACTION_ENROLL
            elif username_match:
                matched_user = username_match
                matched_by = 'Username'
                try:
                    existing_profile = username_match.profile
                except UserProfile.DoesNotExist:
                    existing_profile = None
                if existing_profile and existing_profile.cwid and existing_profile.cwid != cwid:
                    action = ACTION_CONFLICT
                    note = 'SIS Login ID matches an account with a different CWID.'
                else:
                    note = 'Matched by SIS login.'
                    enrollment = enrollment_by_user_id.get(username_match.id)
                    if enrollment and enrollment.status == EnrollmentStatus.ACTIVE:
                        action = ACTION_ALREADY
                    elif enrollment:
                        action = ACTION_REACTIVATE
                    else:
                        action = ACTION_ENROLL
            else:
                matched_pending = pending_by_cwid.get(cwid)
                if matched_pending:
                    action = ACTION_REFRESH_PENDING
                    note = 'Pending roster entry will be refreshed until the student registers.'
                else:
                    action = ACTION_ADD_PENDING
                    note = 'Student will be added to the pending roster until they register.'

        preview_rows.append(
            {
                'row_number': row['row_number'],
                'student_name': student_name,
                'display_name': name_parts['display_name'],
                'first_name': name_parts['first_name'],
                'middle_name': name_parts['middle_name'],
                'last_name': name_parts['last_name'],
                'cwid': cwid,
                'username': username,
                'section': section,
                'action': action,
                'note': note,
                'matched_user_id': matched_user.id if matched_user else None,
                'matched_username': matched_user.username if matched_user else '',
                'matched_by': matched_by,
                'pending_entry_id': str(matched_pending.id) if matched_pending else '',
            }
        )

    return preview_rows


def _build_preview_summary(preview_rows):
    counts = Counter(row['action'] for row in preview_rows)
    return {
        'total_rows': len(preview_rows),
        'actionable_count': sum(counts[action] for action in ACTIONABLE_ACTIONS),
        'pending_count': counts[ACTION_ADD_PENDING],
        'refresh_pending_count': counts[ACTION_REFRESH_PENDING],
        'enroll_count': counts[ACTION_ENROLL],
        'reactivate_count': counts[ACTION_REACTIVATE],
        'already_enrolled_count': counts[ACTION_ALREADY],
        'conflict_count': counts[ACTION_CONFLICT],
        'invalid_count': counts[ACTION_INVALID],
    }


def preview_roster_import(course, uploaded_file):
    headers, parsed_rows = _parse_csv_rows(uploaded_file)
    preview_rows = _build_preview_rows(course, parsed_rows)
    sections = sorted({row['section'] for row in preview_rows if row['section']})
    return {
        'headers': headers,
        'sections': sections,
        'rows': preview_rows,
        'summary': _build_preview_summary(preview_rows),
    }


def _ensure_profile(user, row):
    defaults = {
        'display_name': row['display_name'],
        'first_name': row['first_name'],
        'middle_name': row['middle_name'],
        'last_name': row['last_name'],
        'cwid': row['cwid'],
    }
    profile, created = UserProfile.objects.get_or_create(user=user, defaults=defaults)
    if created:
        return profile

    updated_fields = []
    if not profile.display_name and defaults['display_name']:
        profile.display_name = defaults['display_name']
        updated_fields.append('display_name')
    if not profile.first_name and defaults['first_name']:
        profile.first_name = defaults['first_name']
        updated_fields.append('first_name')
    if not profile.middle_name and defaults['middle_name']:
        profile.middle_name = defaults['middle_name']
        updated_fields.append('middle_name')
    if not profile.last_name and defaults['last_name']:
        profile.last_name = defaults['last_name']
        updated_fields.append('last_name')
    if not profile.cwid and defaults['cwid']:
        profile.cwid = defaults['cwid']
        updated_fields.append('cwid')
    if updated_fields:
        profile.save(update_fields=updated_fields)
    return profile


def _create_or_update_enrollment(course, user, role=EnrollmentRole.STUDENT):
    enrollment, created = Enrollment.objects.get_or_create(
        course=course,
        user=user,
        defaults={
            'role': role,
            'status': EnrollmentStatus.ACTIVE,
        },
    )
    if created:
        return enrollment

    updated_fields = []
    if enrollment.status != EnrollmentStatus.ACTIVE:
        enrollment.status = EnrollmentStatus.ACTIVE
        updated_fields.append('status')
    if enrollment.role != role:
        enrollment.role = role
        updated_fields.append('role')
    if updated_fields:
        enrollment.save(update_fields=updated_fields)
    return enrollment


def claim_pending_enrollments_for_user(user, cwid=None):
    claim_cwid = _normalize_cell(cwid)
    if not claim_cwid:
        try:
            claim_cwid = _normalize_cell(user.profile.cwid)
        except UserProfile.DoesNotExist:
            claim_cwid = ''
    if not claim_cwid:
        return 0

    claimed_count = 0
    now = timezone.now()
    pending_entries = list(
        PendingEnrollment.objects.select_related('course')
        .filter(cwid=claim_cwid, status=PendingEnrollmentStatus.PENDING)
    )
    for pending in pending_entries:
        _create_or_update_enrollment(pending.course, user, role=pending.role)
        pending.status = PendingEnrollmentStatus.CLAIMED
        pending.claimed_by_user = user
        pending.claimed_at = now
        pending.save(update_fields=['status', 'claimed_by_user', 'claimed_at'])
        claimed_count += 1
    return claimed_count


def _upsert_pending_enrollment(course, actor, row):
    defaults = {
        'created_by': actor,
        'role': EnrollmentRole.STUDENT,
        'student_name': row['student_name'],
        'display_name': row['display_name'],
        'first_name': row['first_name'],
        'middle_name': row['middle_name'],
        'last_name': row['last_name'],
        'sis_login_id': row['username'],
        'section': row['section'],
        'status': PendingEnrollmentStatus.PENDING,
    }
    pending, created = PendingEnrollment.objects.get_or_create(
        course=course,
        cwid=row['cwid'],
        status=PendingEnrollmentStatus.PENDING,
        defaults=defaults,
    )
    if created:
        return pending, True

    updated_fields = []
    for field, value in defaults.items():
        if field == 'created_by':
            continue
        if getattr(pending, field) != value:
            setattr(pending, field, value)
            updated_fields.append(field)
    if updated_fields:
        pending.save(update_fields=updated_fields)
    return pending, False


def apply_roster_import(course, actor, uploaded_file):
    preview = preview_roster_import(course, uploaded_file)
    user_model = get_user_model()
    summary = {
        'pending_count': 0,
        'refresh_pending_count': 0,
        'enrolled_count': 0,
        'reactivated_count': 0,
        'already_enrolled_count': 0,
        'conflict_count': 0,
        'invalid_count': 0,
        'processed_count': 0,
    }

    with transaction.atomic():
        for row in preview['rows']:
            action = row['action']
            if action == ACTION_INVALID:
                summary['invalid_count'] += 1
                continue
            if action == ACTION_CONFLICT:
                summary['conflict_count'] += 1
                continue
            if action == ACTION_ALREADY:
                summary['already_enrolled_count'] += 1
                matched_user_id = row.get('matched_user_id')
                if matched_user_id:
                    user = user_model.objects.get(id=matched_user_id)
                    _ensure_profile(user, row)
                    claim_pending_enrollments_for_user(user, cwid=row['cwid'])
                continue

            if action in {ACTION_ADD_PENDING, ACTION_REFRESH_PENDING}:
                _upsert_pending_enrollment(course, actor, row)
                if action == ACTION_ADD_PENDING:
                    summary['pending_count'] += 1
                else:
                    summary['refresh_pending_count'] += 1
                summary['processed_count'] += 1
                continue

            user = user_model.objects.get(id=row['matched_user_id'])
            _ensure_profile(user, row)
            _create_or_update_enrollment(course, user, role=EnrollmentRole.STUDENT)
            claim_pending_enrollments_for_user(user, cwid=row['cwid'])

            if action == ACTION_REACTIVATE:
                summary['reactivated_count'] += 1
            else:
                summary['enrolled_count'] += 1
            summary['processed_count'] += 1

    return {
        'summary': summary,
        'rows': preview['rows'],
        'sections': preview['sections'],
    }
