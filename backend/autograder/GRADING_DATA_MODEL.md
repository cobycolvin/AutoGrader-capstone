# Grading Data Model

This document describes the grading-related models, their attributes, and relationships.

## Base Fields

Models inheriting `BaseModel` include these common fields:

- `id` (UUID, primary key)
- `created_at` (datetime, auto)
- `updated_at` (datetime, auto)
- `created_by` (FK to user, nullable)

`Grade` uses `TimeStampedModel` only (`created_at`, `updated_at`) and has a custom primary key via `submission`.

## ProgrammingLanguage

Purpose: stores language-specific grading command configuration.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `CharField(50)` | Yes | Display name |
| `slug` | `SlugField(50)` | Yes | Unique |
| `docker_image` | `CharField(200)` | No | Optional runtime image |
| `compile_cmd` | `TextField` | No | Optional compile step |
| `run_cmd_template` | `TextField` | Yes | Main execution command template |
| `is_enabled` | `BooleanField` | Yes | Defaults to `True` |

Relationships:

- One `ProgrammingLanguage` can be used by many `Assignment` rows.

## Submission

Purpose: stores student submission attempts.

| Field | Type | Required | Notes |
|---|---|---|---|
| `assignment` | `FK -> Assignment` | Yes | Cascade delete |
| `submitted_by` | `FK -> AUTH_USER_MODEL` | Yes | Cascade delete |
| `group` | `FK -> Group` | No | Nullable, optional group submission |
| `attempt_number` | `PositiveIntegerField` | Yes | Defaults to `1` |
| `submitted_at` | `DateTimeField` | Yes | Defaults to `timezone.now` |
| `status` | `CharField(20)` | Yes | `QUEUED`, `RUNNING`, `GRADED`, `FAILED` |
| `source_bundle_key` | `CharField(512)` | Yes | Stored upload key/path |
| `starter_code_version` | `CharField(100)` | No | Optional metadata |

Constraints and indexes:

- Unique: `assignment + submitted_by + attempt_number`
- Index: `assignment + submitted_at`

## TestSuite

Purpose: logical test-suite container for an assignment.

| Field | Type | Required | Notes |
|---|---|---|---|
| `assignment` | `FK -> Assignment` | Yes | Cascade delete |
| `active_version` | `FK -> TestSuiteVersion` | No | Nullable; currently active version |

Relationships:

- One `TestSuite` has many `TestSuiteVersion` rows.

## TestSuiteVersion

Purpose: versioned stored test bundle (zip).

| Field | Type | Required | Notes |
|---|---|---|---|
| `test_suite` | `FK -> TestSuite` | Yes | Cascade delete |
| `version_number` | `PositiveIntegerField` | Yes | Monotonic per suite/visibility |
| `visibility` | `CharField(10)` | Yes | `PUBLIC` or `PRIVATE` |
| `bundle_key` | `CharField(512)` | Yes | Stored zip key/path |
| `checksum` | `CharField(128)` | Yes | Integrity hash |

Constraints:

- Unique: `test_suite + version_number + visibility`

## GradingRun

Purpose: one execution instance of grading for a submission.

| Field | Type | Required | Notes |
|---|---|---|---|
| `submission` | `FK -> Submission` | Yes | Cascade delete |
| `test_suite_version_public` | `FK -> TestSuiteVersion` | No | Nullable |
| `test_suite_version_private` | `FK -> TestSuiteVersion` | No | Nullable |
| `rubric_version` | `FK -> RubricVersion` | No | Nullable |
| `worker_id` | `CharField(128)` | Yes | Worker identifier |
| `started_at` | `DateTimeField` | Yes | Defaults to `timezone.now` |
| `finished_at` | `DateTimeField` | No | Nullable |
| `exit_status` | `CharField(20)` | Yes | `OK`, `TIMEOUT`, `RUNTIME_ERROR`, `SANDBOX_ERROR` |
| `resource_usage_json` | `JSONField` | Yes | Defaults to `{}` |
| `stdout_key` | `CharField(512)` | No | Log storage key |
| `stderr_key` | `CharField(512)` | No | Log storage key |
| `result_json` | `JSONField` | Yes | Parsed runner output |

Indexes:

- Index: `submission + started_at`

## TestResult

Purpose: per-test-case result for a grading run.

| Field | Type | Required | Notes |
|---|---|---|---|
| `grading_run` | `FK -> GradingRun` | Yes | Cascade delete |
| `test_name` | `CharField(200)` | Yes | Case name |
| `status` | `CharField(10)` | Yes | `PASS`, `FAIL`, `SKIP` |
| `points_awarded` | `DecimalField(7,2)` | Yes | Defaults to `0` |
| `time_ms` | `PositiveIntegerField` | No | Nullable |
| `message` | `CharField(500)` | No | Optional detail |

## Grade

Purpose: current aggregate grade for a submission.

| Field | Type | Required | Notes |
|---|---|---|---|
| `submission` | `OneToOne -> Submission` | Yes | Primary key; one grade per submission |
| `latest_grading_run` | `FK -> GradingRun` | No | Nullable |
| `score` | `DecimalField(7,2)` | Yes | Awarded score |
| `max_score` | `DecimalField(7,2)` | Yes | Max score basis |
| `released_to_student` | `BooleanField` | Yes | Defaults to `False` |
| `released_at` | `DateTimeField` | No | Nullable |

## Relationship Summary

- `ProgrammingLanguage (1) -> (N) Assignment`
- `Assignment (1) -> (N) Submission`
- `Assignment (1) -> (N) TestSuite` (app logic commonly keeps one suite per assignment)
- `TestSuite (1) -> (N) TestSuiteVersion`
- `Submission (1) -> (N) GradingRun`
- `GradingRun (1) -> (N) TestResult`
- `Submission (1) -> (1) Grade`
- `Grade (N) -> (0/1) GradingRun` via `latest_grading_run`
