"""Main application module."""


def process_data(data: list[int]) -> list[int]:
    """Process data by doubling each value.

    Args:
        data: List of integers to process.

    Returns:
        List of doubled integers.
    """
    return [x * 2 for x in data]


def main() -> None:
    """Main entry point."""
    data = [1, 2, 3, 4, 5]
    result = process_data(data)
    print(f"Result: {result}")  # noqa: T201


if __name__ == "__main__":
    main()
