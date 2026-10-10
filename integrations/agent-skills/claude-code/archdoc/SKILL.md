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

Update `.archdoc/` in the same change when you:

- add, remove, rename, or move a package, service, or module that is (or should be) an element
- add a dependency between elements that the model doesn't declare
- move code so that an element's `code:` paths no longer match it

Mark what you add as a suggestion, so a person reviews it:

```yaml
uses:
  billing:
    description: Sends invoice events
    provenance: { source: suggested, by: agent:claude-code }
```

Then call `archdoc_validate` (or run `archdoc validate`) and fix any errors it reports.

## In the PR description

Add a short **Architecture** section that names the elements you touched, the affected journeys and actors from `archdoc_impact`, and any model changes you suggested.
