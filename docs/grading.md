# Grading Execution (Local Process)

This document explains how Gradeforge runs grading locally, records results, and how to operate the worker.

## Overview

When a submission is created it is marked `QUEUED`. A background worker (`run_grader_worker`) pulls queued submissions,
executes tests in a temporary workspace, and writes the results to:

- `grading_run`
- `test_result`
- `submission.status`

If a manual `grade` already exists, the worker links the latest `grading_run` to it, but does not auto-score or overwrite it.

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

## Seed default languages

Create or refresh the default grader languages:

```bash
python backend/manage.py seed_languages
```

This seeds:
- `Python 3` (`python3`)
- `Java 17` (`java17`)

Both default to the generated test-runner command:

```text
python {tests_dir}/run_tests.py {submission_dir} {workspace}
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
5. Resolve execution mode for the active test suite:
   - `LANGUAGE_TEMPLATE`:
     - run `compile_cmd` (if defined)
     - run `run_cmd_template`
   - `PYTHON_RUNNER`:
     - skip language `compile_cmd`
     - run generated `tests/run_tests.py` as:
       `python tests/run_tests.py <submission_dir> <workspace>`
6. Parse `results.json` from the runner output.
7. Save `stdout/stderr` logs to `MEDIA_ROOT/grading_runs/...`
8. Write `test_result` rows, preserve any manual grade, and update submission status.

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
      "time_ms": 42,
      "message": "optional text"
    }
  ]
}
```

`points` and `max_points` are still accepted as legacy optional metadata, but the direct builders now treat every case as a pass/fail verification check.

If no results file is present, a single test result is created using the process exit code.

## Execution modes and builders

`TestSuiteVersion.execution_mode` controls how the worker executes tests:

- `LANGUAGE_TEMPLATE`: legacy/manual zip flow. Uses `ProgrammingLanguage` compile/run commands.
- `PYTHON_RUNNER`: direct-builder flow. Uses generated `run_tests.py` inside the test bundle.

Professor upload options in the Tests tab:

- Upload `.zip` bundle (legacy/manual flow).
- Upload raw files (`files[]`) and server will package them into a versioned zip automatically.
  - Auto mode sets `PYTHON_RUNNER` when `run_tests.py` is present.
  - Execution mode can be overridden explicitly (`LANGUAGE_TEMPLATE` or `PYTHON_RUNNER`).

Direct builder currently supports:

- `IO` mode: Python stdin/stdout tests.
- `OOP` mode:
  - Python: class/method contract tests + optional main-flow tests.
  - Java: generated `GeneratedHarness.java` + optional main-flow tests (root `.java`, no packages in v1).
- `FILE_IO` mode:
  - Python: file fixtures + command args + stdout/stderr expectations + output-file checks.
  - Java: file fixtures + command args + packaged or root-level source layouts + output-file checks.
  - Optional `validator.py` for cases with multiple valid outputs or semantic validation.

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
