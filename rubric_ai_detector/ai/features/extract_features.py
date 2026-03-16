from __future__ import annotations

import ast
import io
import keyword
import math
import re
import tokenize
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


TOKEN_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+|\S")


@dataclass
class FeatureResult:
    feature_names: list[str]
    values: list[float]

    def to_dict(self) -> dict[str, float]:
        return dict(zip(self.feature_names, self.values))


class _AstStatsVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.node_count = 0
        self.max_depth = 0
        self.function_count = 0
        self.class_count = 0
        self.import_count = 0
        self.try_count = 0
        self.with_count = 0
        self.global_count = 0
        self.lambda_count = 0
        self.comprehension_count = 0
        self.function_docstrings = 0

    def visit(self, node: ast.AST, depth: int = 0) -> None:  # type: ignore[override]
        self.node_count += 1
        self.max_depth = max(self.max_depth, depth)

        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self.function_count += 1
            if ast.get_docstring(node):
                self.function_docstrings += 1
        elif isinstance(node, ast.ClassDef):
            self.class_count += 1
            if ast.get_docstring(node):
                self.function_docstrings += 1
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            self.import_count += 1
        elif isinstance(node, ast.Try):
            self.try_count += 1
        elif isinstance(node, ast.With):
            self.with_count += 1
        elif isinstance(node, ast.Global):
            self.global_count += 1
        elif isinstance(node, ast.Lambda):
            self.lambda_count += 1
        elif isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            self.comprehension_count += 1

        for child in ast.iter_child_nodes(node):
            self.visit(child, depth + 1)


def _safe_parse_ast(code: str) -> ast.AST | None:
    try:
        return ast.parse(code)
    except SyntaxError:
        return None


def _extract_identifiers(tree: ast.AST | None) -> list[str]:
    if tree is None:
        return []

    ids: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            ids.append(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            ids.append(node.name)
        elif isinstance(node, ast.arg):
            ids.append(node.arg)
    return ids


def _identifier_entropy(identifiers: Iterable[str]) -> float:
    items = list(identifiers)
    if not items:
        return 0.0
    counts = Counter(items)
    total = len(items)
    entropy = 0.0
    for count in counts.values():
        p = count / total
        entropy -= p * math.log2(p)
    return entropy


def _tokenize_python(code: str) -> list[str]:
    tokens: list[str] = []
    try:
        stream = io.StringIO(code)
        for tok in tokenize.generate_tokens(stream.readline):
            if tok.type in {tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.ENCODING}:
                continue
            if tok.string.strip():
                tokens.append(tok.string)
    except tokenize.TokenError:
        return TOKEN_PATTERN.findall(code)
    return tokens


def normalize_code_for_similarity(code: str) -> str:
    """Normalize source by removing comments/docstrings and collapsing whitespace."""
    try:
        out: list[str] = []
        stream = io.StringIO(code)
        prev_tok = tokenize.INDENT
        for tok in tokenize.generate_tokens(stream.readline):
            tok_type, tok_string = tok.type, tok.string
            if tok_type == tokenize.COMMENT:
                continue
            if tok_type == tokenize.STRING and prev_tok in {
                tokenize.INDENT,
                tokenize.NEWLINE,
                tokenize.DEDENT,
            }:
                # likely a docstring
                continue
            if tok_type in {tokenize.NL, tokenize.NEWLINE, tokenize.ENCODING, tokenize.ENDMARKER}:
                continue
            if tok_string.strip():
                out.append(tok_string)
            prev_tok = tok_type
        return " ".join(out)
    except tokenize.TokenError:
        stripped = re.sub(r"#.*", "", code)
        stripped = re.sub(r"\s+", " ", stripped)
        return stripped.strip()


def simple_tokenize(code: str) -> list[str]:
    normalized = normalize_code_for_similarity(code)
    return TOKEN_PATTERN.findall(normalized)


def ast_node_type_sequence(code: str) -> list[str]:
    tree = _safe_parse_ast(code)
    if tree is None:
        return []
    return [type(node).__name__ for node in ast.walk(tree)]


def extract_python_features(code: str) -> FeatureResult:
    lines = code.splitlines()
    line_count = len(lines)
    char_count = len(code)

    blank_lines = sum(1 for line in lines if not line.strip())
    comment_lines = sum(1 for line in lines if line.strip().startswith("#"))
    avg_line_len = (sum(len(line) for line in lines) / line_count) if line_count else 0.0
    max_line_len = max((len(line) for line in lines), default=0)

    leading_spaces = [len(line) - len(line.lstrip(" ")) for line in lines if line.startswith(" ")]
    indent_mean = sum(leading_spaces) / len(leading_spaces) if leading_spaces else 0.0
    indent_max = max(leading_spaces, default=0)

    tab_count = code.count("\t")
    space_count = code.count(" ")
    trailing_ws = sum(1 for line in lines if line.rstrip() != line)

    tokens = _tokenize_python(code)
    token_count = len(tokens)
    unique_tokens = len(set(tokens))
    top5_ratio = 0.0
    if tokens:
        counts = Counter(tokens).most_common(5)
        top5_ratio = sum(c for _, c in counts) / len(tokens)

    keyword_counts = Counter(tok for tok in tokens if tok in keyword.kwlist)
    loop_keyword_count = keyword_counts.get("for", 0) + keyword_counts.get("while", 0)
    condition_keyword_count = keyword_counts.get("if", 0) + keyword_counts.get("elif", 0)

    tree = _safe_parse_ast(code)
    visitor = _AstStatsVisitor()
    if tree is not None:
        visitor.visit(tree)

    identifiers = _extract_identifiers(tree)
    unique_identifier_ratio = (len(set(identifiers)) / len(identifiers)) if identifiers else 0.0
    ident_entropy = _identifier_entropy(identifiers)

    docstring_coverage = 0.0
    if tree is not None:
        module_doc = 1 if ast.get_docstring(tree) else 0
        total_doc_candidates = visitor.function_count + visitor.class_count + 1
        docstring_coverage = (
            visitor.function_docstrings + module_doc
        ) / total_doc_candidates if total_doc_candidates else 0.0

    try:
        from radon.complexity import cc_visit

        complexity_values = [block.complexity for block in cc_visit(code)]
    except Exception:
        complexity_values = []
    avg_complexity = sum(complexity_values) / len(complexity_values) if complexity_values else 0.0
    max_complexity = max(complexity_values, default=0.0)

    comment_ratio = (comment_lines / line_count) if line_count else 0.0

    feature_dict: dict[str, float] = {
        "line_count": float(line_count),
        "char_count": float(char_count),
        "blank_line_count": float(blank_lines),
        "comment_line_count": float(comment_lines),
        "comment_ratio": float(comment_ratio),
        "avg_line_length": float(avg_line_len),
        "max_line_length": float(max_line_len),
        "indent_mean": float(indent_mean),
        "indent_max": float(indent_max),
        "tab_count": float(tab_count),
        "space_count": float(space_count),
        "trailing_whitespace_count": float(trailing_ws),
        "token_count": float(token_count),
        "unique_token_count": float(unique_tokens),
        "loop_keyword_count": float(loop_keyword_count),
        "condition_keyword_count": float(condition_keyword_count),
        "identifier_entropy": float(ident_entropy),
        "unique_identifier_ratio": float(unique_identifier_ratio),
        "ast_node_count": float(visitor.node_count),
        "ast_depth": float(visitor.max_depth),
        "function_count": float(visitor.function_count),
        "class_count": float(visitor.class_count),
        "import_count": float(visitor.import_count),
        "try_count": float(visitor.try_count),
        "with_count": float(visitor.with_count),
        "global_count": float(visitor.global_count),
        "lambda_count": float(visitor.lambda_count),
        "comprehension_count": float(visitor.comprehension_count),
        "docstring_coverage": float(docstring_coverage),
        "avg_cyclomatic_complexity": float(avg_complexity),
        "max_cyclomatic_complexity": float(max_complexity),
        "top5_token_ratio": float(top5_ratio),
    }

    names = list(feature_dict.keys())
    values = [feature_dict[name] for name in names]
    return FeatureResult(feature_names=names, values=values)


def extract_features_from_file(path: str | Path) -> FeatureResult:
    file_path = Path(path)
    code = file_path.read_text(encoding="utf-8")
    return extract_python_features(code)
