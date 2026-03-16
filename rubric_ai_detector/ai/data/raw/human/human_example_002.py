def normalize_scores(scores):
    total = sum(scores)
    if total == 0:
        return [0 for _ in scores]
    return [s / total for s in scores]
