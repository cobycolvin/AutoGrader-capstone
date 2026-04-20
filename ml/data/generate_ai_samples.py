"""
Generates AI-labeled code samples using GPT-4o.
Saves to data/raw/ai/{python,java}.jsonl

Tracks cost in real-time and stops before exceeding --budget (default $9.50).

Usage:
    export OPENAI_API_KEY=sk-...
    python data/generate_ai_samples.py --samples 500 --lang python
    python data/generate_ai_samples.py --samples 500 --lang java
"""

import argparse
import json
import os
import random
import time
from pathlib import Path

from openai import OpenAI
from tqdm import tqdm

RAW_AI = Path(__file__).parent / "raw" / "ai"
RAW_AI.mkdir(parents=True, exist_ok=True)

# gpt-4.1-mini pricing (per 1M tokens)
COST_INPUT_PER_M = 0.40
COST_OUTPUT_PER_M = 1.60

PYTHON_PROMPTS = [
    "Write a Python function that finds all duplicate elements in a list and returns them sorted.",
    "Write a Python class that implements a stack with push, pop, peek, and is_empty methods.",
    "Write a Python function that merges two sorted lists into one sorted list without using sort().",
    "Write a Python function that checks if a string is a valid palindrome, ignoring spaces and punctuation.",
    "Write a Python function that counts word frequency in a string and returns a dictionary.",
    "Write a Python function that implements binary search on a sorted list.",
    "Write a Python function that flattens a nested list of arbitrary depth.",
    "Write a Python function that rotates a matrix 90 degrees clockwise in-place.",
    "Write a Python class for a simple queue using two stacks.",
    "Write a Python function that finds the longest common subsequence of two strings.",
    "Write a Python function that converts a Roman numeral string to an integer.",
    "Write a Python function that groups anagrams from a list of strings.",
    "Write a Python function that returns the nth Fibonacci number using memoization.",
    "Write a Python function that checks if a binary tree is balanced.",
    "Write a Python function that finds all permutations of a string.",
    "Write a Python function that implements run-length encoding of a string.",
    "Write a Python function that validates balanced parentheses in an expression.",
    "Write a Python function that computes the power set of a list.",
    "Write a Python function that finds the maximum subarray sum (Kadane's algorithm).",
    "Write a Python function that determines if two strings are one edit distance apart.",
    "Write a Python function that reverses words in a sentence.",
    "Write a Python function that converts an integer to its binary representation without bin().",
    "Write a Python function that finds the first non-repeating character in a string.",
    "Write a Python class implementing a min-heap with insert and extract_min.",
    "Write a Python function that performs topological sort on a DAG.",
]

JAVA_PROMPTS = [
    "Write a Java method that finds all duplicate elements in an int array and returns them in a list.",
    "Write a Java class that implements a generic stack with push, pop, peek, and isEmpty methods.",
    "Write a Java method that merges two sorted integer arrays into one sorted array.",
    "Write a Java method that checks if a string is a valid palindrome, ignoring spaces and punctuation.",
    "Write a Java method that counts word frequency in a string and returns a HashMap.",
    "Write a Java method that performs binary search on a sorted integer array.",
    "Write a Java method that reverses a singly linked list and returns the new head.",
    "Write a Java method that rotates an NxN matrix 90 degrees clockwise in-place.",
    "Write a Java class for a simple queue implemented using two stacks.",
    "Write a Java method that finds the longest common subsequence of two strings.",
    "Write a Java method that converts a Roman numeral string to an integer.",
    "Write a Java method that groups anagrams from a list of strings.",
    "Write a Java method that returns the nth Fibonacci number using memoization.",
    "Write a Java method that checks if a binary tree is height-balanced.",
    "Write a Java method that finds all permutations of a string.",
    "Write a Java method that implements run-length encoding of a string.",
    "Write a Java method that validates balanced parentheses in an expression.",
    "Write a Java method that finds the maximum subarray sum using Kadane's algorithm.",
    "Write a Java method that determines if two strings are one edit distance apart.",
    "Write a Java method that finds the first non-repeating character in a string.",
    "Write a Java class implementing a min-heap with insert and extractMin methods.",
    "Write a Java method that converts a decimal integer to its binary string representation.",
    "Write a Java method that checks if a number is prime.",
    "Write a Java method that performs level-order traversal of a binary tree.",
    "Write a Java class that implements a simple LRU cache using LinkedHashMap.",
]

SYSTEM_PROMPT = (
    "You are an expert programmer. When given a coding task, respond with ONLY the code. "
    "No explanation, no markdown fences, no comments unless they are meaningful to the logic. "
    "Write clean, idiomatic code as a skilled developer would."
)


def estimate_cost(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens / 1_000_000 * COST_INPUT_PER_M +
            output_tokens / 1_000_000 * COST_OUTPUT_PER_M)


def generate_sample(client: OpenAI, prompt: str, lang: str) -> tuple[str, int, int]:
    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
        max_tokens=900,
    )
    code = response.choices[0].message.content.strip()
    in_tok = response.usage.prompt_tokens
    out_tok = response.usage.completion_tokens
    return code, in_tok, out_tok


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=500)
    parser.add_argument("--lang", choices=["python", "java"], required=True)
    parser.add_argument("--budget", type=float, default=9.50,
                        help="Hard stop budget in USD (default $9.50)")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENAPI_KEY")
    if not api_key:
        # Try loading from backend .env
        env_path = Path(__file__).parent.parent.parent / "backend" / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("OPENAPI_KEY=") or line.startswith("OPENAI_API_KEY="):
                    api_key = line.split("=", 1)[1].strip()
                    break
    if not api_key:
        raise SystemExit("OpenAI key not found. Set OPENAI_API_KEY or OPENAPI_KEY, or add it to backend/.env")

    client = OpenAI(api_key=api_key)
    prompts = PYTHON_PROMPTS if args.lang == "python" else JAVA_PROMPTS

    out_path = RAW_AI / f"{args.lang}.jsonl"
    already_done = 0
    if out_path.exists():
        with open(out_path) as f:
            already_done = sum(1 for _ in f)
        print(f"Resuming: {already_done} samples already in {out_path}")

    remaining = args.samples - already_done
    if remaining <= 0:
        print("Already have enough samples. Done.")
        return

    random.seed(args.seed)
    total_cost = 0.0
    generated = 0

    with open(out_path, "a") as f:
        pbar = tqdm(total=remaining, desc=f"Generating {args.lang}")
        while generated < remaining:
            if total_cost >= args.budget:
                print(f"\nBudget limit ${args.budget:.2f} reached. Stopping.")
                break

            prompt = random.choice(prompts)
            try:
                code, in_tok, out_tok = generate_sample(client, prompt, args.lang)
                cost = estimate_cost(in_tok, out_tok)
                total_cost += cost

                record = {
                    "code": code,
                    "language": args.lang,
                    "label": "ai",
                    "source": "gpt-4o",
                    "prompt": prompt,
                }
                f.write(json.dumps(record) + "\n")
                f.flush()

                generated += 1
                pbar.update(1)
                pbar.set_postfix({"cost": f"${total_cost:.3f}"})

                # Avoid rate limiting
                time.sleep(0.3)

            except Exception as e:
                print(f"\nError: {e}. Retrying in 5s...")
                time.sleep(5)

        pbar.close()

    print(f"\nDone. Generated {generated} samples.")
    print(f"Estimated cost: ${total_cost:.4f}")
    print(f"Saved to: {out_path}")


if __name__ == "__main__":
    main()
