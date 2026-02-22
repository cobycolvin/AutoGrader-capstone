import io
import json
import zipfile

from django.utils.text import slugify


def is_python_language(language):
    if not language:
        return False
    name = (language.name or '').lower()
    slug = (language.slug or '').lower()
    return 'python' in name or slug.startswith('python') or slug in {'py'}


def zip_bytes(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_ref:
        for name, content in files.items():
            zip_ref.writestr(name, content)
    return buffer.getvalue()


def _python_io_builder_runner():
    return (
        'import json\n'
        'import os\n'
        'import subprocess\n'
        'import sys\n'
        'import time\n\n'
        'def write_results(workspace, tests):\n'
        '    path = os.path.join(workspace, "results.json")\n'
        '    with open(path, "w", encoding="utf-8") as handle:\n'
        '        json.dump({"tests": tests}, handle, indent=2)\n\n'
        'def main():\n'
        '    if len(sys.argv) < 3:\n'
        '        print("Usage: python run_tests.py <submission_dir> <workspace>")\n'
        '        return 1\n'
        '    submission_dir = sys.argv[1]\n'
        '    workspace = sys.argv[2]\n'
        '    tests_path = os.path.join(os.path.dirname(__file__), "tests.json")\n'
        '    with open(tests_path, "r", encoding="utf-8") as handle:\n'
        '        payload = json.load(handle)\n'
        '    tests = []\n'
        '    default_timeout = payload.get("timeout_ms")\n'
        '    for test in payload.get("tests", []):\n'
        '        start = time.time()\n'
        '        timeout = test.get("timeout_ms") or default_timeout\n'
        '        try:\n'
        '            proc = subprocess.run(\n'
        '                [sys.executable, os.path.join(submission_dir, "main.py")],\n'
        '                input=test.get("input", ""),\n'
        '                text=True,\n'
        '                capture_output=True,\n'
        '                timeout=(timeout / 1000) if timeout else None,\n'
        '            )\n'
        '            output = (proc.stdout or "").strip()\n'
        '            expected = (test.get("expected") or "").strip()\n'
        '            passed = output == expected\n'
        '            max_points = test.get("points", 0)\n'
        '            tests.append({\n'
        '                "name": test.get("name") or "case",\n'
        '                "status": "PASS" if passed else "FAIL",\n'
        '                "points": max_points if passed else 0,\n'
        '                "max_points": max_points,\n'
        '                "time_ms": int((time.time() - start) * 1000),\n'
        '                "message": (proc.stderr or "").strip(),\n'
        '            })\n'
        '        except subprocess.TimeoutExpired:\n'
        '            tests.append({\n'
        '                "name": test.get("name") or "case",\n'
        '                "status": "FAIL",\n'
        '                "points": 0,\n'
        '                "max_points": test.get("points", 0),\n'
        '                "time_ms": int((time.time() - start) * 1000),\n'
        '                "message": "Timed out",\n'
        '            })\n'
        '    write_results(workspace, tests)\n'
        '    return 0\n\n'
        'if __name__ == "__main__":\n'
        '    raise SystemExit(main())\n'
    )


def _python_function_builder_runner():
    return (
        'import importlib.util\n'
        'import json\n'
        'import os\n'
        'import signal\n'
        'import sys\n'
        'import time\n\n'
        'class TimeoutErrorLocal(Exception):\n'
        '    pass\n\n'
        'def _timeout_handler(_signum, _frame):\n'
        '    raise TimeoutErrorLocal("Timed out")\n\n'
        'def _load_module(module_path):\n'
        '    spec = importlib.util.spec_from_file_location("student_module", module_path)\n'
        '    if spec is None or spec.loader is None:\n'
        '        raise RuntimeError("Unable to load module")\n'
        '    module = importlib.util.module_from_spec(spec)\n'
        '    spec.loader.exec_module(module)\n'
        '    return module\n\n'
        'def _call_with_args(fn, args):\n'
        '    if isinstance(args, list):\n'
        '        return fn(*args)\n'
        '    if isinstance(args, dict):\n'
        '        return fn(**args)\n'
        '    if args is None:\n'
        '        return fn()\n'
        '    return fn(args)\n\n'
        'def _invoke(fn, args, timeout_ms):\n'
        '    can_timeout = timeout_ms and hasattr(signal, "SIGALRM") and hasattr(signal, "setitimer")\n'
        '    if not can_timeout:\n'
        '        return _call_with_args(fn, args)\n'
        '    previous = signal.signal(signal.SIGALRM, _timeout_handler)\n'
        '    signal.setitimer(signal.ITIMER_REAL, timeout_ms / 1000.0)\n'
        '    try:\n'
        '        return _call_with_args(fn, args)\n'
        '    finally:\n'
        '        signal.setitimer(signal.ITIMER_REAL, 0)\n'
        '        signal.signal(signal.SIGALRM, previous)\n\n'
        'def write_results(workspace, tests):\n'
        '    path = os.path.join(workspace, "results.json")\n'
        '    with open(path, "w", encoding="utf-8") as handle:\n'
        '        json.dump({"tests": tests}, handle, indent=2)\n\n'
        'def main():\n'
        '    if len(sys.argv) < 3:\n'
        '        print("Usage: python run_tests.py <submission_dir> <workspace>")\n'
        '        return 1\n'
        '    submission_dir = sys.argv[1]\n'
        '    workspace = sys.argv[2]\n'
        '    tests_path = os.path.join(os.path.dirname(__file__), "tests.json")\n'
        '    with open(tests_path, "r", encoding="utf-8") as handle:\n'
        '        payload = json.load(handle)\n'
        '    tests = []\n'
        '    module_rel = payload.get("module_path") or "student.py"\n'
        '    module_path = os.path.join(submission_dir, module_rel)\n'
        '    default_timeout = payload.get("timeout_ms")\n'
        '    try:\n'
        '        module = _load_module(module_path)\n'
        '    except Exception as exc:\n'
        '        for index, test in enumerate(payload.get("tests", []), start=1):\n'
        '            max_points = test.get("points", 0)\n'
        '            tests.append({\n'
        '                "name": test.get("name") or f"case-{index}",\n'
        '                "status": "FAIL",\n'
        '                "points": 0,\n'
        '                "max_points": max_points,\n'
        '                "time_ms": 0,\n'
        '                "message": f"Module load error: {exc}",\n'
        '            })\n'
        '        write_results(workspace, tests)\n'
        '        return 1\n'
        '    for index, test in enumerate(payload.get("tests", []), start=1):\n'
        '        start = time.time()\n'
        '        name = test.get("name") or f"case-{index}"\n'
        '        function_name = test.get("function_name")\n'
        '        max_points = test.get("points", 0)\n'
        '        timeout = test.get("timeout_ms") or default_timeout\n'
        '        fn = getattr(module, function_name, None)\n'
        '        if not callable(fn):\n'
        '            tests.append({\n'
        '                "name": name,\n'
        '                "status": "FAIL",\n'
        '                "points": 0,\n'
        '                "max_points": max_points,\n'
        '                "time_ms": int((time.time() - start) * 1000),\n'
        '                "message": f"Function not found: {function_name}",\n'
        '            })\n'
        '            continue\n'
        '        try:\n'
        '            actual = _invoke(fn, test.get("args"), timeout)\n'
        '            expected = test.get("expected")\n'
        '            passed = actual == expected\n'
        '            if passed:\n'
        '                message = ""\n'
        '            else:\n'
        '                message = f"Expected {expected!r}, got {actual!r}"\n'
        '            tests.append({\n'
        '                "name": name,\n'
        '                "status": "PASS" if passed else "FAIL",\n'
        '                "points": max_points if passed else 0,\n'
        '                "max_points": max_points,\n'
        '                "time_ms": int((time.time() - start) * 1000),\n'
        '                "message": message,\n'
        '            })\n'
        '        except TimeoutErrorLocal:\n'
        '            tests.append({\n'
        '                "name": name,\n'
        '                "status": "FAIL",\n'
        '                "points": 0,\n'
        '                "max_points": max_points,\n'
        '                "time_ms": int((time.time() - start) * 1000),\n'
        '                "message": "Timed out",\n'
        '            })\n'
        '        except Exception as exc:\n'
        '            tests.append({\n'
        '                "name": name,\n'
        '                "status": "FAIL",\n'
        '                "points": 0,\n'
        '                "max_points": max_points,\n'
        '                "time_ms": int((time.time() - start) * 1000),\n'
        '                "message": f"{type(exc).__name__}: {exc}",\n'
        '            })\n'
        '    write_results(workspace, tests)\n'
        '    return 0\n\n'
        'if __name__ == "__main__":\n'
        '    raise SystemExit(main())\n'
    )


def build_assignment_suite_bundle(payload):
    test_type = payload.get('type', 'IO')
    normalized_tests = []

    if test_type == 'FUNCTION':
        for index, test in enumerate(payload.get('function_tests', []), start=1):
            test_payload = {
                'name': test.get('name') or f'case-{index}',
                'function_name': test.get('function_name'),
                'args': test.get('args', []),
                'expected': test.get('expected'),
                'points': test.get('points', 0),
            }
            if test.get('timeout_ms'):
                test_payload['timeout_ms'] = test['timeout_ms']
            normalized_tests.append(test_payload)

        tests_json = {
            'type': 'FUNCTION',
            'module_path': payload.get('module_path', 'student.py'),
            'tests': normalized_tests,
        }
        readme_text = (
            '# Python function tests (builder)\n\n'
            'This bundle was generated by the Gradeforge builder.\n'
            'Edit tests.json to add or revise cases.\n'
            'By default, student.py is imported from the submission.\n'
        )
        runner_text = _python_function_builder_runner()
        default_suite_name = 'function-tests'
    else:
        for index, test in enumerate(payload.get('tests', []), start=1):
            test_payload = {
                'name': test.get('name') or f'case-{index}',
                'input': test.get('input', ''),
                'expected': test.get('expected', ''),
                'points': test.get('points', 0),
            }
            if test.get('timeout_ms'):
                test_payload['timeout_ms'] = test['timeout_ms']
            normalized_tests.append(test_payload)

        tests_json = {
            'type': 'IO',
            'tests': normalized_tests,
        }
        readme_text = (
            '# Python I/O tests (builder)\n\n'
            'This bundle was generated by the Gradeforge builder.\n'
            'Edit tests.json to add or revise cases.\n'
            'Student submissions should include main.py.\n'
        )
        runner_text = _python_io_builder_runner()
        default_suite_name = 'io-tests'

    if payload.get('timeout_ms'):
        tests_json['timeout_ms'] = payload['timeout_ms']

    files = {
        'README.md': readme_text,
        'tests.json': json.dumps(tests_json, indent=2),
        'run_tests.py': runner_text,
    }
    bundle_bytes = zip_bytes(files)

    suite_name = (payload.get('name') or '').strip()
    safe_name = slugify(suite_name) or default_suite_name
    return bundle_bytes, safe_name
