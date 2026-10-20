<!-- Paste this near the top of your repository's AGENTS.md (read by Codex, Cursor, Copilot, and others). -->

## Architecture model (ArchDoc): start here

This repository's architecture is modeled in `.archdoc/`: actors (who uses the system), elements (what it's made of, each mapped to code paths), and journeys (how actors reach their goals). People own the model. It's the fastest way to find where code lives and what a change affects, so use it before you search the code.

At the start of every coding task, before grepping or reading files:

1. Find where to start: the `archdoc_context` MCP tool with the task in a few words, the files you plan to change, or both (for example "pr report shows type undefined for data fields"), or `archdoc context <words or paths>`. It returns the files and functions to open first, other code that does the same job (other callers of the functions they use, which a fix usually needs too), the data, rules, and narrowest journeys involved, the tests to run, and owners.
2. Check what the change affects: `archdoc_impact` on the element or the files you'll change, or `archdoc impact <element-or-path>`. It lists what depends on them, the affected journeys and actors (most important first), owners, and rules. With a landscape synced, it also lists who uses them from other repos; ask before removing or renaming anything they use. `archdoc_search` (or `archdoc search <words>`) finds elements, journeys, and files by words when you only need where something lives.
3. Name the affected journeys and actors when you share your plan. Ask the user before changing a critical journey.

`archdoc_locate` (or `archdoc locate <paths>`) tells you which element owns any file, including files you're about to create.

After editing:

- Check for drift: the `archdoc_check` MCP tool with base "main", or `archdoc check --base main`. Fix what it reports as introduced by your change: imports the model doesn't declare, broken rules, broken journeys, stale code paths. If a new dependency isn't intended, remove the import.
- If you added a component or a dependency between components on purpose, add it to `.archdoc/` as a suggestion: `archdoc_propose` does this without touching anything else, or edit the files and mark additions with `provenance: { source: suggested, by: agent:<your-name> }`. Update `.archdoc/` by hand in the same change if you moved or removed a component.
- If the change makes a component send, accept, or store different data, update `data:` and the `sends`, `accepts`, `returns`, or `stores` that name it, and classify sensitive fields (`classification: pii`). Before changing a field, a mapping, or a decision, `archdoc_lineage` and `archdoc_simulate` show where its value goes and which path a request takes. `check` flags data rules, such as personal data sent to an external service.
- Elements in other repos are referenced by namespace (`payments.charges`). To depend on a new repo, add it to `imports` in `archdoc.yaml` and run `archdoc sync`. Never edit `.archdoc/archdoc.lock` or `.archdoc/vendor/` by hand.
- In the PR description, list the affected journeys and actors and the model changes you suggested. `archdoc report --base main` writes this for you.
