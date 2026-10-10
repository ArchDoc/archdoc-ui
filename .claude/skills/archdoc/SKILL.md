---
name: archdoc
description: Use at the start of every coding task in a repository that has an .archdoc/ directory, before searching or reading code. Finds where the change belongs in the architecture model and what it affects (consumers, actors, journeys, owners, rules). Also use when adding, moving, or connecting components, to keep the model up to date.
---

# Working in a repository with an ArchDoc model

`.archdoc/` holds the architecture the team agreed on: who uses the system (actors), what it's made of (elements, each mapped to code paths), and how people use it (journeys). People own it. It's the fastest way to find where code lives and what a change affects, so start with it, before you grep.

## Start here, before you search the code

1. **Find where the change belongs.** Call `archdoc_search` with a few words for the area, such as `cli command` or `refund approval`. Without MCP, run `archdoc search <words>`. You get the elements involved and their code paths, so you know which files to read.
2. **Check the impact.** Call `archdoc_impact` on the element, or on the files you plan to change or create. Without MCP, run `archdoc impact <element-or-path> --json`. You get what depends on it, the affected journeys and actors (critical first), owners, and the rules that mention it.
3. **Say what it affects.** Name the affected journeys and actors when you share your plan. Ask the user first if a critical journey is involved or the change would break a rule.

`archdoc_locate` tells you which element owns any file, including files that don't exist yet.

## While you edit

- Stay inside the element boundaries you found. If the change needs code in one element to depend on another element and the model doesn't declare that relationship (`uses`), say so. Don't add the dependency silently.

## After you edit

1. **Check for drift.** Call `archdoc_check` with base `main` (or the branch you started from). Without MCP, run `archdoc check --base main`. Fix what it reports as introduced by your change: imports the model doesn't declare, broken rules, broken journeys, and stale code paths. If a new dependency isn't intended, remove the import.
2. **Propose what's intended.** If your change adds a component, or a dependency the model doesn't declare, and that's intended, call `archdoc_propose` with the additions and a one-line rationale. It adds them to `.archdoc/` as suggestions, keeps the files' formatting, writes a note to `.archdoc/proposals/`, and refuses anything that changes what's there or wouldn't validate. Try it with `dryRun: true` first if you're unsure.
3. **Edit the model by hand for the rest.** `archdoc_propose` only adds. When you remove, rename, or move a package, service, or module, or move code so an element's `code:` paths no longer match, edit `.archdoc/` in the same change, and mark what you add as a suggestion so a person reviews it:

```yaml
uses:
  billing:
    description: Sends invoice events
    provenance: { source: suggested, by: agent:claude-code }
```

Then call `archdoc_validate` (or run `archdoc validate`) and `archdoc_check` again.

## In the PR description

Add a short **Architecture** section that names the elements you touched, the affected journeys and actors, and the model changes you suggested, so a person accepts or rejects them. `archdoc report --base main` writes it for you; `archdoc_diff` with base `main` lists the model changes.
