def build_map(items):
    result = {}
    for i, item in enumerate(items):
        if item in result:
            result[item] = result[item] + 1
        else:
            result[item] = 1
    return result
