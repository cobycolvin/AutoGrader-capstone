import hashlib
import io
import keyword
import os
import re
import tokenize
import zipfile
from itertools import combinations
from decimal import Decimal

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils import timezone

from ..models import IntegrityFinding, IntegrityScanStatus, Submission

PYTHON_SOURCE_EXTENSIONS = {'.py'}
JAVA_SOURCE_EXTENSIONS = {'.java'}
GENERIC_SOURCE_EXTENSIONS = {
    '.py',
    '.java',
    '.c',
    '.cc',
    '.cpp',
    '.cs',
    '.go',
    '.h',
    '.hpp',
    '.js',
    '.jsx',
    '.kt',
    '.m',
    '.php',
    '.rb',
    '.rs',
    '.scala',
    '.swift',
    '.ts',
    '.tsx',
}
JAVA_KEYWORDS = {
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
    'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
    'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
    'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
    'package', 'private', 'protected', 'public', 'return', 'short', 'static',
    'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
    'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null',
    'record', 'sealed', 'permits', 'var',
}
GENERIC_KEYWORDS = JAVA_KEYWORDS.union(
    {
        'auto', 'await', 'def', 'elif', 'endif', 'except', 'export', 'extern',
        'fn', 'from', 'function', 'if', 'lambda', 'let', 'mut', 'namespace',
        'pragma', 'struct', 'template', 'trait', 'type', 'typedef', 'union',
        'use', 'using', 'where', 'yield',
    }
)
STRING_LITERAL_RE = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', re.S)
BLOCK_COMMENT_RE = re.compile(r'/\*.*?\*/', re.S)
LINE_COMMENT_RE = re.compile(r'//.*?$', re.M)
GENERIC_TOKEN_RE = re.compile(
    r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[A-Za-z_]\w*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||::|->|[{}()\[\];,.:+\-*/%<>=!&|^~?]'
)


def run_assignment_plagiarism_scan(scan):
    assignment = scan.assignment
    latest_only = bool(scan.config_json.get('latest_only', True))
    threshold = float(scan.config_json.get('threshold', 35))
    excluded_paths = list(scan.config_json.get('excluded_paths') or [])
    language_family = _language_family(getattr(getattr(assignment, 'language', None), 'name', ''))

    try:
        IntegrityFinding.objects.filter(scan=scan).delete()
        submissions = _load_candidate_submissions(assignment, latest_only=latest_only)
        documents = [
            _build_submission_document(submission, language_family, excluded_paths=excluded_paths)
            for submission in submissions
        ]
        documents = [document for document in documents if document['fingerprints']]

        findings = []
        for left, right in combinations(documents, 2):
            if left['owner_key'] == right['owner_key']:
                continue
            comparison = _compare_documents(left, right)
            if not comparison or comparison['score'] < threshold:
                continue
            findings.append(
                IntegrityFinding(
                    scan=scan,
                    submission=left['submission'],
                    matched_submission=right['submission'],
                    score=Decimal(f"{comparison['score']:.3f}"),
                    details_json=comparison['details'],
                    created_by=scan.created_by,
                )
            )

        if findings:
            IntegrityFinding.objects.bulk_create(findings)

        scan.status = IntegrityScanStatus.DONE
        scan.error_message = ''
        scan.completed_at = timezone.now()
        scan.save(update_fields=['status', 'error_message', 'completed_at', 'updated_at'])
        return scan
    except Exception as exc:
        scan.status = IntegrityScanStatus.FAILED
        scan.error_message = str(exc)
        scan.completed_at = timezone.now()
        scan.save(update_fields=['status', 'error_message', 'completed_at', 'updated_at'])
        raise


def _language_family(language_name):
    lowered = str(language_name or '').lower()
    if 'python' in lowered:
        return 'python'
    if 'java' in lowered:
        return 'java'
    return 'generic'


def _load_candidate_submissions(assignment, *, latest_only):
    queryset = (
        Submission.objects.filter(assignment=assignment)
        .select_related('submitted_by', 'group')
        .prefetch_related('group__groupmember_set__user')
        .order_by('-submitted_at', '-created_at')
    )
    submissions = list(queryset)
    if not latest_only:
        return submissions

    latest_by_owner = {}
    for submission in submissions:
        owner_key = _owner_key(submission)
        if owner_key not in latest_by_owner:
            latest_by_owner[owner_key] = submission
    return list(latest_by_owner.values())


def _owner_key(submission):
    if submission.group_id:
        return ('group', str(submission.group_id))
    return ('user', str(submission.submitted_by_id))


def _owner_label(submission):
    if submission.group_id:
        return submission.group.name
    return submission.submitted_by.username


def _owner_members(submission):
    if submission.group_id:
        return sorted(
            member.user.username
            for member in submission.group.groupmember_set.all()
            if getattr(member, 'user', None) is not None
        )
    return [submission.submitted_by.username]


def _build_submission_document(submission, language_family, *, excluded_paths=None):
    files = _load_submission_sources(submission, language_family, excluded_paths=excluded_paths)
    all_fingerprints = set()
    file_entries = []

    for path, source in files:
        tokens = _tokenize_source(source, language_family)
        fingerprint_data = _fingerprint_tokens(tokens)
        fingerprints = fingerprint_data['fingerprints']
        if not fingerprints:
            continue
        all_fingerprints.update(fingerprints)
        file_entries.append(
            {
                'path': path,
                'token_count': len(tokens),
                'fingerprints': fingerprints,
                'fingerprint_locations': fingerprint_data['locations'],
            }
        )

    return {
        'submission': submission,
        'owner_key': _owner_key(submission),
        'owner_label': _owner_label(submission),
        'owner_type': 'GROUP' if submission.group_id else 'USER',
        'owner_members': _owner_members(submission),
        'fingerprints': all_fingerprints,
        'files': file_entries,
    }


def _load_submission_sources(submission, language_family, *, excluded_paths=None):
    extensions = _extensions_for_language(language_family)
    excluded_matchers = _build_excluded_path_matchers(excluded_paths)
    storage = FileSystemStorage(location=settings.MEDIA_ROOT)

    try:
        source_path = storage.path(submission.source_bundle_key)
    except Exception:
        return []
    if not zipfile.is_zipfile(source_path):
        return []

    files = []
    with zipfile.ZipFile(source_path, 'r') as zip_ref:
        for member in zip_ref.infolist():
            if member.is_dir():
                continue
            name = member.filename.replace('\\', '/')
            if _is_excluded_source_path(name, excluded_matchers):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in extensions:
                continue
            raw = zip_ref.read(member)
            text = raw.decode('utf-8', errors='replace')
            if not text.strip():
                continue
            files.append((name, text))
    return files


def _build_excluded_path_matchers(paths):
    normalized = set()
    basenames = set()
    for path in paths or []:
        item = str(path or '').replace('\\', '/').strip().lstrip('./')
        if not item:
            continue
        lowered = item.lower()
        normalized.add(lowered)
        basenames.add(os.path.basename(lowered))
    return {'paths': normalized, 'basenames': basenames}


def _is_excluded_source_path(path, matchers):
    if not matchers:
        return False
    lowered = str(path or '').replace('\\', '/').strip().lstrip('./').lower()
    if not lowered:
        return False
    if lowered in matchers.get('paths', set()):
        return True
    return os.path.basename(lowered) in matchers.get('basenames', set())


def _extensions_for_language(language_family):
    if language_family == 'python':
        return PYTHON_SOURCE_EXTENSIONS
    if language_family == 'java':
        return JAVA_SOURCE_EXTENSIONS
    return GENERIC_SOURCE_EXTENSIONS


def _tokenize_source(source, language_family):
    if language_family == 'python':
        return _tokenize_python(source)
    return _tokenize_generic(source, language_family)


def _tokenize_python(source):
    tokens = []
    reader = io.StringIO(source).readline
    try:
        stream = tokenize.generate_tokens(reader)
        for token_info in stream:
            token_type = token_info.type
            token_value = token_info.string
            if token_type in {
                tokenize.COMMENT,
                tokenize.NL,
                tokenize.NEWLINE,
                tokenize.ENCODING,
                tokenize.INDENT,
                tokenize.DEDENT,
                tokenize.ENDMARKER,
            }:
                continue
            if token_type == tokenize.NAME:
                tokens.append(
                    {
                        'value': token_value if keyword.iskeyword(token_value) else 'ID',
                        'line': token_info.start[0],
                    }
                )
            elif token_type == tokenize.NUMBER:
                tokens.append({'value': 'NUM', 'line': token_info.start[0]})
            elif token_type == tokenize.STRING:
                tokens.append({'value': 'STR', 'line': token_info.start[0]})
            else:
                tokens.append({'value': token_value, 'line': token_info.start[0]})
    except tokenize.TokenError:
        return _tokenize_generic(source, 'generic')
    return tokens


def _tokenize_generic(source, language_family):
    stripped = BLOCK_COMMENT_RE.sub(' ', source)
    stripped = LINE_COMMENT_RE.sub(' ', stripped)
    tokens = []
    keywords = JAVA_KEYWORDS if language_family == 'java' else GENERIC_KEYWORDS
    line_breaks = [0]
    for index, char in enumerate(stripped):
        if char == '\n':
            line_breaks.append(index + 1)
    for match in GENERIC_TOKEN_RE.finditer(stripped):
        token_value = match.group(0)
        line_number = 1
        for idx, start in enumerate(line_breaks):
            if start > match.start():
                break
            line_number = idx + 1
        if token_value[0] in {'"', "'"}:
            tokens.append({'value': 'STR', 'line': line_number})
            continue
        if token_value[0].isdigit():
            tokens.append({'value': 'NUM', 'line': line_number})
            continue
        if re.fullmatch(r'[A-Za-z_]\w*', token_value):
            tokens.append(
                {
                    'value': token_value if token_value in keywords else 'ID',
                    'line': line_number,
                }
            )
            continue
        tokens.append({'value': token_value, 'line': line_number})
    return tokens


def _fingerprint_tokens(tokens, k_gram=8, window_size=5):
    if not tokens:
        return {'fingerprints': set(), 'locations': {}}
    token_values = [token['value'] for token in tokens]
    if len(tokens) < k_gram:
        only_hash = _stable_hash(' '.join(token_values))
        return {
            'fingerprints': {only_hash},
            'locations': {
                only_hash: [
                    {
                        'start_line': tokens[0]['line'],
                        'end_line': tokens[-1]['line'],
                    }
                ]
            },
        }

    hashes = []
    locations = []
    for index in range(len(tokens) - k_gram + 1):
        token_slice = token_values[index:index + k_gram]
        hashes.append(_stable_hash(' '.join(token_slice)))
        locations.append(
            {
                'start_line': tokens[index]['line'],
                'end_line': tokens[index + k_gram - 1]['line'],
            }
        )
    if len(hashes) <= window_size:
        selected_hash = min(hashes)
        selected_index = max(idx for idx, value in enumerate(hashes) if value == selected_hash)
        return {
            'fingerprints': {selected_hash},
            'locations': {selected_hash: [locations[selected_index]]},
        }

    fingerprints = set()
    fingerprint_locations = {}
    last_position = None
    for start in range(len(hashes) - window_size + 1):
        window = hashes[start:start + window_size]
        min_hash = min(window)
        offset = max(idx for idx, value in enumerate(window) if value == min_hash)
        position = start + offset
        if position == last_position:
            continue
        fingerprints.add(hashes[position])
        fingerprint_locations.setdefault(hashes[position], []).append(locations[position])
        last_position = position
    return {'fingerprints': fingerprints, 'locations': fingerprint_locations}


def _stable_hash(value):
    return int(hashlib.sha1(value.encode('utf-8')).hexdigest()[:16], 16)


def _compare_documents(left, right):
    left_fingerprints = left['fingerprints']
    right_fingerprints = right['fingerprints']
    if not left_fingerprints or not right_fingerprints:
        return None

    matched = left_fingerprints & right_fingerprints
    if not matched:
        return None

    score = _similarity_score(left_fingerprints, right_fingerprints)
    matched_files = []
    for left_file in left['files']:
        for right_file in right['files']:
            file_overlap = left_file['fingerprints'] & right_file['fingerprints']
            if not file_overlap:
                continue
            file_score = _similarity_score(left_file['fingerprints'], right_file['fingerprints'])
            matched_regions = []
            for hash_value in list(sorted(file_overlap))[:6]:
                left_locations = left_file.get('fingerprint_locations', {}).get(hash_value, [])
                right_locations = right_file.get('fingerprint_locations', {}).get(hash_value, [])
                if not left_locations or not right_locations:
                    continue
                matched_regions.append(
                    {
                        'left_start_line': left_locations[0]['start_line'],
                        'left_end_line': left_locations[0]['end_line'],
                        'right_start_line': right_locations[0]['start_line'],
                        'right_end_line': right_locations[0]['end_line'],
                    }
                )
            matched_files.append(
                {
                    'left_path': left_file['path'],
                    'right_path': right_file['path'],
                    'score': round(file_score, 2),
                    'matched_fingerprints': len(file_overlap),
                    'left_token_count': left_file['token_count'],
                    'right_token_count': right_file['token_count'],
                    'matched_regions': matched_regions,
                }
            )

    matched_files.sort(key=lambda entry: (-entry['score'], entry['left_path'], entry['right_path']))
    details = {
        'left_owner_label': left['owner_label'],
        'right_owner_label': right['owner_label'],
        'left_owner_type': left['owner_type'],
        'right_owner_type': right['owner_type'],
        'left_owner_members': left['owner_members'],
        'right_owner_members': right['owner_members'],
        'matched_fingerprints': len(matched),
        'left_fingerprint_count': len(left_fingerprints),
        'right_fingerprint_count': len(right_fingerprints),
        'matched_files': matched_files[:8],
    }
    return {
        'score': round(score, 3),
        'details': details,
    }


def _similarity_score(left_hashes, right_hashes):
    if not left_hashes or not right_hashes:
        return 0.0
    overlap = len(left_hashes & right_hashes)
    return (2.0 * overlap / (len(left_hashes) + len(right_hashes))) * 100.0
