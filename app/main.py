"""Main application module."""


def hello_world() -> str:
    """Return hello world string."""
    return "Hello, World!"


def main() -> None:
    """Run main application."""
    print(hello_world())


if __name__ == "__main__":
    main()
