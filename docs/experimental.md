# Experimental

These features work and are tested, but they're left out of `archdoc --help`, the main docs, and the first release's promises until we know how people use them. They may change without a major version. The reasons are in [the MVP plan](./revival/07-mvp-plan.md).

| Feature | What's hidden | Still works |
|---|---|---|
| [Sharing models across repos](#sharing-models-across-repos) | `sync`, `publish`, `landscape build`, and `view --landscape` are left out of `--help` | Every command, and cross-repo findings in `check`, `context`, `show`, and the PR report for repos that already use `imports` |
| [Simulation](#simulation) | `show <journey> --sample`, the `sample` input of `archdoc_show`, and the explorer's "Try a sample" are gone | `simulate()` in `@archdoc/core`, with its tests |
| [Decision rules](#decision-rules) | Nothing yet: whether they stay stable is an open decision | `logic:`, `decides:`, `branches:`, and `mappings:` validate, diff, and show in the PR report |

## Sharing models across repos

Each repo owns its namespace and models its own part. When it depends on another team's repo, it imports that repo's model and refers to its elements by namespace:

```yaml
# .archdoc/archdoc.yaml in the rides repo
namespace: rides
imports:
  payments: { github: acme/payments, version: ^5 }
elements:
  api-gateway:
    kind: container
    uses:
      payments.charges: { description: Asks for a refund, via: proto/charges.proto }
```

`archdoc sync` reads each import's model at the newest release tag its range allows (`v5.2.0`, read straight from git, so private repos work with the credentials you already have) and vendors it in `.archdoc/vendor/`, pinned in `.archdoc/archdoc.lock`. Commit both: `check`, the explorer, MCP, and CI then work offline and reproducibly, and taking a new release shows up as a diff in review. From then on, `validate` and `check` report references into other repos that don't exist at the pinned version, deprecated targets, contracts (`via`) the target doesn't `provide`, journey steps that start in another repo but don't follow its relationships, and imports built against a different major version than yours.

A repo also learns who uses *it* from the landscape: the repo that imports every team's model and adds enterprise actors and cross-team journeys. Point at it with `landscape: { github: acme/architecture, version: ^1 }` and `archdoc sync` brings it with every model it pins. Then `archdoc context`, `archdoc show`, and the MCP tools list consumers and journeys in other repos, and the pull request report says which consumers a change breaks (an element they use is removed, or a contract they use `via`) before it merges.

The landscape repo itself runs `archdoc landscape build`. It composes every repo's model into one (each repo a system, its elements inside), checks journeys that cross teams, owners (every team must be defined somewhere), and its rules across repos, and writes the explorer as a static site for GitHub Pages; `archdoc view --landscape` shows the same thing live. The explorer groups the landscape by repo, team, or domain, and marks where a journey crosses from one repo into another. The landscape also defines `domains:` for grouping, and its rules marked `scope: org` run in every repo that imports it, just as its teams resolve owners there. [`integrations/landscape-template`](../integrations/landscape-template) is a starting point, with a workflow that takes every team's newest release weekly and publishes the site.

`archdoc sync --update` moves to the newest allowed release, and `archdoc sync --frozen` checks the lock in CI. `archdoc publish` writes a validated, versioned bundle (`dist/payments@5.2.0.json`) for repos that import it by `url:`. [`examples/org`](../examples/org) is a demo org of four repos that import each other.

## Simulation

Simulation runs a journey on sample records without running anything: the branch each decision takes and why, the records each step creates and changes, and the tables they land in. It needs the decision rules and mappings below.

For now the CLI, the MCP tools, and the explorer don't run journeys: the explorer shows each step's message by its fields, and a journey's rows from what its steps declare (`creates:` and `changes:`). `simulate()` stays in `@archdoc/core`, tested on [`examples/experimental`](../examples/experimental) and across the repos in [`examples/org`](../examples/org), so turning it back on starts in `apps/web/src/App.tsx`.

## Decision rules

`logic:` blocks say how an element decides on the data it receives, as [CEL](https://cel.dev) rules; journey steps name the decision they take (`decides:`) and what each outcome does (`branches:`); `mappings:` say how one record becomes another, field by field. `validate` checks they read fields that exist, parse, and cover every case, and the PR report shows a changed rule before and after. [`examples/experimental/decisions.yaml`](../examples/experimental/decisions.yaml) shows them.

Whether they stay in the stable model format is an open decision in [the MVP plan](./revival/07-mvp-plan.md#open-decisions).
