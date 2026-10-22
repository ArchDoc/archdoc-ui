# Agent integrations

ArchDoc is most useful when your coding agent starts each task with the architecture: it finds where a change belongs and what it affects before it searches the code. The workflows are the same in every agent: a change (context, edit code and model, check, seal), a bug (context on the error, then a trace), and a repository with no model (init, describe it, check).

## Claude Code

Install the plugin from [`integrations/claude-plugin`](../claude-plugin). It brings the skill and the MCP server, pinned to the CLI version released with it:

```
/plugin marketplace add ArchDoc/archdoc
/plugin install archdoc@archdoc
```

The skill is [`claude-plugin/skills/archdoc/SKILL.md`](../claude-plugin/skills/archdoc/SKILL.md). To set a repository up without the plugin, copy that folder to `.claude/skills/archdoc/` and [`mcp/claude-code.mcp.json`](./mcp/claude-code.mcp.json) to `.mcp.json`.

## Cursor, Codex, and other agents

1. Paste [`AGENTS.md`](./AGENTS.md) near the top of your repository's `AGENTS.md`. Codex, Cursor, Copilot, and others read it.
2. Register the MCP server, which runs `npx -y @archdoc/cli mcp` in the repository:
   - **Cursor:** copy [`mcp/cursor.mcp.json`](./mcp/cursor.mcp.json) to `.cursor/mcp.json`.
   - **Codex:** add it to `~/.codex/config.toml`:
     ```toml
     [mcp_servers.archdoc]
     command = "npx"
     args = ["-y", "@archdoc/cli", "mcp"]
     ```
   - **Anything else with MCP:** a stdio server with that command. Without MCP, the agent can run the CLI: each tool is a command of the same name, with `--format json` where it needs structure.

## MCP tools

One tool per question. Every tool reloads the model on every call, and the CLI command of the same name prints the same answer. All of them are read-only except `archdoc_seal`, which writes only `.archdoc/archdoc.sum`, and `archdoc_init`, which writes `.archdoc/` only when there's none.

| Tool | Answers |
|---|---|
| `archdoc_context` | Where do I start, and what does it affect? For a task in words or the files to change (even ones that don't exist yet): files and functions to open first, other callers of the same functions, data, rules, journeys, tests, owners, and who uses it, other repos included. For an error: the journey steps it showed up in, and a trace to start from. With nothing: an overview |
| `archdoc_show` | What is this one thing? An element (with its code), actor, journey, data entry, `Entry.field` (lineage), trace, or a sealed fact |
| `archdoc_check` | What's wrong or stale? Model problems, undeclared imports, broken rules and journeys, stale paths, traces, and facts whose sealed code changed, each with its fix. With `base`, only what the change caused, and the verdict the PR comment will give; `format: "markdown"` returns that comment |
| `archdoc_seal` | Record that the facts you checked still describe their code, and say what's left |
| `archdoc_init` | Start a model in a repository without one, every fact marked inferred |

For pull requests, see the [GitHub Action](../github-action).
