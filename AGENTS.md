# Working on ArchDoc

ArchDoc models its own architecture in `.archdoc/`. Use it the way ArchDoc asks every user's agent to.

## Architecture model (ArchDoc)

This repository's architecture is modeled in `.archdoc/`: actors (who uses the system), elements (what it's made of, mapped to code paths), and journeys (how actors reach their goals). People own the model.

Before editing code:

1. Find where the files sit: the `archdoc_locate` MCP tool, or `pnpm -s archdoc locate <paths...> --json`.
2. Check the impact: `archdoc_impact`, or `pnpm -s archdoc impact <path-or-element> --json`. Note the affected journeys, actors, owners, and rules.
3. Before a large change, tell the user which journeys and actors it affects. Ask first if a critical journey is involved.

After editing:

- If you added, moved, or removed a component, or added a dependency between components, update `.archdoc/` in the same change. Mark additions with `provenance: { source: suggested, by: agent:<your-name> }` so a person reviews them.
- Run `pnpm -s archdoc validate --strict` and fix what it reports.
- In the PR description, list the affected journeys and actors.

The MCP server is configured in `.mcp.json` and runs from the build, so run `pnpm build` first.

## Build and test

- Node 22.12+ and pnpm 10. `pnpm install`, then `pnpm build`.
- Before pushing: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm -s archdoc validate --strict`.
- `@archdoc/core` stays deterministic: no LLM calls, no network. CLI, MCP, and the explorer are thin layers over core, and none of them depends on another, except the CLI serving the explorer and starting the MCP server.
- Add a changeset (`pnpm changeset`) for changes to published packages. Commit messages follow Conventional Commits.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more.
