def process_data(data):
    result = []
    for item in data:
        if isinstance(item, int):
            if item % 2 == 0:
                result.append(item)
            else:
                continue
        else:
            try:
                value = int(item)
                if value % 2 == 0:
                    result.append(value)
            except Exception:
                pass
    return result
