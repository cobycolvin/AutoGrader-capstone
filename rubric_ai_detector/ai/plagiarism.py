from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from itertools import combinations
from pathlib import Path

from ai.features.extract_features import ast_node_type_sequence, infer_language_from_path, normalize_code_for_similarity, simple_tokenize


@dataclass
class PairSimilarity:
    assignment_id: str
    language: str
    file_a: str
    file_b: str
    normalized_text_similarity: float
    token_jaccard_similarity: float
    difflib_ratio: float
    ast_similarity: float
    final_similarity_score: float
    stripped_prefix_tokens: int
    flagged: bool


def _similarity_ratio(a: list[str] | str, b: list[str] | str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _jaccard(a: list[str], b: list[str]) -> float:
    set_a, set_b = set(a), set(b)
    union = set_a | set_b
    if not union:
        return 0.0
    return len(set_a & set_b) / len(union)


def _common_token_prefix(token_lists: list[list[str]], min_prefix: int = 8) -> list[str]:
    if not token_lists:
        return []
    shortest = min(token_lists, key=len)
    prefix: list[str] = []
    for idx, token in enumerate(shortest):
        if all(idx < len(tokens) and tokens[idx] == token for tokens in token_lists):
            prefix.append(token)
        else:
            break
    return prefix if len(prefix) >= min_prefix else []


def _strip_prefix(tokens: list[str], prefix: list[str]) -> list[str]:
    if prefix and len(tokens) >= len(prefix) and tokens[: len(prefix)] == prefix:
        return tokens[len(prefix) :]
    return tokens


def _collect_submissions(folder: Path, mode: str) -> dict[tuple[str, str], list[Path]]:
    def supported_files(parent: Path) -> list[Path]:
        files: list[Path] = []
        for path in sorted(parent.iterdir()):
            if not path.is_file():
                continue
            try:
                infer_language_from_path(path)
            except ValueError:
                continue
            files.append(path)
        return files

    if mode == "global":
        groups: dict[tuple[str, str], list[Path]] = {}
        for path in supported_files(folder):
            language = infer_language_from_path(path)
            groups.setdefault(("all", language), []).append(path)
        return groups

    assignments: dict[tuple[str, str], list[Path]] = {}
    for subdir in sorted(path for path in folder.iterdir() if path.is_dir()):
        for path in supported_files(subdir):
            language = infer_language_from_path(path)
            assignments.setdefault((subdir.name, language), []).append(path)
    return assignments


def compare_folder(folder: Path, threshold: float, mode: str) -> list[PairSimilarity]:
    groups = _collect_submissions(folder, mode)
    pairs: list[PairSimilarity] = []

    for (assignment_id, language), source_files in groups.items():
        submissions: dict[str, dict[str, object]] = {}
        token_lists: list[list[str]] = []

        for path in source_files:
            code = path.read_text(encoding="utf-8")
            normalized = normalize_code_for_similarity(code, language)
            tokens = simple_tokenize(code, language)
            ast_seq = ast_node_type_sequence(code, language)
            submissions[path.name] = {
                "normalized": normalized,
                "tokens": tokens,
                "ast": ast_seq,
            }
            token_lists.append(tokens)

        common_prefix = _common_token_prefix(token_lists) if mode == "assignment" else []

        for a_name, b_name in combinations(submissions.keys(), 2):
            a = submissions[a_name]
            b = submissions[b_name]

            a_tokens = _strip_prefix(list(a["tokens"]), common_prefix)
            b_tokens = _strip_prefix(list(b["tokens"]), common_prefix)

            text_sim = _similarity_ratio(" ".join(a_tokens), " ".join(b_tokens))
            token_seq_sim = _similarity_ratio(a_tokens, b_tokens)
            jaccard = _jaccard(a_tokens, b_tokens)
            ast_sim = _similarity_ratio(list(a["ast"]), list(b["ast"])) if a["ast"] and b["ast"] else 0.0

            final = 0.30 * text_sim + 0.20 * token_seq_sim + 0.25 * jaccard + 0.25 * ast_sim
            pairs.append(
                PairSimilarity(
                    assignment_id=assignment_id,
                    language=language,
                    file_a=a_name,
                    file_b=b_name,
                    normalized_text_similarity=round(text_sim, 4),
                    token_jaccard_similarity=round(jaccard, 4),
                    difflib_ratio=round(token_seq_sim, 4),
                    ast_similarity=round(ast_sim, 4),
                    final_similarity_score=round(final, 4),
                    stripped_prefix_tokens=len(common_prefix),
                    flagged=final >= threshold,
                )
            )

    pairs.sort(key=lambda x: x.final_similarity_score, reverse=True)
    return pairs


def main() -> None:
    parser = argparse.ArgumentParser(description="Lightweight plagiarism comparison for supported source files")
    parser.add_argument("--folder", required=True, help="Folder containing supported source files")
    parser.add_argument(
        "--mode",
        choices=["global", "assignment"],
        default="global",
        help="global: compare all files in one folder; assignment: compare only within each assignment subfolder.",
    )
    parser.add_argument("--top_k", type=int, default=20)
    parser.add_argument("--threshold", type=float, default=0.85)
    parser.add_argument("--output", default="ai/output/plagiarism_report.json")
    parser.add_argument("--csv_output", default="")
    args = parser.parse_args()

    folder = Path(args.folder)
    if not folder.exists():
        raise FileNotFoundError(f"Submission folder does not exist: {folder}")

    results = compare_folder(folder, args.threshold, args.mode)
    top_results = results[: args.top_k]

    report = {
        "folder": str(folder),
        "mode": args.mode,
        "threshold": args.threshold,
        "top_k": args.top_k,
        "total_pairs": len(results),
        "flagged_pairs": sum(r.flagged for r in results),
        "pairs": [asdict(r) for r in top_results],
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote JSON report to {output_path}")

    if args.csv_output:
        csv_path = Path(args.csv_output)
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", encoding="utf-8", newline="") as f:
            fieldnames = list(asdict(top_results[0]).keys()) if top_results else list(PairSimilarity.__dataclass_fields__.keys())
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for row in top_results:
                writer.writerow(asdict(row))
        print(f"Wrote CSV report to {csv_path}")


if __name__ == "__main__":
    main()
