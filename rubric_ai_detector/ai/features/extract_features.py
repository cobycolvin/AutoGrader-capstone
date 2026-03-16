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


TOKEN_PATTERN = re.compile(
    r"[A-Za-z_][A-Za-z0-9_-]*|\d+(?:\.\d+)?|==|!=|<=|>=|=>|->|&&|\|\||[{}()\[\];:,.<>/+*%=&!#@-]"
)
IDENTIFIER_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
STRING_LITERAL_PATTERN = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', re.DOTALL)
NUMERIC_LITERAL_PATTERN = re.compile(r"\b\d+(?:\.\d+)?\b")
HTML_TAG_PATTERN = re.compile(r"<([A-Za-z][A-Za-z0-9:-]*)\b")
CSS_RULE_PATTERN = re.compile(r"(^|[}\n])\s*([^@{}\n][^{]*)\{", re.MULTILINE)

SUPPORTED_LANGUAGES = ("python", "java", "perl", "javascript", "css", "html")
LANGUAGE_EXTENSIONS: dict[str, tuple[str, ...]] = {
    "python": (".py",),
    "java": (".java",),
    "perl": (".pl", ".pm"),
    "javascript": (".js", ".mjs", ".cjs", ".jsx"),
    "css": (".css",),
    "html": (".html", ".htm"),
}
LANGUAGE_ALIASES = {
    "py": "python",
    "python": "python",
    "java": "java",
    "pl": "perl",
    "pm": "perl",
    "perl": "perl",
    "js": "javascript",
    "mjs": "javascript",
    "cjs": "javascript",
    "jsx": "javascript",
    "javascript": "javascript",
    "css": "css",
    "html": "html",
    "htm": "html",
}
SUPPORTED_EXTENSIONS = tuple(
    sorted({ext for extensions in LANGUAGE_EXTENSIONS.values() for ext in extensions})
)

LANGUAGE_KEYWORDS: dict[str, set[str]] = {
    "python": set(keyword.kwlist),
    "java": {
        "abstract",
        "assert",
        "boolean",
        "break",
        "byte",
        "case",
        "catch",
        "char",
        "class",
        "const",
        "continue",
        "default",
        "do",
        "double",
        "else",
        "enum",
        "extends",
        "final",
        "finally",
        "float",
        "for",
        "if",
        "implements",
        "import",
        "instanceof",
        "int",
        "interface",
        "long",
        "new",
        "package",
        "private",
        "protected",
        "public",
        "return",
        "short",
        "static",
        "switch",
        "this",
        "throw",
        "throws",
        "try",
        "void",
        "while",
    },
    "perl": {
        "if",
        "elsif",
        "else",
        "unless",
        "while",
        "for",
        "foreach",
        "continue",
        "last",
        "next",
        "redo",
        "my",
        "our",
        "local",
        "sub",
        "package",
        "use",
        "require",
        "return",
        "eval",
        "die",
        "warn",
    },
    "javascript": {
        "async",
        "await",
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "default",
        "do",
        "else",
        "export",
        "extends",
        "finally",
        "for",
        "from",
        "function",
        "if",
        "import",
        "let",
        "new",
        "return",
        "switch",
        "throw",
        "try",
        "var",
        "while",
        "yield",
    },
    "css": {
        "@media",
        "@keyframes",
        "animation",
        "background",
        "border",
        "color",
        "display",
        "flex",
        "font",
        "grid",
        "height",
        "margin",
        "padding",
        "position",
        "width",
    },
    "html": {
        "a",
        "article",
        "aside",
        "body",
        "button",
        "div",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "head",
        "header",
        "html",
        "img",
        "input",
        "label",
        "li",
        "link",
        "main",
        "meta",
        "nav",
        "ol",
        "p",
        "script",
        "section",
        "span",
        "style",
        "title",
        "ul",
    },
}
LANGUAGE_SIGNAL_KEYWORDS: dict[str, dict[str, set[str]]] = {
    "python": {
        "loop": {"for", "while"},
        "condition": {"if", "elif", "match"},
        "definition": {"def"},
        "import": {"import", "from"},
        "exception": {"try", "except", "raise"},
        "with": {"with"},
        "lambda": {"lambda"},
    },
    "java": {
        "loop": {"for", "while", "do"},
        "condition": {"if", "else", "switch", "case"},
        "definition": {"class", "interface", "enum"},
        "import": {"import", "package"},
        "exception": {"try", "catch", "throw", "throws", "finally"},
        "with": set(),
        "lambda": set(),
    },
    "perl": {
        "loop": {"for", "foreach", "while"},
        "condition": {"if", "elsif", "else", "unless"},
        "definition": {"sub", "package"},
        "import": {"use", "require"},
        "exception": {"eval", "die", "warn"},
        "with": set(),
        "lambda": set(),
    },
    "javascript": {
        "loop": {"for", "while", "do"},
        "condition": {"if", "else", "switch", "case"},
        "definition": {"function", "class"},
        "import": {"import", "export", "from"},
        "exception": {"try", "catch", "throw", "finally"},
        "with": set(),
        "lambda": {"=>"},
    },
    "css": {
        "loop": set(),
        "condition": {"@media", "@supports"},
        "definition": {"@keyframes"},
        "import": {"@import"},
        "exception": set(),
        "with": set(),
        "lambda": set(),
    },
    "html": {
        "loop": set(),
        "condition": set(),
        "definition": {"html", "body", "section", "article"},
        "import": {"script", "link", "style"},
        "exception": set(),
        "with": set(),
        "lambda": set(),
    },
}
COMMENT_SYNTAX: dict[str, dict[str, tuple[str, ...] | tuple[tuple[str, str], ...]]] = {
    "python": {
        "line": ("#",),
        "block": (),
    },
    "java": {
        "line": ("//",),
        "block": (("/*", "*/"),),
    },
    "perl": {
        "line": ("#",),
        "block": (),
    },
    "javascript": {
        "line": ("//",),
        "block": (("/*", "*/"),),
    },
    "css": {
        "line": (),
        "block": (("/*", "*/"),),
    },
    "html": {
        "line": (),
        "block": (("<!--", "-->"),),
    },
}


@dataclass
class FeatureResult:
    feature_names: list[str]
    values: list[float]
    language: str

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


def canonicalize_language(language: str | None) -> str | None:
    if language is None:
        return None
    normalized = language.strip().lower().lstrip(".")
    return LANGUAGE_ALIASES.get(normalized)


def infer_language_from_path(path: str | Path) -> str:
    suffix = Path(path).suffix.lower()
    language = canonicalize_language(suffix)
    if not language:
        raise ValueError(f"Unsupported file extension '{suffix or '<none>'}' for {path}")
    return language


def get_supported_extensions(language: str | None = None) -> tuple[str, ...]:
    if language is None:
        return SUPPORTED_EXTENSIONS
    normalized = canonicalize_language(language)
    if not normalized:
        raise ValueError(f"Unsupported language '{language}'")
    return LANGUAGE_EXTENSIONS[normalized]


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


def _strip_python_comments_and_docstrings(code: str) -> str:
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
                prev_tok = tok_type
                continue
            if tok_type in {tokenize.NL, tokenize.NEWLINE, tokenize.ENCODING, tokenize.ENDMARKER}:
                prev_tok = tok_type
                continue
            if tok_string.strip():
                out.append(tok_string)
            prev_tok = tok_type
        return " ".join(out)
    except tokenize.TokenError:
        stripped = re.sub(r"#.*", "", code)
        stripped = re.sub(r"\s+", " ", stripped)
        return stripped.strip()


def _strip_generic_comments(code: str, language: str) -> str:
    syntax = COMMENT_SYNTAX[language]
    stripped = code
    for start, end in syntax["block"]:  # type: ignore[index]
        pattern = re.escape(start) + r".*?" + re.escape(end)
        stripped = re.sub(pattern, " ", stripped, flags=re.DOTALL)

    lines: list[str] = []
    for line in stripped.splitlines():
        candidate = line
        positions = []
        for marker in syntax["line"]:  # type: ignore[index]
            pos = candidate.find(marker)
            if pos != -1:
                positions.append(pos)
        if positions:
            candidate = candidate[: min(positions)]
        lines.append(candidate)
    return "\n".join(lines)


def _count_comment_lines(code: str, language: str) -> int:
    if language == "python":
        return sum(1 for line in code.splitlines() if line.strip().startswith("#"))

    syntax = COMMENT_SYNTAX[language]
    comment_lines = sum(
        1
        for line in code.splitlines()
        if any(line.strip().startswith(marker) for marker in syntax["line"])  # type: ignore[index]
    )
    for start, end in syntax["block"]:  # type: ignore[index]
        pattern = re.escape(start) + r".*?" + re.escape(end)
        for match in re.finditer(pattern, code, flags=re.DOTALL):
            comment_lines += match.group(0).count("\n") + 1
    return comment_lines


def normalize_code_for_similarity(code: str, language: str | None = None) -> str:
    normalized_language = canonicalize_language(language) or "python"
    if normalized_language == "python":
        return _strip_python_comments_and_docstrings(code)
    stripped = _strip_generic_comments(code, normalized_language)
    return re.sub(r"\s+", " ", stripped).strip()


def simple_tokenize(code: str, language: str | None = None) -> list[str]:
    normalized = normalize_code_for_similarity(code, language)
    return TOKEN_PATTERN.findall(normalized)


def ast_node_type_sequence(code: str, language: str | None = None) -> list[str]:
    normalized_language = canonicalize_language(language) or "python"
    if normalized_language == "python":
        tree = _safe_parse_ast(code)
        if tree is None:
            return []
        return [type(node).__name__ for node in ast.walk(tree)]

    normalized = normalize_code_for_similarity(code, normalized_language)
    structural_tokens: list[str] = []
    structural_keywords = LANGUAGE_KEYWORDS[normalized_language] | {"{", "}", "(", ")", "[", "]", ";", "<", ">"}
    for token in TOKEN_PATTERN.findall(normalized):
        lowered = token.lower()
        if token in structural_keywords or lowered in structural_keywords:
            structural_tokens.append(lowered if lowered in structural_keywords else token)
    return structural_tokens


def _count_matching_keywords(tokens: Iterable[str], keywords_to_match: set[str]) -> int:
    lowered_tokens = [token.lower() for token in tokens]
    return sum(1 for token in lowered_tokens if token in keywords_to_match)


def _extract_generic_identifiers(tokens: Iterable[str], language: str) -> list[str]:
    keywords_for_language = LANGUAGE_KEYWORDS[language]
    identifiers: list[str] = []
    for token in tokens:
        if not IDENTIFIER_PATTERN.fullmatch(token):
            continue
        lowered = token.lower()
        if lowered in keywords_for_language:
            continue
        identifiers.append(token)
    return identifiers


def _estimate_delimiter_depth(code: str) -> int:
    opens = {"{": "}", "[": "]", "(": ")"}
    closes = {value: key for key, value in opens.items()}
    stack: list[str] = []
    max_depth = 0
    for char in code:
        if char in opens:
            stack.append(char)
            max_depth = max(max_depth, len(stack))
        elif char in closes and stack and stack[-1] == closes[char]:
            stack.pop()
    return max_depth


def _estimate_html_depth(code: str) -> int:
    stack: list[str] = []
    max_depth = 0
    for tag in re.finditer(r"</?([A-Za-z][A-Za-z0-9:-]*)[^>]*?/?>", code):
        token = tag.group(0)
        name = tag.group(1).lower()
        if token.startswith("</"):
            if stack and stack[-1] == name:
                stack.pop()
        elif token.endswith("/>"):
            continue
        else:
            stack.append(name)
            max_depth = max(max_depth, len(stack))
    return max_depth


def _python_structure_stats(code: str) -> dict[str, float]:
    tree = _safe_parse_ast(code)
    visitor = _AstStatsVisitor()
    if tree is not None:
        visitor.visit(tree)

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

    return {
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
    }


def _generic_structure_stats(code: str, language: str, tokens: list[str]) -> dict[str, float]:
    lowered_tokens = [token.lower() for token in tokens]
    signals = LANGUAGE_SIGNAL_KEYWORDS[language]

    if language == "java":
        function_count = len(
            re.findall(
                r"^\s*(?:public|private|protected|static|final|native|synchronized|abstract|\s)*"
                r"[\w<>\[\]]+\s+[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{",
                code,
                flags=re.MULTILINE,
            )
        )
        class_count = len(re.findall(r"\b(?:class|interface|enum)\s+[A-Za-z_]\w*", code))
        import_count = len(re.findall(r"^\s*import\s+[\w.*]+;", code, flags=re.MULTILINE))
        try_count = len(re.findall(r"\btry\b", code))
        with_count = 0
        lambda_count = code.count("->")
        comprehension_count = 0
        global_count = len(re.findall(r"^\s*package\s+[\w.]+;", code, flags=re.MULTILINE))
    elif language == "perl":
        function_count = len(re.findall(r"^\s*sub\s+[A-Za-z_]\w*", code, flags=re.MULTILINE))
        class_count = len(re.findall(r"^\s*package\s+[A-Za-z_:]\w*", code, flags=re.MULTILINE))
        import_count = len(re.findall(r"^\s*(?:use|require)\b", code, flags=re.MULTILINE))
        try_count = len(re.findall(r"\beval\b", code))
        with_count = 0
        lambda_count = 0
        comprehension_count = 0
        global_count = len(re.findall(r"\bour\b", code))
    elif language == "javascript":
        function_count = len(
            re.findall(
                r"\bfunction\s+[A-Za-z_$][\w$]*\s*\(|"
                r"(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|"
                r"[A-Za-z_$][\w$]*\s*:\s*function\s*\(",
                code,
            )
        )
        class_count = len(re.findall(r"\bclass\s+[A-Za-z_$][\w$]*", code))
        import_count = len(re.findall(r"^\s*(?:import|export)\b", code, flags=re.MULTILINE))
        try_count = len(re.findall(r"\btry\b", code))
        with_count = 0
        lambda_count = code.count("=>")
        comprehension_count = 0
        global_count = len(re.findall(r"\bwindow\.", code))
    elif language == "css":
        function_count = 0
        class_count = len(re.findall(r"\.[A-Za-z_-][A-Za-z0-9_-]*", code))
        import_count = len(re.findall(r"@import\b", code))
        try_count = 0
        with_count = 0
        lambda_count = 0
        comprehension_count = 0
        global_count = len(re.findall(r":root\b", code))
    elif language == "html":
        function_count = len(re.findall(r"<script\b", code, flags=re.IGNORECASE))
        class_count = len(re.findall(r'\bclass\s*=\s*["\']', code, flags=re.IGNORECASE))
        import_count = len(re.findall(r"<(?:script|link|style)\b", code, flags=re.IGNORECASE))
        try_count = 0
        with_count = 0
        lambda_count = 0
        comprehension_count = 0
        global_count = len(re.findall(r"<html\b", code, flags=re.IGNORECASE))
    else:
        function_count = _count_matching_keywords(lowered_tokens, signals["definition"])
        class_count = 0
        import_count = _count_matching_keywords(lowered_tokens, signals["import"])
        try_count = _count_matching_keywords(lowered_tokens, signals["exception"])
        with_count = _count_matching_keywords(lowered_tokens, signals["with"])
        lambda_count = _count_matching_keywords(lowered_tokens, signals["lambda"])
        comprehension_count = 0
        global_count = 0

    control_keywords = (
        len(signals["loop"]) + len(signals["condition"]) + len(signals["exception"]) + len(signals["definition"])
    )
    activity_count = _count_matching_keywords(lowered_tokens, set().union(*signals.values()))
    heuristic_complexity = activity_count / max(function_count or 1, 1)

    if language == "html":
        block_depth = _estimate_html_depth(code)
    else:
        block_depth = _estimate_delimiter_depth(code)

    return {
        "ast_node_count": float(len(ast_node_type_sequence(code, language))),
        "ast_depth": float(block_depth),
        "function_count": float(function_count),
        "class_count": float(class_count),
        "import_count": float(import_count),
        "try_count": float(try_count),
        "with_count": float(with_count),
        "global_count": float(global_count),
        "lambda_count": float(lambda_count),
        "comprehension_count": float(comprehension_count),
        "docstring_coverage": 0.0,
        "avg_cyclomatic_complexity": float(heuristic_complexity if control_keywords else 0.0),
        "max_cyclomatic_complexity": float(max(heuristic_complexity, block_depth)),
    }


def extract_code_features(code: str, language: str) -> FeatureResult:
    normalized_language = canonicalize_language(language)
    if not normalized_language:
        raise ValueError(f"Unsupported language '{language}'")

    lines = code.splitlines()
    line_count = len(lines)
    char_count = len(code)

    blank_lines = sum(1 for line in lines if not line.strip())
    comment_lines = _count_comment_lines(code, normalized_language)
    avg_line_len = (sum(len(line) for line in lines) / line_count) if line_count else 0.0
    max_line_len = max((len(line) for line in lines), default=0)

    leading_spaces = [len(line) - len(line.lstrip(" ")) for line in lines if line.startswith(" ")]
    indent_mean = sum(leading_spaces) / len(leading_spaces) if leading_spaces else 0.0
    indent_max = max(leading_spaces, default=0)

    tab_count = code.count("\t")
    space_count = code.count(" ")
    trailing_ws = sum(1 for line in lines if line.rstrip() != line)

    tokens = _tokenize_python(code) if normalized_language == "python" else simple_tokenize(code, normalized_language)
    token_count = len(tokens)
    unique_tokens = len(set(tokens))
    top5_ratio = 0.0
    if tokens:
        counts = Counter(token.lower() for token in tokens).most_common(5)
        top5_ratio = sum(count for _, count in counts) / len(tokens)

    keywords_for_language = LANGUAGE_KEYWORDS[normalized_language]
    keyword_token_count = _count_matching_keywords(tokens, keywords_for_language)
    signals = LANGUAGE_SIGNAL_KEYWORDS[normalized_language]
    loop_keyword_count = _count_matching_keywords(tokens, signals["loop"])
    condition_keyword_count = _count_matching_keywords(tokens, signals["condition"])
    definition_keyword_count = _count_matching_keywords(tokens, signals["definition"])
    import_keyword_count = _count_matching_keywords(tokens, signals["import"])
    exception_keyword_count = _count_matching_keywords(tokens, signals["exception"])

    if normalized_language == "python":
        tree = _safe_parse_ast(code)
        identifiers = _extract_identifiers(tree)
        structure_stats = _python_structure_stats(code)
    else:
        identifiers = _extract_generic_identifiers(tokens, normalized_language)
        structure_stats = _generic_structure_stats(code, normalized_language, tokens)

    unique_identifier_ratio = (len(set(identifiers)) / len(identifiers)) if identifiers else 0.0
    ident_entropy = _identifier_entropy(identifiers)

    numeric_literal_count = len(NUMERIC_LITERAL_PATTERN.findall(code))
    string_literal_count = len(STRING_LITERAL_PATTERN.findall(code))
    punctuation_token_count = sum(1 for token in tokens if len(token) == 1 and not token.isalnum() and token != "_")
    punctuation_ratio = (punctuation_token_count / token_count) if token_count else 0.0

    semicolon_count = code.count(";")
    brace_open_count = code.count("{")
    brace_close_count = code.count("}")
    bracket_open_count = code.count("[")
    bracket_close_count = code.count("]")
    paren_open_count = code.count("(")
    paren_close_count = code.count(")")
    angle_bracket_count = code.count("<") + code.count(">")
    block_depth_estimate = _estimate_html_depth(code) if normalized_language == "html" else _estimate_delimiter_depth(code)

    markup_tag_count = len(HTML_TAG_PATTERN.findall(code)) if normalized_language == "html" else 0
    css_selector_count = len(CSS_RULE_PATTERN.findall(code)) if normalized_language == "css" else 0

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
        "keyword_token_count": float(keyword_token_count),
        "loop_keyword_count": float(loop_keyword_count),
        "condition_keyword_count": float(condition_keyword_count),
        "definition_keyword_count": float(definition_keyword_count),
        "import_keyword_count": float(import_keyword_count),
        "exception_keyword_count": float(exception_keyword_count),
        "identifier_entropy": float(ident_entropy),
        "unique_identifier_ratio": float(unique_identifier_ratio),
        "numeric_literal_count": float(numeric_literal_count),
        "string_literal_count": float(string_literal_count),
        "punctuation_ratio": float(punctuation_ratio),
        "semicolon_count": float(semicolon_count),
        "brace_open_count": float(brace_open_count),
        "brace_close_count": float(brace_close_count),
        "bracket_open_count": float(bracket_open_count),
        "bracket_close_count": float(bracket_close_count),
        "paren_open_count": float(paren_open_count),
        "paren_close_count": float(paren_close_count),
        "angle_bracket_count": float(angle_bracket_count),
        "block_depth_estimate": float(block_depth_estimate),
        "markup_tag_count": float(markup_tag_count),
        "css_selector_count": float(css_selector_count),
        "top5_token_ratio": float(top5_ratio),
    }
    feature_dict.update(structure_stats)

    for supported_language in SUPPORTED_LANGUAGES:
        feature_dict[f"language_is_{supported_language}"] = 1.0 if normalized_language == supported_language else 0.0

    names = list(feature_dict.keys())
    values = [feature_dict[name] for name in names]
    return FeatureResult(feature_names=names, values=values, language=normalized_language)


def extract_features_from_file(path: str | Path, language: str | None = None) -> FeatureResult:
    file_path = Path(path)
    detected_language = canonicalize_language(language) or infer_language_from_path(file_path)
    code = file_path.read_text(encoding="utf-8")
    return extract_code_features(code, detected_language)
