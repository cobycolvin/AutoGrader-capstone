import io
import json

from django.http import FileResponse
from django.utils.text import slugify
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import ProgrammingLanguage
from ..services.access import can_access_template_tools
from ..services.test_suite_builder import zip_bytes


def _zip_buffer(files):
    buffer = io.BytesIO(zip_bytes(files))
    buffer.seek(0)
    return buffer


def _python_unit_template():
    return {
        'id': 'python-unit',
        'name': 'Python unit tests',
        'language': 'Python',
        'type': 'UNIT',
        'description': 'A starter test runner that imports student.py and checks functions.',
        'instructions': (
            'Edit run_tests.py to add your tests. '
            'This template writes results.json for the grader.'
        ),
        'bundle': _zip_buffer({
            'README.md': (
                '# Python unit test template\n\n'
                'This template expects a student submission with `student.py`.\n'
                'Edit `run_tests.py` to add your own checks.\n'
                'The runner writes `results.json` in the workspace root.\n'
            ),
            'run_tests.py': (
                'import json\n'
                'import os\n'
                'import sys\n'
                'import time\n'
                'import importlib.util\n\n'
                'def load_module(module_path):\n'
                '    spec = importlib.util.spec_from_file_location("student", module_path)\n'
                '    module = importlib.util.module_from_spec(spec)\n'
                '    spec.loader.exec_module(module)\n'
                '    return module\n\n'
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
                '    student_path = os.path.join(submission_dir, "student.py")\n'
                '    if not os.path.exists(student_path):\n'
                '        write_results(workspace, [{\n'
                '            "name": "submission_missing",\n'
                '            "status": "FAIL",\n'
                '            "points": 0,\n'
                '            "max_points": 10,\n'
                '            "time_ms": 0,\n'
                '            "message": "student.py not found"\n'
                '        }])\n'
                '        return 1\n'
                '    module = load_module(student_path)\n'
                '    tests = []\n'
                '    start = time.time()\n'
                '    def record(name, passed, message=""):\n'
                '        tests.append({\n'
                '            "name": name,\n'
                '            "status": "PASS" if passed else "FAIL",\n'
                '            "points": 5 if passed else 0,\n'
                '            "max_points": 5,\n'
                '            "time_ms": int((time.time() - start) * 1000),\n'
                '            "message": message,\n'
                '        })\n'
                '    # TODO: update to match your assignment\n'
                '    add_fn = getattr(module, "add", None)\n'
                '    if add_fn is None:\n'
                '        record("add_exists", False, "add() missing")\n'
                '    else:\n'
                '        record("add(1,2)", add_fn(1, 2) == 3)\n'
                '        record("add(-1,5)", add_fn(-1, 5) == 4)\n'
                '    write_results(workspace, tests)\n'
                '    return 0\n\n'
                'if __name__ == "__main__":\n'
                '    raise SystemExit(main())\n'
            ),
        }),
    }


def _python_io_template():
    return {
        'id': 'python-io',
        'name': 'Python I/O checks',
        'language': 'Python',
        'type': 'IO',
        'description': 'Runs student main.py with stdin test cases from tests.json.',
        'instructions': (
            'Edit tests.json with input/output pairs. '
            'Student submission should include main.py that reads stdin.'
        ),
        'bundle': _zip_buffer({
            'README.md': (
                '# Python I/O test template\n\n'
                'This template expects a student submission with `main.py`.\n'
                'Edit `tests.json` to add input/output cases.\n'
                'The runner writes `results.json` for the grader.\n'
            ),
            'tests.json': (
                '{\n'
                '  "tests": [\n'
                '    { "name": "case-1", "input": "2 3\\n", "expected": "5" },\n'
                '    { "name": "case-2", "input": "10 -2\\n", "expected": "8" }\n'
                '  ]\n'
                '}\n'
            ),
            'run_tests.py': (
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
                '    for test in payload.get("tests", []):\n'
                '        start = time.time()\n'
                '        proc = subprocess.run(\n'
                '            [sys.executable, os.path.join(submission_dir, "main.py")],\n'
                '            input=test.get("input", ""),\n'
                '            text=True,\n'
                '            capture_output=True,\n'
                '        )\n'
                '        output = (proc.stdout or "").strip()\n'
                '        expected = (test.get("expected") or "").strip()\n'
                '        passed = output == expected\n'
                '        tests.append({\n'
                '            "name": test.get("name") or "case",\n'
                '            "status": "PASS" if passed else "FAIL",\n'
                '            "points": 5 if passed else 0,\n'
                '            "max_points": 5,\n'
                '            "time_ms": int((time.time() - start) * 1000),\n'
                '            "message": proc.stderr.strip(),\n'
                '        })\n'
                '    write_results(workspace, tests)\n'
                '    return 0\n\n'
                'if __name__ == "__main__":\n'
                '    raise SystemExit(main())\n'
            ),
        }),
    }


TEMPLATES = {
    'python-unit': _python_unit_template,
    'python-io': _python_io_template,
}


class TestTemplateListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not can_access_template_tools(request.user):
            raise PermissionDenied('Not authorized to view test templates.')
        language_filter = request.query_params.get('language')
        type_filter = request.query_params.get('type')
        if type_filter:
            type_filter = type_filter.upper()
        data = []
        for builder in TEMPLATES.values():
            template = builder()
            if language_filter and template['language'].lower() != language_filter.lower():
                continue
            if type_filter and template['type'].upper() != type_filter:
                continue
            data.append({
                'id': template['id'],
                'name': template['name'],
                'language': template['language'],
                'type': template['type'],
                'description': template['description'],
                'instructions': template['instructions'],
            })
        return Response(data)


class TestTemplateBundleView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, template_id):
        if not can_access_template_tools(request.user):
            raise PermissionDenied('Not authorized to download test templates.')
        builder = TEMPLATES.get(template_id)
        if not builder:
            return Response({'detail': 'Template not found.'}, status=404)
        template = builder()
        bundle = template['bundle']
        filename = f"{template_id}.zip"
        return FileResponse(bundle, as_attachment=True, filename=filename)


class TestTemplateBuildView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not can_access_template_tools(request.user):
            raise PermissionDenied('Not authorized to build test templates.')
        payload = request.data or {}
        template_type = (payload.get('type') or payload.get('kind') or '').upper()
        if template_type != 'IO':
            return Response({'detail': 'Only IO templates are supported in the builder.'}, status=400)

        language = payload.get('language')
        language_id = payload.get('language_id')
        if language_id:
            language = ProgrammingLanguage.objects.filter(id=language_id).values_list('name', flat=True).first()
        if not language:
            return Response({'detail': 'Language is required.'}, status=400)
        if str(language).lower() != 'python':
            return Response({'detail': 'Only Python is supported in the builder.'}, status=400)

        name = (payload.get('name') or 'io-tests').strip()
        tests = payload.get('tests') or []
        if not isinstance(tests, list) or len(tests) == 0:
            return Response({'detail': 'At least one test case is required.'}, status=400)
        if len(tests) > 200:
            return Response({'detail': 'Too many tests. Limit is 200.'}, status=400)

        normalized_tests = []
        for index, test in enumerate(tests, start=1):
            if not isinstance(test, dict):
                continue
            input_value = test.get('input', '')
            expected_value = test.get('expected', '')
            case_name = test.get('name') or f'case-{index}'
            points = test.get('points', 0)
            timeout_ms = test.get('timeout_ms')
            try:
                points_value = float(points) if points is not None else 0
            except (TypeError, ValueError):
                points_value = 0
            try:
                timeout_value = int(timeout_ms) if timeout_ms else None
            except (TypeError, ValueError):
                timeout_value = None
            if input_value == '' and expected_value == '':
                continue
            normalized = {
                'name': str(case_name),
                'input': str(input_value),
                'expected': str(expected_value),
                'points': points_value,
            }
            if timeout_value:
                normalized['timeout_ms'] = timeout_value
            normalized_tests.append(normalized)

        if len(normalized_tests) == 0:
            return Response({'detail': 'Test cases cannot be empty.'}, status=400)

        timeout_ms = payload.get('timeout_ms')
        tests_json = {
            'tests': normalized_tests,
        }
        if timeout_ms:
            try:
                tests_json['timeout_ms'] = int(timeout_ms)
            except (TypeError, ValueError):
                pass

        run_tests = (
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
            '        proc = subprocess.run(\n'
            '            [sys.executable, os.path.join(submission_dir, "main.py")],\n'
            '            input=test.get("input", ""),\n'
            '            text=True,\n'
            '            capture_output=True,\n'
            '            timeout=(timeout / 1000) if timeout else None,\n'
            '        )\n'
            '        output = (proc.stdout or "").strip()\n'
            '        expected = (test.get("expected") or "").strip()\n'
            '        passed = output == expected\n'
            '        max_points = test.get("points", 0)\n'
            '        tests.append({\n'
            '            "name": test.get("name") or "case",\n'
            '            "status": "PASS" if passed else "FAIL",\n'
            '            "points": max_points if passed else 0,\n'
            '            "max_points": max_points,\n'
            '            "time_ms": int((time.time() - start) * 1000),\n'
            '            "message": (proc.stderr or "").strip(),\n'
            '        })\n'
            '    write_results(workspace, tests)\n'
            '    return 0\n\n'
            'if __name__ == "__main__":\n'
            '    raise SystemExit(main())\n'
        )

        files = {
            'README.md': (
                '# Python I/O tests (builder)\n\n'
                'This bundle was generated by the Gradeforge builder.\n'
                'Edit tests.json to add more cases if needed.\n'
                'Student submissions should include main.py.\n'
            ),
            'tests.json': json.dumps(tests_json, indent=2),
            'run_tests.py': run_tests,
        }
        bundle = _zip_buffer(files)
        safe_name = slugify(name) or 'io-tests'
        return FileResponse(bundle, as_attachment=True, filename=f'{safe_name}.zip')
