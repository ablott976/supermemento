# Performance Scanner

Analyze the codebase for performance issues. Focus on:

1. **N+1 queries**: Loops that execute a DB query per iteration instead of batch/join
2. **Missing indexes**: Queries filtering on columns without database indexes
3. **Unbounded queries**: SELECT without LIMIT on potentially large tables
4. **Missing caching**: Repeated expensive computations or API calls without caching
5. **Synchronous blocking**: Blocking I/O in async contexts (sync HTTP calls in async handlers)
6. **Large payloads**: Endpoints returning full objects when only a subset is needed
7. **Missing pagination**: List endpoints without pagination support

For each issue found, create a GitHub issue with:
- Label: `performance`, `scanner`
- Title: `[PERF] <brief description>`
- Body: file path, specific code pattern, expected impact, suggested fix
- Priority: p2 (user-facing slowness), p3 (optimization opportunity)

Only report measurable performance problems. Do NOT suggest premature optimizations.
