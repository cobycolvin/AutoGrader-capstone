# Sample Grading Bundle

This sample lets you run the local grader end-to-end without pytest.

## 1) Create a Programming Language

In the Admin Languages UI (or Django admin), create:

- name: Python (local)
- slug: python-local
- docker_image: (leave blank)
- compile_cmd: (leave blank)
- run_cmd_template:

```
python {tests_dir}/run_tests.py {submission_dir} {workspace}
```

## 2) Create the test suite zip

From repo root:

```
cd docs/sample_grading/tests
zip -r ../sample_tests.zip .
```

This produces `docs/sample_grading/sample_tests.zip` with `run_tests.py` at the root.

## 3) Create the submission zip

From repo root:

```
cd docs/sample_grading/submission
zip -r ../sample_submission.zip .
```

This produces `docs/sample_grading/sample_submission.zip` with `student.py` at the root.

## 4) Create assignment + upload

- Create an assignment and set language = **Python (local)**.
- Upload `sample_tests.zip` in the Tests tab.
- Upload `sample_submission.zip` in the Submissions tab.

## 5) Run the grader worker

```
python backend/manage.py run_grader_worker --once
```

Expected results:
- Submission status -> GRADED
- `grading_run`, `test_result`, `grade` rows created
- Logs stored under `MEDIA_ROOT/grading_runs/...`

## Notes

The test runner writes `results.json` to the workspace root, so the grader can parse it.
