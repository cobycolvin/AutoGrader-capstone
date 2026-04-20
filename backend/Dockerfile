FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AI_DETECTION_ML_DIR=/opt/gradeforge/ml \
    AI_DETECTION_MODEL_DIR=/opt/gradeforge/ml/artifacts

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend /app
COPY ml ${AI_DETECTION_ML_DIR}

EXPOSE 8000

CMD ["sh", "-c", "python manage.py check --deploy && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 120"]
