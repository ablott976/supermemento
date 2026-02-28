# Developer Experience Scanner

Analyze the codebase for developer experience issues. Focus on:

1. **Missing type hints**: Functions without parameter/return type annotations
2. **Incomplete docstrings**: Public functions/classes without documentation
3. **Inconsistent naming**: Mixed naming conventions (snake_case vs camelCase)
4. **Missing .env.example**: Environment variables used but not documented
5. **Setup friction**: Missing or outdated setup instructions in README
6. **Linter/formatter issues**: Code that doesn't pass ruff/black/isort

For each issue found, create a GitHub issue with:
- Label: `dx`, `scanner`
- Title: `[DX] <brief description>`
- Body: what needs improving, files affected, suggested approach
- Priority: p3

Focus on issues that slow down onboarding or cause confusion. Do NOT nitpick style on internal utilities.
