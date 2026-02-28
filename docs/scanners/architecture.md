# Architecture Scanner

Analyze the codebase for architectural issues and code quality problems. Focus on:

1. **Circular imports**: Modules importing each other, causing ImportError at runtime
2. **God files**: Single files with >500 lines that should be split
3. **Dead code**: Functions/classes never imported or called anywhere
4. **Inconsistent patterns**: Mixed approaches to the same problem (e.g., some endpoints use dependency injection, others don't)
5. **Missing abstractions**: Duplicated logic that should be extracted into shared utilities
6. **Wrong layer**: Business logic in routes, database queries in views, etc.

For each issue found, create a GitHub issue with:
- Label: `architecture`, `scanner`
- Title: `[ARCH] <brief description>`
- Body: files involved, what's wrong, suggested refactoring approach
- Priority: p2 (blocks development), p3 (technical debt)

Only report structural problems that impact maintainability or cause bugs. Do NOT suggest rewrites for working code.
