---
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/cli": minor
"@archdoc/mcp": minor
---

Add `archdoc context <words…|paths…>` and the `archdoc_context` MCP tool: a short brief for starting a task, with the files and symbols to open first, other callers of the functions they use ("does the same job elsewhere"), data, rules, the journeys whose steps name the files, tests, and owners. `@archdoc/analyzers` indexes exported symbols and named imports (`indexCode`), and `search` matches file paths and symbol names with it, splitting identifiers on `_`, `-`, and camelCase. `archdoc eval` replays recent commits through `context` and reports recall; `--min-recall` fails below a threshold.
