def transform(values):
    output = []
    for value in values:
        if isinstance(value, str):
            value = value.strip()
        try:
            output.append(int(value))
        except Exception:
            continue
    return output
