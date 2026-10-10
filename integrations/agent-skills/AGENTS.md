<!-- Paste this into your repository's AGENTS.md (read by Codex, Cursor, Copilot, and others). -->

## Architecture model (ArchDoc)

This repository's architecture is modeled in `.archdoc/`: actors (who uses the system), elements (what it's made of, mapped to code paths), and journeys (how actors reach their goals). People own the model.

Before editing code:

1. Find where the files sit: `archdoc locate <paths...> --json`, or the `archdoc_locate` MCP tool.
2. Check the impact: `archdoc impact <path-or-element> --json`, or `archdoc_impact`. Note the affected journeys, actors, owners, and rules.
3. Before a large change, tell the user which journeys and actors it affects. Ask first if a critical journey is involved.

After editing:

- If you added, moved, or removed a component, or added a dependency between components, update `.archdoc/` in the same change. Mark additions with `provenance: { source: suggested, by: agent:<your-name> }` so a person reviews them.
- Run `archdoc validate` and fix what it reports.
- In the PR description, list the affected journeys and actors.
