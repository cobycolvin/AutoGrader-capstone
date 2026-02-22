# Autograder Architecture

## Layers

- `models/`: persistence and schema definitions.
- `serializers/`: API payload validation and response shaping.
- `api/`: HTTP controllers (DRF viewsets/views), auth checks, request/response handling.
- `services/`: domain/business logic used by API controllers.
- `tests/`: app-level tests grouped by feature.
- `grader/`: execution worker runtime logic.

## Routing

- Project-level routes stay in `config/urls.py`.
- App routes are split into `accounts/urls.py` and `autograder/urls.py`.
- `config/urls.py` includes app URL modules under `/api/`.

## Service Conventions

- API modules should call services for non-trivial business logic.
- Services may read/write models but should not return DRF `Response` objects.
- Keep permission logic centralized in `services/access.py`.
- Keep test-suite bundle generation logic centralized in `services/test_suite_builder.py`.

## Current Refactors

- Assignment test-suite lifecycle (list/upload/build/activate/manifest) moved to `services/test_suite_service.py`.
- Rubric version lifecycle moved to `services/rubric_service.py`.
- Assignment and course authorization checks now reuse `services/access.py`.
