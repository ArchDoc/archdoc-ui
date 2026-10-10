# Agent integrations

ArchDoc is most useful when your coding agent starts each task with the architecture: it finds where a change belongs and what it affects before it searches the code. This folder has what you need to set that up:

| File | What it's for |
|---|---|
| [`claude-code/archdoc/SKILL.md`](./claude-code/archdoc/SKILL.md) | A Claude Code skill with the workflow: search, check impact, edit, check drift, propose model changes |
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

Every tool reloads the model on every call. All of them are read-only except `archdoc_propose`, which only adds.

| Tool | Answers |
|---|---|
| `archdoc_search` | Where does this live? Elements, actors, and journeys for a few words, with code paths |
| `archdoc_overview` | What is this system? Actors, elements, journeys |
| `archdoc_locate` | Which element owns these files? |
| `archdoc_impact` | What does changing this affect? Consumers, actors, journeys, owners, rules |
| `archdoc_get_element` | Everything about one element |
| `archdoc_get_actor` | What an actor uses, owns, and takes part in |
| `archdoc_journey` | The steps of a journey, with code entry points |
| `archdoc_validate` | Is the model valid? Problems with file and line |
| `archdoc_check` | Did my change drift? Undeclared imports, broken rules and journeys, stale paths; with `base`, what the change introduced |
| `archdoc_diff` | What changed in the model since a ref? |
| `archdoc_propose` | Add elements and relationships as suggestions (`provenance: suggested`) with a rationale note in `.archdoc/proposals/`. Additions only: it never changes or removes what's there, never edits another repo's namespace, and writes nothing if the result wouldn't validate. `dryRun` checks without writing |

For pull requests, see the [GitHub Action](../github-action).
