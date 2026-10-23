---
"@archdoc/cli": patch
---

The Claude Code plugin's skill tells the agent to use the MCP tools, not the CLI: the server starts through `npx` and can take a few seconds, so the tools may not be listed yet or may be listed by name only, and the agent should search for them and wait rather than run `archdoc` in a shell. The CLI is for when no ArchDoc MCP server is configured. The skill also stops offering `archdoc_show` with `sample`, which 0.4.0 removed.
