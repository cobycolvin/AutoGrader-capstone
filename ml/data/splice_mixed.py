"""
Creates mixed samples by splicing AI blocks into human code.
These are used for span-level (line-range) detection training.

Output: data/raw/mixed/{python,java}.jsonl
Each record includes span labels: list of {start_line, end_line, label}

Usage:
    python data/splice_mixed.py --lang python
    python data/splice_mixed.py --lang java
"""

import argparse
import json
import random
from pathlib import Path

RAW_HUMAN = Path(__file__).parent / "raw" / "human"
RAW_AI = Path(__file__).parent / "raw" / "ai"
RAW_MIXED = Path(__file__).parent / "raw" / "mixed"
RAW_MIXED.mkdir(parents=True, exist_ok=True)


def load_jsonl(path: Path) -> list[dict]:
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def splice(human_code: str, ai_code: str) -> tuple[str, list[dict]]:
    """
    Replaces a random contiguous block of lines in human_code with lines
    from ai_code. Returns (spliced_code, span_labels).
    """
    human_lines = human_code.splitlines()
    ai_lines = ai_code.splitlines()

    if len(human_lines) < 6 or len(ai_lines) < 4:
        return None, None

    # Pick a random window to replace (20-50% of the human code)
    total = len(human_lines)
    block_size = max(2, random.randint(total // 5, total // 2))
    start = random.randint(1, max(1, total - block_size - 1))
    end = start + block_size

    # Take a slice of ai_lines of the same length
    ai_slice_size = min(block_size, len(ai_lines))
    ai_start = random.randint(0, max(0, len(ai_lines) - ai_slice_size))
    ai_block = ai_lines[ai_start: ai_start + ai_slice_size]

    spliced = human_lines[:start] + ai_block + human_lines[end:]

    # Span labels (0-indexed line numbers in the final spliced code)
    spans = [
        {"start_line": start, "end_line": start + len(ai_block) - 1, "label": "ai"},
    ]
    if start > 0:
        spans.insert(0, {"start_line": 0, "end_line": start - 1, "label": "human"})
    tail_start = start + len(ai_block)
    if tail_start < len(spliced):
        spans.append({"start_line": tail_start, "end_line": len(spliced) - 1, "label": "human"})

    return "\n".join(spliced), spans


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["python", "java"], required=True)
    parser.add_argument("--samples", type=int, default=300,
                        help="Number of mixed samples to create")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)

    human_path = RAW_HUMAN / f"{args.lang}.jsonl"
    ai_path = RAW_AI / f"{args.lang}.jsonl"

    if not human_path.exists():
        raise SystemExit(f"Missing {human_path} — run fetch_codesearchnet.py first.")
    if not ai_path.exists():
        raise SystemExit(f"Missing {ai_path} — run generate_ai_samples.py first.")

    humans = load_jsonl(human_path)
    ais = load_jsonl(ai_path)

    out_path = RAW_MIXED / f"{args.lang}.jsonl"
    written = 0

    with open(out_path, "w") as f:
        attempts = 0
        while written < args.samples and attempts < args.samples * 5:
            attempts += 1
            h = random.choice(humans)
            a = random.choice(ais)
            spliced_code, spans = splice(h["code"], a["code"])
            if spliced_code is None:
                continue

            record = {
                "code": spliced_code,
                "language": args.lang,
                "label": "mixed",
                "source": f"splice:codesearchnet+gpt-4o",
                "spans": spans,
            }
            f.write(json.dumps(record) + "\n")
            written += 1

    print(f"Created {written} mixed samples → {out_path}")


if __name__ == "__main__":
    main()
