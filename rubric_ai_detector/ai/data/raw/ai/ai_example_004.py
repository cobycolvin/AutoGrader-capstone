def summarize(nums):
    if not nums:
        return {"min": None, "max": None, "avg": 0}
    minimum = min(nums)
    maximum = max(nums)
    average = sum(nums) / len(nums)
    return {"min": minimum, "max": maximum, "avg": average}
