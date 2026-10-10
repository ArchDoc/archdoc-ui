---
"@archdoc/core": minor
"@archdoc/cli": minor
"@archdoc/analyzers": minor
"@archdoc/mcp": patch
---

Diff, drift, and the pull request loop. `@archdoc/core` adds a semantic model diff (`diffModels`), models at any git ref (`loadModelAtRef`), `check` (undeclared dependencies, `deny` and `allow-only` rules, stale code paths, orphan elements), and the pull request impact report. The new `@archdoc/analyzers` package finds workspace manifest dependencies and TS/JS imports. The CLI adds `archdoc check [--base]`, `archdoc diff [range]`, and `archdoc report --base`. `@archdoc/mcp` drops an unused dependency on `@archdoc/spec`.
