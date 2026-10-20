---
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/federation": minor
"@archdoc/spec": minor
"@archdoc/cli": minor
"@archdoc/mcp": patch
---

A PR comment you can trust, and that tells a reviewer what to do.

- `loadRevision` (analyzers) builds the model at any ref the way the working tree is built: schema sources, other repos' models pinned at that commit, and the repository's files. `report`, `diff`, MCP's `archdoc_diff`, and the explorer use it, so a field whose type comes from a schema no longer shows as changed on every pull request.
- `check --base` checks the merge base too, and marks a finding introduced only when the base didn't have it. A one-line model edit is no longer blamed for warnings already on main.
- `summarizeChange` (core) is one verdict on a change: blocking, attention, info, or none, with what blocks the merge and how to fix it, what to check, and who to involve. The PR comment and the explorer's Changes tab both render it.
- The PR comment leads with that verdict, then blocking issues, a Before merging checklist, and a diagram of only what changed; journeys, consumers, data, drift, model changes, and findings already on the base fold. A change with no architectural impact gets one line.
- Journey diagrams draw the steps after a decision as `alt / else` blocks with the decision's conditions.
- A changed decision touches the element it runs in and the journeys, here and in other repos, that decide with it.
- Bundles carry what the model's schema sources say (`schemas`), so a repo that imports another sees its field types.
- `check --format github` prints workflow annotations; `report --explorer-url` links the change in the explorer; `archdoc site` writes the explorer as a static site, opened on a change with `--base`.
