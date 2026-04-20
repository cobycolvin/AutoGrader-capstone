from __future__ import annotations

import argparse
import re
from pathlib import Path

import pandas as pd

from ai.features.extract_features import SUPPORTED_EXTENSIONS, infer_language_from_path


def _parse_sources(raw_sources: str) -> list[str]:
    sources = [source.strip().lower() for source in raw_sources.split(",") if source.strip()]
    invalid_sources = [source for source in sources if source not in {"human", "ai"}]
    if invalid_sources:
        raise ValueError(f"Unsupported sources: {invalid_sources}. Use 'human', 'ai', or both.")
    if not sources:
        raise ValueError("At least one source must be provided.")
    return sources


def _slugify(relative_path: Path) -> str:
    normalized_parts = [
        re.sub(r"[^A-Za-z0-9]+", "_", part).strip("_").lower()
        for part in relative_path.parts
    ]
    return "__".join(part for part in normalized_parts if part)


def _build_sample_id(source: str, file_path: Path, relative_path: Path, id_mode: str) -> str:
    if id_mode == "stem":
        file_token = file_path.stem
    else:
        file_token = _slugify(relative_path)
    return f"{source}__{file_token}"


def _scan_source_dir(source_dir: Path, source: str, id_mode: str) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for file_path in sorted(source_dir.rglob("*")):
        if not file_path.is_file() or file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue

        relative_path = file_path.relative_to(source_dir)
        language = infer_language_from_path(file_path)
        records.append(
            {
                "sample_id": _build_sample_id(source, file_path, relative_path, id_mode),
                "source": source,
                "label_ai": 1 if source == "ai" else 0,
                "language": language,
                "filename": relative_path.as_posix(),
            }
        )
    return records


def _load_rubric_csv(path: Path, join_key: str) -> pd.DataFrame:
    rubric_df = pd.read_csv(path)
    if join_key not in rubric_df.columns:
        raise ValueError(f"Rubric CSV '{path}' is missing required join column '{join_key}'.")
    if rubric_df[join_key].duplicated().any():
        duplicates = rubric_df.loc[rubric_df[join_key].duplicated(), join_key].astype(str).unique().tolist()
        raise ValueError(f"Rubric CSV '{path}' has duplicate '{join_key}' values: {duplicates[:10]}")
    return rubric_df


def main() -> None:
    parser = argparse.ArgumentParser(description="Build labels.csv by scanning ai/data/raw folders.")
    parser.add_argument(
        "--sources",
        default="human,ai",
        help="Comma-separated sources to scan. Use 'human', 'ai', or 'human,ai'.",
    )
    parser.add_argument(
        "--id_mode",
        choices=["relative_path", "stem"],
        default="relative_path",
        help="How to build sample_id values. 'relative_path' is safer when names repeat.",
    )
    parser.add_argument(
        "--rubric_csv",
        default="",
        help="Optional CSV of rubric scores to merge into the generated labels file.",
    )
    parser.add_argument(
        "--rubric_join_key",
        choices=["sample_id", "filename"],
        default="sample_id",
        help="Column used to join the optional rubric CSV onto the generated manifest.",
    )
    parser.add_argument(
        "--drop_unmatched_rubric",
        action="store_true",
        help="When --rubric_csv is provided, keep only rows that matched the rubric CSV.",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Output CSV path. Defaults to ai/data/labels.csv under this package.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    data_dir = root / "data"
    output_path = Path(args.output).expanduser().resolve() if args.output else data_dir / "labels.csv"

    sources = _parse_sources(args.sources)

    records: list[dict[str, object]] = []
    missing_source_dirs: list[Path] = []
    for source in sources:
        source_dir = data_dir / "raw" / source
        if not source_dir.exists():
            missing_source_dirs.append(source_dir)
            continue
        records.extend(_scan_source_dir(source_dir, source, args.id_mode))

    if not records:
        missing_text = ", ".join(str(path) for path in missing_source_dirs) if missing_source_dirs else "no supported files found"
        raise ValueError(f"No supported source files were found. Checked: {missing_text}")

    manifest_df = pd.DataFrame.from_records(records).sort_values(["source", "language", "filename"]).reset_index(drop=True)
    if manifest_df["sample_id"].duplicated().any():
        duplicates = manifest_df.loc[manifest_df["sample_id"].duplicated(), "sample_id"].tolist()
        raise ValueError(
            "Generated duplicate sample_id values. "
            "Use --id_mode relative_path or rename files. "
            f"Duplicates: {duplicates[:10]}"
        )

    matched_rows = None
    if args.rubric_csv:
        rubric_path = Path(args.rubric_csv).expanduser().resolve()
        rubric_df = _load_rubric_csv(rubric_path, args.rubric_join_key)
        manifest_df = manifest_df.merge(rubric_df, on=args.rubric_join_key, how="left", validate="one_to_one", indicator=True)
        matched_rows = int((manifest_df["_merge"] == "both").sum())
        if args.drop_unmatched_rubric:
            manifest_df = manifest_df.loc[manifest_df["_merge"] == "both"].copy()
        manifest_df = manifest_df.drop(columns=["_merge"])

    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_df.to_csv(output_path, index=False)

    source_counts = manifest_df["source"].value_counts().to_dict()
    language_counts = manifest_df["language"].value_counts().to_dict()

    print(f"Wrote {len(manifest_df)} rows to {output_path}")
    print(f"Sources: {source_counts}")
    print(f"Languages: {language_counts}")
    if matched_rows is not None:
        print(f"Rubric matches on '{args.rubric_join_key}': {matched_rows}/{len(records)}")


if __name__ == "__main__":
    main()
