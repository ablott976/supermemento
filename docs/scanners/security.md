# Security Scanner

Analyze the codebase for security vulnerabilities. Focus on:

1. **SQL Injection**: Raw SQL queries without parameterization
2. **Authentication/Authorization**: Missing auth checks on endpoints, hardcoded secrets, tokens in code
3. **Input Validation**: Unvalidated user input, missing sanitization
4. **CORS/CSRF**: Misconfigured CORS policies, missing CSRF protection
5. **Dependencies**: Known vulnerable packages (check requirements.txt/pyproject.toml)
6. **Secrets**: API keys, passwords, tokens committed to code (not in .env)
7. **File Upload**: Unrestricted file uploads, path traversal
8. **Error Handling**: Stack traces exposed to users, verbose error messages in production

For each issue found, create a GitHub issue with:
- Label: `security`, `scanner`
- Title: `[SECURITY] <brief description>`
- Body: file path, line numbers, vulnerability type, suggested fix
- Priority: p1 (critical), p2 (high), p3 (medium)

Only report real, actionable vulnerabilities. Do NOT report theoretical issues or best-practice suggestions.
