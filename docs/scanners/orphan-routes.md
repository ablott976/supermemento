# Orphan Routes Scanner

Analyze the codebase for orphaned or broken routes. Focus on:

1. **Registered but unimplemented**: Routes defined in router/app but handler returns NotImplemented or pass
2. **Implemented but unregistered**: Handler functions that exist but aren't mounted in the app
3. **Broken imports**: Route files that import from modules that don't exist
4. **Duplicate routes**: Same path registered twice with different handlers
5. **Missing middleware**: Routes that should have auth/validation middleware but don't
6. **Dead endpoints**: Routes that reference removed models or services

For each issue found, create a GitHub issue with:
- Label: `orphan-routes`, `scanner`
- Title: `[ROUTES] <brief description>`
- Body: route path, file location, what's wrong, suggested fix
- Priority: p2 (broken functionality), p3 (cleanup)

Only report routes that are actually broken or unreachable. Do NOT flag intentionally stubbed routes marked as TODO.
