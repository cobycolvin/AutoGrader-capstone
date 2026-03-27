"""
AI Grading Service
------------------
Uses the Anthropic Claude API to grade student submissions against a rubric.

For each RubricCriterion, Claude is asked to:
  - Award points (0 to max_points)
  - Write a short comment explaining the score

Returns a structured result that the grading endpoint saves as RubricScore rows.
"""

import json
import os

import anthropic

_client = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is not set in environment variables.")
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


def grade_submission(submission_content: str, assignment_title: str, criteria: list[dict]) -> list[dict]:
    """
    Grade a student submission against rubric criteria using Claude.

    Args:
        submission_content: The student's submitted text (code or essay).
        assignment_title:   The title of the assignment.
        criteria:           List of dicts with keys: id, name, max_points.

    Returns:
        List of dicts with keys: criterion_id, points_awarded, comment.
    """
    criteria_text = "\n".join(
        f"- Criterion {i+1}: \"{c['name']}\" (max {c['max_points']} points)"
        for i, c in enumerate(criteria)
    )

    prompt = f"""You are an expert programming instructor grading a student submission.

Assignment: {assignment_title}

Rubric Criteria:
{criteria_text}

Student Submission:
```
{submission_content}
```

Grade this submission for EACH criterion. Return ONLY a valid JSON array — no explanation, no markdown.
Each object must have exactly these keys:
  - "criterion_index": integer (0-based index matching the criteria list above)
  - "points_awarded": number (between 0 and the criterion's max_points, decimals allowed)
  - "comment": string (1-2 sentences explaining the score)

Example format:
[
  {{"criterion_index": 0, "points_awarded": 8.5, "comment": "Good implementation but missing edge case handling."}},
  {{"criterion_index": 1, "points_awarded": 5, "comment": "Clear variable names and consistent formatting."}}
]
"""

    client = _get_client()
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()

    # Strip markdown code fences if Claude wraps output
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    grades = json.loads(raw)

    results = []
    for item in grades:
        idx = item["criterion_index"]
        if idx < len(criteria):
            results.append({
                "criterion_id": criteria[idx]["id"],
                "points_awarded": float(item["points_awarded"]),
                "comment": item.get("comment", ""),
            })

    return results
