import json
import os
import sys
import time
import importlib.util


def load_module(module_path):
    spec = importlib.util.spec_from_file_location('student', module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_results(workspace, results):
    results_path = os.path.join(workspace, 'results.json')
    with open(results_path, 'w', encoding='utf-8') as handle:
        json.dump(results, handle, indent=2)


def main():
    if len(sys.argv) < 3:
        print('Usage: python run_tests.py <submission_dir> <workspace>')
        return 1

    submission_dir = sys.argv[1]
    workspace = sys.argv[2]
    student_path = os.path.join(submission_dir, 'student.py')

    if not os.path.exists(student_path):
        results = {
            'tests': [
                {
                    'name': 'load_submission',
                    'status': 'FAIL',
                    'points': 0,
                    'max_points': 10,
                    'time_ms': 0,
                    'message': 'student.py not found',
                }
            ]
        }
        write_results(workspace, results)
        return 1

    module = load_module(student_path)
    tests = []
    start = time.time()

    def record(name, passed, message=''):
        tests.append({
            'name': name,
            'status': 'PASS' if passed else 'FAIL',
            'points': 5 if passed else 0,
            'max_points': 5,
            'time_ms': int((time.time() - start) * 1000),
            'message': message,
        })

    try:
        add_fn = getattr(module, 'add', None)
        if add_fn is None:
            record('add_exists', False, 'add() is missing')
        else:
            record('add(1,2)', add_fn(1, 2) == 3)
            record('add(-1,5)', add_fn(-1, 5) == 4)
            record('add(0,0)', add_fn(0, 0) == 0)
    except Exception as exc:  # noqa: BLE001
        record('runtime_error', False, str(exc))

    results = {'tests': tests}
    write_results(workspace, results)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
