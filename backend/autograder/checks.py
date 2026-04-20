from django.core.checks import Error, Tags, register

from .services.ai_detection import get_ai_detection_asset_issues


@register(Tags.files, deploy=True)
def check_ai_detection_assets(app_configs, **kwargs):
    return [
        Error(
            issue,
            hint='Copy the ml directory and trained artifacts to the server, or set AI_DETECTION_ML_DIR and AI_DETECTION_MODEL_DIR correctly.',
            id='autograder.E001',
        )
        for issue in get_ai_detection_asset_issues()
    ]
