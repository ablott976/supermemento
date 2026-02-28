# Tests Scanner

Analyze the codebase to identify missing or inadequate test coverage. Focus on:

1. **Untested endpoints**: API routes without corresponding test functions
2. **Untested business logic**: Core functions/methods without unit tests
3. **Missing edge cases**: Happy path tested but error paths missing (404, 400, 500)
4. **Missing integration tests**: Database operations, external API calls without integration tests
5. **Broken tests**: Test files that import missing modules or reference removed code

For each issue found, create a GitHub issue with:
- Label: `tests`, `scanner`
- Title: `[TESTS] <brief description>`
- Body: what needs testing, which file/function, suggested test approach
- Priority: p2 (important coverage gap), p3 (nice to have)

Focus on the most impactful missing tests first. Do NOT suggest tests for trivial getters/setters or configuration files.
