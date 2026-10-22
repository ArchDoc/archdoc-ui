# ArchDoc for Claude Code

Architecture your AI agents can read, and your PRs can't quietly break.

```
/plugin marketplace add ArchDoc/archdoc
/plugin install archdoc@archdoc
```

The plugin brings two things:

- **The `archdoc` skill** ([`skills/archdoc/SKILL.md`](./skills/archdoc/SKILL.md)): Claude starts each task from the repository's model in `.archdoc/`, edits the model with the code, and checks and seals before it's done. For a bug, it places the error and writes a trace. In a repository with no model, it starts one.
- **The MCP server** ([`.mcp.json`](./.mcp.json)): `archdoc_context`, `archdoc_show`, `archdoc_check`, `archdoc_seal`, and `archdoc_init`, from `@archdoc/cli` at the version released with this plugin. It runs in the repository Claude Code is open in, through `npx`, so it needs Node 22.12 or later.

To start, open a repository and ask: "Start an architecture model for this repository." Then, on any task, Claude reads the model first.

The plugin's version and the CLI it runs move together: `pnpm version-packages` runs [`scripts/sync-plugin.mjs`](../../scripts/sync-plugin.mjs), and a test fails if they drift. The marketplace is [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) at the repository root. Check both with `claude plugin validate .` and `claude plugin validate integrations/claude-plugin`.
