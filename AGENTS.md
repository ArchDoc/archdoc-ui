# Working on ArchDoc

ArchDoc models its own architecture in `.archdoc/`. Use it the way ArchDoc asks every user's agent to.

## Architecture model (ArchDoc): start here

This repository's architecture is modeled in `.archdoc/`: actors (who uses the system), elements (what it's made of, each mapped to code paths), and journeys (how actors reach their goals). People own the model. It's the fastest way to find where code lives and what a change affects, so use it before you search the code.

At the start of every coding task, before grepping or reading files:

1. Find where the change belongs: the `archdoc_search` MCP tool with a few words (for example "cli command"), or `pnpm -s archdoc search <words>`. It returns the elements involved and their code paths.
2. Check what the change affects: `archdoc_impact` on the element or the files you'll change, or `pnpm -s archdoc impact <element-or-path>`. It lists what depends on them, the affected journeys and actors (most important first), owners, and rules. With a landscape synced, it also lists who uses them from other repos; ask before removing or renaming anything they use.
3. Name the affected journeys and actors when you share your plan. Ask the user before changing a critical journey.

`archdoc_locate` (or `pnpm -s archdoc locate <paths>`) tells you which element owns any file, including files you're about to create.

When you're asked to explain or fix a bug (a log line, a stack trace, wrong output):

1. Anchor the error: the `archdoc_anchor` MCP tool with the text, or `pnpm -s archdoc trace anchor --file log.txt` (or `-` for stdin). It ranks the journey steps the error most likely showed up in, names the elements its frames and paths map to, and suggests a trace to start from.
2. Follow the code from there, and write the path the failing request actually took to `.archdoc/traces/<id>.yaml`: `expands: <journey>#<step>`, one step per hop with `role` (cause, spreads, symptom) and `evidence` on every step (`reproduced` if you saw it run, `read` if you followed it in the code, `inferred` otherwise), `observed`/`expected` values where they differ, and `missing` for a call that didn't happen. A trace is evidence of one run, not the design: it's never part of the model.
3. Check it: `archdoc_trace_check`, or `pnpm -s archdoc trace check`. Fix unknown elements and stale code references; a hop the model doesn't declare is drift you found while debugging, so mention it.
4. Commit the trace with the fix, so the PR says which bug it fixes.

After editing:

- Check for drift: the `archdoc_check` MCP tool with base "main", or `pnpm -s archdoc check --base main`. Fix what it reports as introduced by your change: imports the model doesn't declare, broken rules, broken journeys, stale code paths. If a new dependency isn't intended, remove the import.
- If you added a component or a dependency between components on purpose, add it to `.archdoc/` as a suggestion: `archdoc_propose` does this without touching anything else, or edit the files and mark additions with `provenance: { source: suggested, by: agent:<your-name> }`. Update `.archdoc/` by hand in the same change if you moved or removed a component.
- If the change makes a component send, accept, or store different data, update `data:` and the `sends`, `accepts`, `returns`, or `stores` that name it, and classify sensitive fields (`classification: pii`). Before changing a field, a mapping, or a decision, `archdoc_lineage` and `archdoc_simulate` show where its value goes and which path a request takes. `check` flags data rules, such as personal data sent to an external service.
- Elements in other repos are referenced by namespace (`payments.charges`). To depend on a new repo, add it to `imports` in `archdoc.yaml` and run `pnpm -s archdoc sync`. Never edit `.archdoc/archdoc.lock` or `.archdoc/vendor/` by hand.
- In the PR description, list the affected journeys and actors and the model changes you suggested. `pnpm -s archdoc report --base main` writes this for you.

The MCP server is configured in `.mcp.json` and runs from the build, so run `pnpm build` first.

## Build and test

- Node 22.12+ and pnpm 10. `pnpm install`, then `pnpm build`.
- Before pushing: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm -s archdoc validate --strict`.
- `@archdoc/core` stays deterministic: no LLM calls, no network. CLI, MCP, the explorer, and the Action are thin layers over core. MCP, the explorer, and the Action never depend on each other; the CLI serves the explorer and starts MCP, and the Action runs the CLI.
- Add a changeset (`pnpm changeset`) for changes to published packages. Commit messages follow Conventional Commits.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more.
