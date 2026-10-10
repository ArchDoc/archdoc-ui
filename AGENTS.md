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

- If you added, moved, or removed a component, or added a dependency between components, update `.archdoc/` in the same change. Mark additions with `provenance: { source: suggested, by: agent:<your-name> }` so a person reviews them.
- Run `pnpm -s archdoc validate --strict` and fix what it reports.
- In the PR description, list the affected journeys and actors.

The MCP server is configured in `.mcp.json` and runs from the build, so run `pnpm build` first.

## Build and test

- Node 22.12+ and pnpm 10. `pnpm install`, then `pnpm build`.
- Before pushing: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm -s archdoc validate --strict`.
- `@archdoc/core` stays deterministic: no LLM calls, no network. CLI, MCP, the explorer, and the Action are thin layers over core. MCP, the explorer, and the Action never depend on each other; the CLI serves the explorer and starts MCP, and the Action runs the CLI.
- Add a changeset (`pnpm changeset`) for changes to published packages. Commit messages follow Conventional Commits.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more.
