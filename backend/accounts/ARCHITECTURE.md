# Accounts Architecture

## Layers

- `api/`: HTTP endpoint handlers.
- `services/`: authentication and registration business logic.
- `tests/`: app-level endpoint tests.

## Routing

- Routes are defined in `accounts/urls.py`.
- `config/urls.py` includes them under `/api/`.

## Compatibility

- `accounts/views.py` re-exports API handlers for backward compatibility.
