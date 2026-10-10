<!-- Paste this near the top of your repository's AGENTS.md (read by Codex, Cursor, Copilot, and others). -->

## Architecture model (ArchDoc): start here

This repository's architecture is modeled in `.archdoc/`: actors (who uses the system), elements (what it's made of, each mapped to code paths), and journeys (how actors reach their goals). People own the model. It's the fastest way to find where code lives and what a change affects, so use it before you search the code.

At the start of every coding task, before grepping or reading files:

1. Find where the change belongs: the `archdoc_search` MCP tool with a few words (for example "cli command"), or `archdoc search <words>`. It returns the elements involved and their code paths.
2. Check what the change affects: `archdoc_impact` on the element or the files you'll change, or `archdoc impact <element-or-path>`. It lists what depends on them, the affected journeys and actors (most important first), owners, and rules.
3. Name the affected journeys and actors when you share your plan. Ask the user before changing a critical journey.

`archdoc_locate` (or `archdoc locate <paths>`) tells you which element owns any file, including files you're about to create.

After editing:

- If you added, moved, or removed a component, or added a dependency between components, update `.archdoc/` in the same change. Mark additions with `provenance: { source: suggested, by: agent:<your-name> }` so a person reviews them.
- Run `archdoc check --base main` and fix what it reports as introduced by your change: imports the model doesn't declare, broken rules, broken journeys, stale code paths. Declare a new dependency in the model (as a suggestion) only if it's intended; otherwise remove the import.
- In the PR description, list the affected journeys and actors. `archdoc report --base main` writes this for you.
