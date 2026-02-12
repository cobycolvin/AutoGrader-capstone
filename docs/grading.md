# Grading Execution (Local Process)

This document explains how Gradeforge runs grading locally, records results, and how to operate the worker.

## Overview

When a submission is created it is marked `QUEUED`. A background worker (`run_grader_worker`) pulls queued submissions,
executes tests in a temporary workspace, and writes the results to:

- `grading_run`
- `test_result`
- `grade`
- `submission.status`

No external queue is required in the local setup.

## Worker command

Start the local grading worker:

```bash
python backend/manage.py run_grader_worker
```

Options:

```bash
python backend/manage.py run_grader_worker --once
python backend/manage.py run_grader_worker --poll-interval 1.5
```

## Execution flow

1. **Claim** a `QUEUED` submission (row lock) and mark it `RUNNING`.
2. Create a `grading_run` with:
   - active test suite version (if any)
   - active rubric version (if any)
3. Build a temp workspace:
   ```
   /tmp/gradeforge_xxxx/
     submission/
     tests/
   ```
4. Unpack submission and test suite zip bundles.
5. Run compile command (if defined).
6. Run the test command (from `ProgrammingLanguage.run_cmd_template`).
7. Parse `results.json` if present.
8. Save `stdout/stderr` logs to `MEDIA_ROOT/grading_runs/...`
9. Write `test_result` rows and `grade`, update submission status.

## Test runner contract

Your test bundle should produce a `results.json` file at either:

- `<workspace>/results.json` or
- `<workspace>/tests/results.json`

**Schema:**

```json
{
  "tests": [
    {
      "name": "test_case_name",
      "status": "PASS | FAIL | SKIP",
      "points": 5,
      "max_points": 5,
      "time_ms": 42,
      "message": "optional text"
    }
  ]
}
```

If no results file is present, a single test result is created using the process exit code.

## Command templates

The `ProgrammingLanguage` model provides commands:

- `compile_cmd` (optional)
- `run_cmd_template` (required for tests)

Available placeholders:

- `{submission_dir}`
- `{tests_dir}`
- `{workspace}`

Example:

```
run_cmd_template = "pytest {tests_dir} --json-report --json-report-file {workspace}/results.json"
```

## Logs and artifacts

Captured logs are stored locally in:

```
MEDIA_ROOT/grading_runs/<submission_id>/<grading_run_id>/
  stdout.txt
  stderr.txt
```

The paths are recorded in `grading_run.stdout_key` and `grading_run.stderr_key`.

## Notes / Future upgrades

- Add Docker sandboxing for security
- Replace local loop with Dramatiq/Celery
- Store logs in S3/MinIO
- Support multiple test suite versions (public/private) per grading run
