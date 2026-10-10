---
name: archdoc
description: Use before changing code in a repository that has an .archdoc/ directory. Finds where the files you're about to edit sit in the architecture model and what the change affects (consumers, actors, journeys, owners, rules), and keeps the model up to date when you add, move, or connect components.
---

# Working in a repository with an ArchDoc model

`.archdoc/` holds the architecture the team agreed on: who uses the system (actors), what it's made of (elements, mapped to code paths), and how people use it (journeys). People own it. Your job is to work inside it, say what your change affects, and propose model changes rather than make them silently.

## Before you edit

1. **Locate.** Call `archdoc_locate` with every file you plan to change or create. Without MCP, run `archdoc locate <paths...> --json`.
2. **Check the impact.** Call `archdoc_impact` on those files or their elements. Without MCP, run `archdoc impact <path-or-element> --json`.
3. **Read what comes back.** It lists who uses the element, which actors and journeys the change affects (critical ones first), who owns it, and the rules that mention it.
4. **Tell the user** which journeys and actors are affected before a large change, and ask first if a critical journey is involved or if the change would break a rule.

## While you edit

- Stay inside the element boundaries you located. If the change needs code in one element to depend on another element and the model doesn't declare that relationship (`uses`), say so. Don't add the dependency silently.

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
