from django.db.models import Max

from ..models import Rubric, RubricCriterion, RubricVersion


def get_active_rubric_payload(assignment):
    rubric = Rubric.objects.filter(assignment=assignment).select_related('active_version').first()
    if not rubric or not rubric.active_version:
        return None, None, None
    version = rubric.active_version
    criteria = RubricCriterion.objects.filter(rubric_version=version).order_by('order_index', 'created_at')
    return rubric, version, criteria


def upsert_rubric_version(assignment, payload):
    rubric, _ = Rubric.objects.get_or_create(assignment=assignment)
    current_version = (
        RubricVersion.objects.filter(rubric=rubric).aggregate(max_version=Max('version_number')).get('max_version')
        or 0
    )
    next_version = current_version + 1

    version = RubricVersion.objects.create(
        rubric=rubric,
        version_number=next_version,
        is_weighted=payload.get('is_weighted', False),
    )

    criteria_payload = payload.get('criteria', [])
    created_criteria = []
    for index, criterion in enumerate(criteria_payload):
        created_criteria.append(
            RubricCriterion.objects.create(
                rubric_version=version,
                name=criterion.get('name', ''),
                max_points=criterion.get('max_points', 0),
                weight=criterion.get('weight'),
                order_index=criterion.get('order_index', index),
            )
        )

    rubric.active_version = version
    rubric.save(update_fields=['active_version'])
    return rubric, version, created_criteria


def list_rubric_versions(assignment):
    rubric = Rubric.objects.filter(assignment=assignment).select_related('active_version').first()
    if not rubric:
        return []

    versions = RubricVersion.objects.filter(rubric=rubric).order_by('-created_at')
    criteria = RubricCriterion.objects.filter(rubric_version__in=versions)
    totals = {}
    counts = {}

    for criterion in criteria:
        version_id = criterion.rubric_version_id
        counts[version_id] = counts.get(version_id, 0) + 1
        totals[version_id] = totals.get(version_id, 0) + float(criterion.max_points)

    return [
        {
            'id': str(version.id),
            'version_number': version.version_number,
            'created_at': version.created_at,
            'is_weighted': version.is_weighted,
            'criteria_count': counts.get(version.id, 0),
            'total_points': totals.get(version.id, 0),
            'is_active': str(version.id) == str(rubric.active_version_id),
        }
        for version in versions
    ]


def activate_rubric_version(assignment, version_id):
    rubric = Rubric.objects.filter(assignment=assignment).first()
    if not rubric:
        return None, None

    version = RubricVersion.objects.filter(id=version_id, rubric=rubric).first()
    if not version:
        return rubric, None

    rubric.active_version = version
    rubric.save(update_fields=['active_version'])
    return rubric, version
