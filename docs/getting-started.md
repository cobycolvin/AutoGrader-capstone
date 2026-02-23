# Getting Started (Local Dev)

This guide shows the fastest way to run the project locally (backend + frontend + grader worker).

## What this project runs

- `backend/` = Django + DRF API
- `frontend/` = React + Vite UI
- `run_grader_worker` = background worker that grades queued submissions

## Prerequisites

- Python 3.10+ (3.11 recommended)
- Node.js 20+ and `npm`

## Quick Start (Recommended: SQLite)

The backend defaults to MySQL if `DB_ENGINE` is not set. For a simple local setup, use SQLite.

### 1) Backend setup

```bash
cd backend

# Create virtual environment
python3 -m venv .venv

# Activate it (macOS/Linux)
source .venv/bin/activate

# Install backend dependencies used by this project
pip install django djangorestframework django-cors-headers python-dotenv
```

Create or edit `backend/.env`:

```env
# Django
DJANGO_DEBUG=1
DJANGO_SECRET_KEY=dev-secret-key
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost

# Use SQLite for local development (recommended)
DB_ENGINE=django.db.backends.sqlite3
DB_NAME=db.sqlite3

# Frontend dev origins (default already supports Vite)
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

If you want to use MySQL locally instead of SQLite, install a MySQL driver and set `DB_*` vars:

```bash
pip install mysqlclient
```

Run migrations and create an admin user:

```bash
./.venv/bin/python manage.py migrate
./.venv/bin/python manage.py createsuperuser
```

### 2) Frontend setup

```bash
cd ../frontend
npm install
npm run dev
```

Frontend runs at:
- `http://localhost:5173`

Optional `frontend/.env` (not required if backend runs on `localhost:8000`):

```env
VITE_API_BASE=http://localhost:8000
```

### 3) Start backend API

Open a new terminal:

```bash
cd backend
./.venv/bin/python manage.py runserver
```

Backend runs at:
- `http://localhost:8000`

### 4) Start grading worker (required for grading submissions)

Open another terminal:

```bash
cd backend
./.venv/bin/python manage.py run_grader_worker
```

If you only want to process one queued submission and exit:

```bash
./.venv/bin/python manage.py run_grader_worker --once
```

## First-Time Setup for Grading (Important)

Assignments need a `ProgrammingLanguage` entry to know how grading runs.

### Option A: Create in Admin UI

1. Open `http://localhost:8000/admin/`
2. Log in with your superuser
3. Add a `ProgrammingLanguage` (Python)

Recommended values for Python (works with generated test bundles):

- `name`: `Python 3`
- `slug`: `python3`
- `compile_cmd`: *(leave blank)*
- `run_cmd_template`: `python {tests_dir}/run_tests.py {submission_dir} {workspace}`
- `is_enabled`: checked

### Option B: Create from shell (one command)

```bash
cd backend
./.venv/bin/python manage.py shell -c "from autograder.models import ProgrammingLanguage; ProgrammingLanguage.objects.update_or_create(slug='python3', defaults={'name':'Python 3','compile_cmd':'','run_cmd_template':'python {tests_dir}/run_tests.py {submission_dir} {workspace}','is_enabled':True})"
```

## Daily Run Commands (Copy/Paste)

Use 3 terminals:

### Terminal 1: Backend API

```bash
cd backend
./.venv/bin/python manage.py runserver
```

### Terminal 2: Frontend

```bash
cd frontend
npm run dev
```

### Terminal 3: Grader Worker

```bash
cd backend
./.venv/bin/python manage.py run_grader_worker
```

## Common Commands

### Backend checks/tests

```bash
cd backend
./.venv/bin/python manage.py check
./.venv/bin/python manage.py test
```

If your local `.env` points to MySQL and you want a quick SQLite test run:

```bash
cd backend
DB_ENGINE=django.db.backends.sqlite3 DB_NAME=db.sqlite3 ./.venv/bin/python manage.py test
```

### Frontend

```bash
cd frontend
npm run lint
npm run build
```

## Basic Smoke Test (End-to-End)

1. Open `http://localhost:5173`
2. Register/login
3. Create a course
4. Create an assignment and set language to `Python 3`
5. In the assignment **Tests** tab, use **Build and publish** (stdin/stdout or function mode)
6. Submit a zip file for the assignment
7. Confirm submission moves from `QUEUED` -> `RUNNING` -> `GRADED`

## Troubleshooting

- **Submission stays `QUEUED`**
  - The grader worker is not running. Start `manage.py run_grader_worker`.

- **Backend fails to start with MySQL connection error**
  - Your `.env` is using MySQL defaults. Set:
    - `DB_ENGINE=django.db.backends.sqlite3`
    - `DB_NAME=db.sqlite3`

- **Grading fails with “No run command configured”**
  - Assignment language is missing or `ProgrammingLanguage.run_cmd_template` is empty.

- **Test builder UI disabled**
  - Direct test builder is currently **Python-only**.

## Related Docs

- `docs/grading.md` (grading worker flow and test runner contract)
- `docs/model.md` (ER diagram / model overview)
- `backend/autograder/ARCHITECTURE.md` (backend structure)
