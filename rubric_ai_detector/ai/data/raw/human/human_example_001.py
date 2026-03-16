"""Simple utility module written by a student."""

def count_even_numbers(values: list[int]) -> int:
    """Return the number of even items in a list."""
    total = 0
    for value in values:
        if value % 2 == 0:
            total += 1
    return total


if __name__ == "__main__":
    nums = [1, 2, 3, 4, 10]
    print(count_even_numbers(nums))
