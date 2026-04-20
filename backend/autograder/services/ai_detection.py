import io
import logging
import os
import pickle
import sys
import zipfile
from pathlib import Path
from typing import Optional

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils import timezone

from ..models import AIDetectionFinding, AIDetectionScan, AIDetectionStatus, AIDetectionVerdict

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {'.py': 'python', '.java': 'java'}

VERDICT_THRESHOLDS = {
    AIDetectionVerdict.CONFIRMED_AI: 0.75,
    AIDetectionVerdict.LIKELY_AI: 0.45,
}

# Minimum confidence for a code block to be reported as a finding
FINDING_THRESHOLD = 0.55

# Sliding window for span detection (lines per block)
BLOCK_SIZE = 15
BLOCK_STEP = 8


def get_ai_detection_ml_dir() -> Path:
    return Path(getattr(settings, 'AI_DETECTION_ML_DIR')).resolve()


def get_ai_detection_model_dir() -> Path:
    return Path(getattr(settings, 'AI_DETECTION_MODEL_DIR')).resolve()


def get_ai_detection_required_models() -> tuple[str, ...]:
    return tuple(
        str(language).strip().lower()
        for language in getattr(settings, 'AI_DETECTION_REQUIRED_MODELS', ())
        if str(language).strip()
    )


def get_ai_detection_feature_extractor_path() -> Path:
    return get_ai_detection_ml_dir() / 'features' / 'extractor.py'


def get_ai_detection_model_path(lang: str) -> Path:
    return get_ai_detection_model_dir() / f'model_{lang}.pkl'


def get_ai_detection_asset_issues() -> list[str]:
    issues = []
    ml_dir = get_ai_detection_ml_dir()
    model_dir = get_ai_detection_model_dir()
    extractor_path = get_ai_detection_feature_extractor_path()

    if not ml_dir.exists():
        issues.append(f'AI detection ML directory is missing: {ml_dir}')
    if not extractor_path.exists():
        issues.append(f'AI detection feature extractor is missing: {extractor_path}')
    if not model_dir.exists():
        issues.append(f'AI detection model directory is missing: {model_dir}')

    for language in get_ai_detection_required_models():
        artifact_path = get_ai_detection_model_path(language)
        if not artifact_path.exists():
            issues.append(f'Missing AI detection model artifact for "{language}": {artifact_path}')

    return issues


def _load_model(lang: str):
    path = get_ai_detection_model_path(lang)
    if not path.exists():
        return None
    with open(path, 'rb') as f:
        return pickle.load(f)


def _extract_source_files(bundle_key: str) -> dict[str, tuple[str, str]]:
    """Returns {relative_path: (code_text, language)} for supported files."""
    storage = FileSystemStorage(location=settings.MEDIA_ROOT)
    result = {}
    try:
        with storage.open(bundle_key) as raw:
            buf = io.BytesIO(raw.read())
        with zipfile.ZipFile(buf) as zf:
            for name in zf.namelist():
                ext = os.path.splitext(name)[1].lower()
                lang = SUPPORTED_EXTENSIONS.get(ext)
                if not lang:
                    continue
                try:
                    code = zf.read(name).decode('utf-8', errors='replace')
                    result[name] = (code, lang)
                except Exception:
                    continue
    except Exception:
        pass
    return result


def _score_file(artifact: dict, code: str, lang: str) -> tuple[float, list[dict]]:
    """
    Returns (file_score, findings).
    findings = [{start_line, end_line, confidence}, ...]
    """
    # Add ml/ to path so features/extractor is importable
    ml_path = str(get_ai_detection_ml_dir())
    if ml_path not in sys.path:
        sys.path.insert(0, ml_path)

    from features.extractor import extract_dict

    model = artifact['model']
    feature_names = artifact['feature_names']

    lines = code.splitlines()
    if not lines:
        return 0.0, []

    # Document-level score
    feats = extract_dict(code, lang)
    X = [[feats.get(f, 0) for f in feature_names]]
    doc_score = float(model.predict_proba(X)[0][1])

    # Span detection via sliding window
    findings = []
    if len(lines) >= BLOCK_SIZE:
        for start in range(0, len(lines) - BLOCK_SIZE + 1, BLOCK_STEP):
            end = start + BLOCK_SIZE
            block = '\n'.join(lines[start:end])
            block_feats = extract_dict(block, lang)
            Xb = [[block_feats.get(f, 0) for f in feature_names]]
            conf = float(model.predict_proba(Xb)[0][1])
            if conf >= FINDING_THRESHOLD:
                findings.append({
                    'start_line': start,
                    'end_line': end - 1,
                    'confidence': round(conf, 4),
                })

    # Merge overlapping findings
    findings = _merge_findings(findings)
    return doc_score, findings


def _merge_findings(findings: list[dict]) -> list[dict]:
    if not findings:
        return []
    findings = sorted(findings, key=lambda x: x['start_line'])
    merged = [findings[0].copy()]
    for f in findings[1:]:
        last = merged[-1]
        if f['start_line'] <= last['end_line'] + 1:
            last['end_line'] = max(last['end_line'], f['end_line'])
            last['confidence'] = max(last['confidence'], f['confidence'])
        else:
            merged.append(f.copy())
    return merged


def _compute_verdict(score: float) -> str:
    if score >= VERDICT_THRESHOLDS[AIDetectionVerdict.CONFIRMED_AI]:
        return AIDetectionVerdict.CONFIRMED_AI
    if score >= VERDICT_THRESHOLDS[AIDetectionVerdict.LIKELY_AI]:
        return AIDetectionVerdict.LIKELY_AI
    return AIDetectionVerdict.CLEAN


def _resolve_model_version(lang: str, artifact: Optional[dict]) -> str:
    configured_default = getattr(settings, 'AI_DETECTION_DEFAULT_MODEL_VERSION', 'v1-xgboost')
    if not artifact:
        return f'{configured_default}:{lang}'

    version = (
        artifact.get('artifact_version')
        or artifact.get('model_version')
        or configured_default
    )
    artifact_lang = artifact.get('lang') or lang
    return f'{version}:{artifact_lang}'


def run_ai_detection(scan: AIDetectionScan) -> None:
    """
    Main entry point. Mutates scan in-place and saves results to DB.
    Runs synchronously — expected < 3s on CPU.
    """
    scan.status = AIDetectionStatus.RUNNING
    scan.save(update_fields=['status'])

    try:
        source_files = _extract_source_files(scan.submission.source_bundle_key)

        if not source_files:
            scan.status = AIDetectionStatus.FAILED
            scan.error_message = 'No supported source files found in submission bundle.'
            scan.completed_at = timezone.now()
            scan.save(update_fields=['status', 'error_message', 'completed_at'])
            return

        file_scores = []
        all_findings = []
        model_versions = []

        for file_path, (code, lang) in source_files.items():
            artifact = _load_model(lang)
            if artifact is None:
                # Model not trained yet — skip this language
                continue

            model_version = _resolve_model_version(lang, artifact)
            if model_version not in model_versions:
                model_versions.append(model_version)
            file_score, findings = _score_file(artifact, code, lang)
            file_scores.append(file_score)

            for f in findings:
                all_findings.append(AIDetectionFinding(
                    scan=scan,
                    file_path=file_path,
                    start_line=f['start_line'],
                    end_line=f['end_line'],
                    confidence=f['confidence'],
                ))

        if not file_scores:
            scan.status = AIDetectionStatus.FAILED
            scan.error_message = 'No trained model available for the languages in this submission.'
            scan.completed_at = timezone.now()
            scan.model_version = ', '.join(model_versions) if model_versions else ''
            scan.save(update_fields=['status', 'error_message', 'completed_at', 'model_version'])
            return

        overall = sum(file_scores) / len(file_scores)

        if all_findings:
            AIDetectionFinding.objects.bulk_create(all_findings)

        scan.overall_score = round(overall, 4)
        scan.verdict = _compute_verdict(overall)
        scan.status = AIDetectionStatus.DONE
        scan.completed_at = timezone.now()
        scan.model_version = ', '.join(model_versions)
        scan.save(update_fields=['overall_score', 'verdict', 'status', 'completed_at', 'model_version'])

    except Exception as exc:
        logger.exception('AI detection scan failed', extra={'scan_id': str(scan.id)})
        scan.status = AIDetectionStatus.FAILED
        scan.error_message = str(exc)
        scan.completed_at = timezone.now()
        scan.save(update_fields=['status', 'error_message', 'completed_at'])
