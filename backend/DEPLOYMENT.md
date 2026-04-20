# Backend Deployment

This backend now expects the AI detection runtime assets to be deployed with the app.

## Runtime layout

The backend reads AI detection assets from:

- `AI_DETECTION_ML_DIR`
- `AI_DETECTION_MODEL_DIR`

Defaults:

- `AI_DETECTION_ML_DIR=<repo-root>/ml`
- `AI_DETECTION_MODEL_DIR=<repo-root>/ml/artifacts`

Required files:

- `ml/features/extractor.py`
- `ml/artifacts/model_python.pkl`
- `ml/artifacts/model_java.pkl`

## Docker build

Build from the repository root so the container can copy both `backend/` and `ml/`:

```bash
docker build -f backend/Dockerfile -t capston-backend .
```

The image startup command runs:

```bash
python manage.py check --deploy
```

before Gunicorn starts. Deployment will fail if the required AI assets are missing.

## Recommended environment

Set these in production:

```bash
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=your-domain.example.com
AI_DETECTION_REQUIRED_MODELS=python,java
AI_DETECTION_DEFAULT_MODEL_VERSION=v1-xgboost
```

Only override these paths if your deployment layout is different from the default:

```bash
AI_DETECTION_ML_DIR=/opt/gradeforge/ml
AI_DETECTION_MODEL_DIR=/opt/gradeforge/ml/artifacts
```

## Updating the AI model

Train outside production:

```bash
cd ml
python training/train.py --lang all --version 2026-04-20-r1
python training/evaluate.py --model artifacts/model_python.pkl
python training/evaluate.py --model artifacts/model_java.pkl
```

Then deploy the updated artifact files:

- `ml/artifacts/model_python.pkl`
- `ml/artifacts/model_java.pkl`
- optionally `ml/artifacts/model_all.pkl`

After the new artifacts are on the server, restart the backend container or process.

Each new AI scan now records the artifact version stored inside the model metadata, so rollout verification is visible from the API response.
