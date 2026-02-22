import hashlib
import os
import zipfile

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.db.models import Max

from ..models import TestSuite, TestSuiteVersion
from .test_suite_builder import build_assignment_suite_bundle


def list_test_suite_versions(assignment, visibility=None):
    test_suite = TestSuite.objects.filter(assignment=assignment).select_related('active_version').first()
    qs = TestSuiteVersion.objects.filter(test_suite__assignment=assignment).select_related('test_suite')
    if visibility:
        qs = qs.filter(visibility=visibility)
    return qs.order_by('-created_at'), (test_suite.active_version_id if test_suite else None)


def upload_test_suite_bundle(assignment, upload, visibility):
    test_suite, _ = TestSuite.objects.get_or_create(assignment=assignment)
    current_version = (
        TestSuiteVersion.objects.filter(test_suite=test_suite, visibility=visibility)
        .aggregate(max_version=Max('version_number'))
        .get('max_version')
        or 0
    )
    next_version = current_version + 1

    hasher = hashlib.sha256()
    for chunk in upload.chunks():
        hasher.update(chunk)
    checksum = hasher.hexdigest()
    if hasattr(upload, 'seek'):
        upload.seek(0)

    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    filename = f'v{next_version}_{upload.name}'
    path = os.path.join('test_suites', str(assignment.id), visibility.lower(), filename)
    stored_path = storage.save(path, upload)

    version = TestSuiteVersion.objects.create(
        test_suite=test_suite,
        version_number=next_version,
        visibility=visibility,
        bundle_key=stored_path,
        checksum=checksum,
    )
    test_suite.active_version = version
    test_suite.save(update_fields=['active_version'])
    return version, test_suite


def activate_test_suite_version(assignment, version_id):
    version = TestSuiteVersion.objects.filter(id=version_id, test_suite__assignment=assignment).first()
    if not version:
        return None, None
    test_suite = version.test_suite
    test_suite.active_version = version
    test_suite.save(update_fields=['active_version'])
    return version, test_suite


def build_test_suite_from_builder(assignment, payload):
    bundle_bytes, safe_name = build_assignment_suite_bundle(payload)
    checksum = hashlib.sha256(bundle_bytes).hexdigest()

    visibility = payload.get('visibility')
    set_active = payload.get('set_active', True)

    test_suite, _ = TestSuite.objects.get_or_create(assignment=assignment)
    current_version = (
        TestSuiteVersion.objects.filter(test_suite=test_suite, visibility=visibility)
        .aggregate(max_version=Max('version_number'))
        .get('max_version')
        or 0
    )
    next_version = current_version + 1

    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    filename = f'v{next_version}_{safe_name}.zip'
    path = os.path.join('test_suites', str(assignment.id), visibility.lower(), filename)
    stored_path = storage.save(path, ContentFile(bundle_bytes))

    version = TestSuiteVersion.objects.create(
        test_suite=test_suite,
        version_number=next_version,
        visibility=visibility,
        bundle_key=stored_path,
        checksum=checksum,
    )
    if set_active or not test_suite.active_version_id:
        test_suite.active_version = version
        test_suite.save(update_fields=['active_version'])
    return version, test_suite


def read_test_suite_manifest(bundle_key, max_files=300):
    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    try:
        file_path = storage.path(bundle_key)
    except Exception:
        return None, 'Unable to locate test suite.', 404

    if not os.path.exists(file_path):
        return None, 'Test suite file missing.', 404

    files = []
    total_size = 0
    try:
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            for info in zip_ref.infolist():
                is_dir = info.is_dir()
                files.append(
                    {
                        'name': info.filename,
                        'size': info.file_size,
                        'compressed_size': info.compress_size,
                        'is_dir': is_dir,
                    }
                )
                if not is_dir:
                    total_size += info.file_size
    except zipfile.BadZipFile:
        return None, 'Invalid zip file.', 400

    return (
        {
            'file_count': len(files),
            'total_size': total_size,
            'files': files[:max_files],
        },
        None,
        None,
    )
