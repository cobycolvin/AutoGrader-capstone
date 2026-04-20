"""
Extracts handcrafted features from Java and Python code snippets.
All features are CPU-friendly (no neural models).

Features are split into three groups:
  - Universal: work for any language
  - Python-specific
  - Java-specific
"""

import math
import re
import statistics
from dataclasses import dataclass, asdict, fields


@dataclass
class CodeFeatures:
    # --- Universal ---
    num_lines: int = 0
    num_blank_lines: int = 0
    blank_line_ratio: float = 0.0
    avg_line_length: float = 0.0
    std_line_length: float = 0.0
    max_line_length: int = 0
    # Comment density
    comment_line_ratio: float = 0.0
    inline_comment_ratio: float = 0.0
    # Indentation regularity (AI is very consistent)
    indent_levels_count: int = 0
    indent_regularity: float = 0.0   # 1.0 = perfectly regular steps
    # Token entropy (lexical diversity)
    token_entropy: float = 0.0
    type_token_ratio: float = 0.0
    # Naming
    avg_identifier_length: float = 0.0
    all_camel_case: float = 0.0      # fraction of identifiers in camelCase
    all_snake_case: float = 0.0      # fraction in snake_case
    # Structure
    avg_block_length: float = 0.0    # avg lines between blank lines
    burstiness: float = 0.0          # variance of block lengths (AI is low)
    # Magic numbers
    magic_number_count: int = 0
    # Nesting depth
    max_nesting_depth: int = 0
    avg_nesting_depth: float = 0.0

    # --- Python-specific ---
    py_docstring_ratio: float = 0.0
    py_list_comprehension_count: int = 0
    py_type_hint_count: int = 0
    py_f_string_count: int = 0
    py_lambda_count: int = 0
    py_exception_breadth: int = 0   # how many distinct exception types caught

    # --- Java-specific ---
    java_javadoc_ratio: float = 0.0
    java_generic_exception: int = 0  # catch(Exception e) count
    java_sysout_count: int = 0
    java_access_modifier_ratio: float = 0.0
    java_final_count: int = 0
    java_override_count: int = 0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def feature_names(cls) -> list[str]:
        return [f.name for f in fields(cls)]


# ── helpers ──────────────────────────────────────────────────────────────────

def _tokenize(code: str) -> list[str]:
    return re.findall(r"[A-Za-z_]\w*", code)


def _token_entropy(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    freq = {}
    for t in tokens:
        freq[t] = freq.get(t, 0) + 1
    total = len(tokens)
    return -sum((c / total) * math.log2(c / total) for c in freq.values())


def _is_camel(name: str) -> bool:
    return bool(re.match(r"^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$", name))


def _is_snake(name: str) -> bool:
    return bool(re.match(r"^[a-z][a-z0-9]*(_[a-z0-9]+)+$", name))


def _nesting_depth(line: str, lang: str) -> int:
    if lang == "java":
        return line.count("{") - line.count("}")
    else:
        return len(line) - len(line.lstrip()) // 4


def _indent_level(line: str) -> int:
    stripped = line.lstrip()
    if not stripped:
        return 0
    spaces = len(line) - len(stripped)
    tabs = len(line) - len(line.lstrip("\t"))
    return spaces // 4 + tabs


# ── main extractor ────────────────────────────────────────────────────────────

def extract(code: str, lang: str) -> CodeFeatures:
    f = CodeFeatures()
    lines = code.splitlines()
    if not lines:
        return f

    lang = lang.lower()

    # Basic line stats
    f.num_lines = len(lines)
    lengths = [len(l) for l in lines]
    f.avg_line_length = statistics.mean(lengths) if lengths else 0
    f.std_line_length = statistics.stdev(lengths) if len(lengths) > 1 else 0
    f.max_line_length = max(lengths) if lengths else 0

    blank = [l for l in lines if not l.strip()]
    f.num_blank_lines = len(blank)
    f.blank_line_ratio = len(blank) / f.num_lines

    # Comment lines
    if lang == "python":
        comment_lines = [l for l in lines if l.strip().startswith("#")]
        inline = [l for l in lines if "#" in l and not l.strip().startswith("#")]
    else:
        comment_lines = [l for l in lines if l.strip().startswith("//") or l.strip().startswith("*")]
        inline = [l for l in lines if "//" in l and not l.strip().startswith("//")]

    f.comment_line_ratio = len(comment_lines) / f.num_lines
    f.inline_comment_ratio = len(inline) / f.num_lines

    # Indentation
    indent_levels = [_indent_level(l) for l in lines if l.strip()]
    f.indent_levels_count = len(set(indent_levels))
    if len(indent_levels) > 1:
        diffs = [abs(indent_levels[i+1] - indent_levels[i])
                 for i in range(len(indent_levels)-1)]
        non_zero = [d for d in diffs if d != 0]
        if non_zero:
            # regularity: how often diffs are exactly 1 (uniform steps)
            f.indent_regularity = sum(1 for d in non_zero if d == 1) / len(non_zero)

    # Token entropy & type-token ratio
    tokens = _tokenize(code)
    f.token_entropy = _token_entropy(tokens)
    f.type_token_ratio = len(set(tokens)) / len(tokens) if tokens else 0

    # Identifier naming
    keywords = {
        "python": {"def", "class", "if", "else", "elif", "for", "while", "return",
                   "import", "from", "try", "except", "with", "as", "in", "not",
                   "and", "or", "True", "False", "None", "self", "lambda", "yield"},
        "java": {"public", "private", "protected", "class", "interface", "extends",
                 "implements", "return", "if", "else", "for", "while", "new", "this",
                 "static", "final", "void", "int", "String", "boolean", "null",
                 "true", "false", "import", "package", "try", "catch", "throw"},
    }
    kw = keywords.get(lang, set())
    identifiers = [t for t in tokens if t not in kw and len(t) > 1]
    if identifiers:
        f.avg_identifier_length = statistics.mean(len(i) for i in identifiers)
        f.all_camel_case = sum(1 for i in identifiers if _is_camel(i)) / len(identifiers)
        f.all_snake_case = sum(1 for i in identifiers if _is_snake(i)) / len(identifiers)

    # Block lengths (between blank lines)
    blocks, cur = [], 0
    for l in lines:
        if not l.strip():
            if cur > 0:
                blocks.append(cur)
            cur = 0
        else:
            cur += 1
    if cur > 0:
        blocks.append(cur)
    if blocks:
        f.avg_block_length = statistics.mean(blocks)
        f.burstiness = statistics.variance(blocks) if len(blocks) > 1 else 0

    # Magic numbers
    f.magic_number_count = len(re.findall(r"\b(?!0\b|1\b)\d{2,}\b", code))

    # Nesting depth
    depth, max_d, depths = 0, 0, []
    for line in lines:
        if lang == "java":
            depth += line.count("{") - line.count("}")
        else:
            lvl = _indent_level(line)
            depth = lvl
        depths.append(max(0, depth))
        max_d = max(max_d, depth)
    f.max_nesting_depth = max_d
    f.avg_nesting_depth = statistics.mean(depths) if depths else 0

    # ── Python-specific ───────────────────────────────────────────────────────
    if lang == "python":
        docstrings = re.findall(r'"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'', code)
        f.py_docstring_ratio = len(docstrings) / max(1, code.count("def "))
        f.py_list_comprehension_count = len(re.findall(r"\[.+\bfor\b.+\bin\b", code))
        f.py_type_hint_count = len(re.findall(r":\s*(int|str|float|bool|list|dict|tuple|set|Optional|List|Dict)\b", code))
        f.py_f_string_count = len(re.findall(r'\bf"', code))
        f.py_lambda_count = len(re.findall(r"\blambda\b", code))
        exceptions = re.findall(r"\bexcept\s+(\w+)", code)
        f.py_exception_breadth = len(set(exceptions))

    # ── Java-specific ─────────────────────────────────────────────────────────
    if lang == "java":
        javadoc_blocks = len(re.findall(r"/\*\*[\s\S]*?\*/", code))
        method_count = len(re.findall(r"\b(public|private|protected)\s+\w+\s+\w+\s*\(", code))
        f.java_javadoc_ratio = javadoc_blocks / max(1, method_count)
        f.java_generic_exception = len(re.findall(r"catch\s*\(\s*Exception\b", code))
        f.java_sysout_count = len(re.findall(r"System\.out\.(print|println)", code))
        total_methods = max(1, method_count)
        access_mods = len(re.findall(r"\b(public|private|protected)\b", code))
        f.java_access_modifier_ratio = access_mods / total_methods
        f.java_final_count = len(re.findall(r"\bfinal\b", code))
        f.java_override_count = len(re.findall(r"@Override", code))

    return f


def extract_dict(code: str, lang: str) -> dict:
    return extract(code, lang).to_dict()
