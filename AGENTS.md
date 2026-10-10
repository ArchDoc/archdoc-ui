# Working on ArchDoc

ArchDoc models its own architecture in `.archdoc/`. Use it the way ArchDoc asks every user's agent to.

## Architecture model (ArchDoc): start here

This repository's architecture is modeled in `.archdoc/`: actors (who uses the system), elements (what it's made of, each mapped to code paths), and journeys (how actors reach their goals). People own the model. It's the fastest way to find where code lives and what a change affects, so use it before you search the code.

At the start of every coding task, before grepping or reading files:

1. Find where the change belongs: the `archdoc_search` MCP tool with a few words (for example "cli command"), or `pnpm -s archdoc search <words>`. It returns the elements involved and their code paths.
2. Check what the change affects: `archdoc_impact` on the element or the files you'll change, or `pnpm -s archdoc impact <element-or-path>`. It lists what depends on them, the affected journeys and actors (most important first), owners, and rules.
3. Name the affected journeys and actors when you share your plan. Ask the user before changing a critical journey.

`archdoc_locate` (or `pnpm -s archdoc locate <paths>`) tells you which element owns any file, including files you're about to create.

After editing:

- Check for drift: the `archdoc_check` MCP tool with base "main", or `pnpm -s archdoc check --base main`. Fix what it reports as introduced by your change: imports the model doesn't declare, broken rules, broken journeys, stale code paths. If a new dependency isn't intended, remove the import.
- If you added a component or a dependency between components on purpose, add it to `.archdoc/` as a suggestion: `archdoc_propose` does this without touching anything else, or edit the files and mark additions with `provenance: { source: suggested, by: agent:<your-name> }`. Update `.archdoc/` by hand in the same change if you moved or removed a component.
- Elements in other repos are referenced by namespace (`payments.charges`). To depend on a new repo, add it to `imports` in `archdoc.yaml` and run `pnpm -s archdoc sync`. Never edit `.archdoc/archdoc.lock` or `.archdoc/vendor/` by hand.
- In the PR description, list the affected journeys and actors and the model changes you suggested. `pnpm -s archdoc report --base main` writes this for you.

The MCP server is configured in `.mcp.json` and runs from the build, so run `pnpm build` first.

## Build and test

- Node 22.12+ and pnpm 10. `pnpm install`, then `pnpm build`.
- Before pushing: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm -s archdoc validate --strict`.
- `@archdoc/core` stays deterministic: no LLM calls, no network. CLI, MCP, the explorer, and the Action are thin layers over core. MCP, the explorer, and the Action never depend on each other; the CLI serves the explorer and starts MCP, and the Action runs the CLI.
- Add a changeset (`pnpm changeset`) for changes to published packages. Commit messages follow Conventional Commits.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more.
