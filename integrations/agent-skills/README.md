# Agent integrations

ArchDoc is most useful when your coding agent starts each task with the architecture: it finds where a change belongs and what it affects before it searches the code. This folder has what you need to set that up:

| File | What it's for |
|---|---|
| [`claude-code/archdoc/SKILL.md`](./claude-code/archdoc/SKILL.md) | A Claude Code skill with the workflows: a change (context, edit code and model, check, seal), a bug (context on the error, a trace), and a repository with no model (init) |
| [`AGENTS.md`](./AGENTS.md) | The same workflow as a snippet for `AGENTS.md`, read by Codex, Cursor, Copilot, and others |
| [`mcp/claude-code.mcp.json`](./mcp/claude-code.mcp.json) | MCP server config for Claude Code (`.mcp.json` at the repository root) |
| [`mcp/cursor.mcp.json`](./mcp/cursor.mcp.json) | MCP server config for Cursor (`.cursor/mcp.json`) |

## Set up Claude Code

1. Copy `mcp/claude-code.mcp.json` to `.mcp.json` at your repository root.
2. Copy `claude-code/archdoc/` to `.claude/skills/archdoc/`.
3. Optionally, add the `AGENTS.md` snippet to your `CLAUDE.md` or `AGENTS.md` so the workflow is always in context.

## Set up other agents

1. Add the `AGENTS.md` snippet to your repository's `AGENTS.md`.
2. If the agent supports MCP, register `npx -y @archdoc/cli mcp` as a stdio server. Otherwise it can use the CLI with `--json`.

## MCP tools

One tool per question. Every tool reloads the model on every call, and the CLI command of the same name prints the same answer. All of them are read-only except `archdoc_seal`, which writes only `.archdoc/archdoc.sum`, and `archdoc_init`, which writes `.archdoc/` only when there's none.

| Tool | Answers |
|---|---|
| `archdoc_context` | Where do I start, and what does it affect? For a task in words or the files to change (even ones that don't exist yet): files and functions to open first, other callers of the same functions, data, rules, journeys, tests, owners, and who uses it, other repos included. For an error: the journey steps it showed up in, and a trace to start from. With nothing: an overview |
| `archdoc_show` | What is this one thing? An element (with its code), actor, journey (with a sample, simulated), data entry, `Entry.field` (lineage), trace, or a sealed fact |
| `archdoc_check` | What's wrong or stale? Model problems, undeclared imports, broken rules and journeys, stale paths, traces, and facts whose sealed code changed, each with its fix. With `base`, only what the change caused, and the verdict the PR comment will give; `format: "markdown"` returns that comment |
| `archdoc_seal` | Record that the facts you checked still describe their code, and say what's left |
| `archdoc_init` | Start a model in a repository without one, every fact marked inferred |

For pull requests, see the [GitHub Action](../github-action).
