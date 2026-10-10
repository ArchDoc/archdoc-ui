---
"@archdoc/core": minor
"@archdoc/cli": minor
"@archdoc/mcp": minor
---

Code mapping and the MCP server. `@archdoc/core` adds `locate` (which element owns a path, most specific first), `resolveCodeMap` (files per element, unmapped files, stale code paths), and `impact` (consumers, affected actors and journeys ranked by importance, owners, and rules), with shared text and JSON reports. The CLI adds `archdoc locate`, `archdoc impact`, `archdoc map`, and `archdoc mcp`. The new `@archdoc/mcp` package serves read-only tools for coding agents over stdio. The explorer's details panel links each element to its code on GitHub and in VS Code.
