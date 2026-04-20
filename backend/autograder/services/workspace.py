import io
import os
import uuid
import zipfile

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from rest_framework.exceptions import ValidationError


DEFAULT_WORKSPACE_TEXT_BYTES = 1024 * 1024
MAX_WORKSPACE_FILES = 300


def _language_family(language):
    lowered = f'{getattr(language, "name", "")} {getattr(language, "slug", "")}'.lower()
    if 'python' in lowered:
        return 'python'
    if 'java' in lowered:
        return 'java'
    return ''


def _normalized_allowed_extensions(assignment):
    normalized = []
    for item in assignment.submission_file_types or []:
        value = str(item or '').strip().lower()
        if not value:
            continue
        normalized.append(value if value.startswith('.') else f'.{value}')
    return normalized


def normalize_workspace_path(path):
    normalized = str(path or '').replace('\\', '/').strip()
    if not normalized or normalized.startswith('/'):
        return ''
    parts = [part for part in normalized.split('/') if part not in {'', '.'}]
    if not parts or any(part == '..' for part in parts):
        return ''
    return '/'.join(parts)


def default_workspace_files(assignment):
    family = _language_family(getattr(assignment, 'language', None))
    allowed_extensions = _normalized_allowed_extensions(assignment)
    if allowed_extensions:
        if family == 'python' and '.py' not in allowed_extensions:
            return [{'path': f'submission{allowed_extensions[0]}', 'content': ''}]
        if family == 'java' and '.java' not in allowed_extensions:
            return [{'path': f'submission{allowed_extensions[0]}', 'content': ''}]
        if family not in {'python', 'java'}:
            return [{'path': f'submission{allowed_extensions[0]}', 'content': ''}]

    if family == 'python':
        return [
            {
                'path': 'main.py',
                'content': 'def main():\n    print("Hello, world!")\n\n\nif __name__ == "__main__":\n    main()\n',
            }
        ]
    if family == 'java':
        return [
            {
                'path': 'Main.java',
                'content': 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, world!");\n    }\n}\n',
            }
        ]
    return [{'path': 'main.txt', 'content': ''}]


def validate_workspace_files(files, assignment):
    entries = list(files or [])
    if not entries:
        raise ValidationError({'files': 'At least one file is required.'})
    if len(entries) > MAX_WORKSPACE_FILES:
        raise ValidationError({'files': f'Too many files. Limit is {MAX_WORKSPACE_FILES}.'})

    normalized_allowed_types = _normalized_allowed_extensions(assignment)
    max_bytes = (assignment.submission_max_size_mb or 0) * 1024 * 1024
    seen_paths = set()
    total_bytes = 0
    normalized_files = []

    for entry in entries:
        raw_path = entry.get('path') if isinstance(entry, dict) else ''
        path = normalize_workspace_path(raw_path)
        if not path:
            raise ValidationError({'files': 'Each file path must be a safe relative path.'})
        if path in seen_paths:
            raise ValidationError({'files': f'Duplicate file path: {path}'})
        seen_paths.add(path)

        content = entry.get('content') if isinstance(entry, dict) else ''
        if content is None:
            content = ''
        content = str(content)
        content_bytes = content.encode('utf-8')
        total_bytes += len(content_bytes)

        if normalized_allowed_types:
            ext = os.path.splitext(path)[1].lower()
            if not ext or ext not in normalized_allowed_types:
                raise ValidationError({'files': f'File type {ext or "(none)"} is not allowed.'})

        normalized_files.append(
            {
                'path': path,
                'content': content,
                'size': len(content_bytes),
            }
        )

    if max_bytes and total_bytes > max_bytes:
        raise ValidationError({'files': f'Files exceed {assignment.submission_max_size_mb} MB limit.'})

    return normalized_files


def build_workspace_manifest(files):
    return [
        {
            'path': entry['path'],
            'size': entry.get('size', len((entry.get('content') or '').encode('utf-8'))),
        }
        for entry in files
    ]


def build_workspace_bundle_bytes(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
        for entry in sorted(files, key=lambda item: item['path']):
            zip_ref.writestr(entry['path'], (entry.get('content') or '').encode('utf-8'))
    return buffer.getvalue()


def load_workspace_files_from_bundle(bundle_key, storage=None):
    if not bundle_key:
        return []
    storage = storage or FileSystemStorage(location=settings.MEDIA_ROOT)
    source_path = storage.path(bundle_key)
    if not os.path.exists(source_path) or not zipfile.is_zipfile(source_path):
        return []

    files = []
    with zipfile.ZipFile(source_path, 'r') as zip_ref:
        for info in sorted(zip_ref.infolist(), key=lambda item: item.filename):
            if info.is_dir():
                continue
            path = normalize_workspace_path(info.filename)
            if not path:
                continue
            raw_content = zip_ref.read(info.filename)
            files.append(
                {
                    'path': path,
                    'content': raw_content.decode('utf-8', errors='replace'),
                    'size': len(raw_content),
                }
            )
    return files


def save_workspace_draft(draft, assignment, files, storage=None):
    storage = storage or FileSystemStorage(location=settings.MEDIA_ROOT)
    normalized_files = validate_workspace_files(files, assignment)
    bundle_bytes = build_workspace_bundle_bytes(normalized_files)
    owner_segment = f'groups/{draft.group_id}' if draft.group_id else str(draft.user_id)
    draft_path = os.path.join('drafts', str(assignment.id), owner_segment, f'{uuid.uuid4().hex}.zip')
    stored_key = storage.save(draft_path, ContentFile(bundle_bytes, name='draft.zip'))
    previous_key = draft.source_bundle_key
    draft.source_bundle_key = stored_key
    draft.manifest_json = build_workspace_manifest(normalized_files)
    draft.revision = (draft.revision or 0) + 1
    draft.save(update_fields=['source_bundle_key', 'manifest_json', 'revision', 'updated_at'])
    if previous_key and previous_key != stored_key:
        storage.delete(previous_key)
    return draft, normalized_files


def load_workspace_draft_files(draft, assignment, storage=None):
    files = load_workspace_files_from_bundle(draft.source_bundle_key, storage=storage)
    if files:
        return files
    return default_workspace_files(assignment)
