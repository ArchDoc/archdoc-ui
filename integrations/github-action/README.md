# ArchDoc GitHub Action

Shows reviewers what a pull request means for the architecture, before they merge. On every pull request, it:

1. Posts one comment, and keeps it up to date, that leads with a verdict:
   - **⛔ blocking**: errors the change introduces (a broken rule, an import the model doesn't declare) and consumers in other repos it breaks, each with how to fix it and the line it's about
   - **⚠️ to check**: new warnings, sensitive data going somewhere new, a changed decision, consumers elsewhere that may be affected, facts an agent suggested
   - **Before merging**: a checklist of who to involve. Owners approve, other repos' teams know, and critical journeys still work. Boxes reviewers tick stay ticked when the comment updates.
   - **What changed**: a diagram of only the elements and arrows that changed, and a link to the change in the explorer when you set `explorer-url`
   - folded below: the affected journeys as sequence diagrams (with their branches), consumers in other repos, data, drift, model changes, and findings already on the base
2. Stays quiet when a pull request doesn't change the architecture: no new comment (one it posted earlier is updated to say so).
3. Puts the findings the pull request introduces on the lines they're about, in Files changed.
4. Writes the same report to the job summary.
5. Fails the job when the pull request introduces drift (configurable). Drift that was already there doesn't fail it.

## Use it

```yaml
# .github/workflows/archdoc.yml
name: ArchDoc
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  impact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the base commit must be in the checkout
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: ArchDoc/archdoc/integrations/github-action@main
        with:
          fail-on: error # or warning, or never to only comment
```

## Inputs

| Input | Default | What it does |
|---|---|---|
| `base` | the pull request's base commit | What to compare with |
| `model` | `.` | Repository, `.archdoc` directory, or model file |
| `fail-on` | `error` | Fail on introduced findings at this severity or above: `error`, `warning`, or `never` |
| `comment` | `quiet` | `quiet` comments only when the pull request changes the architecture; `true` always; `false` never |
| `annotations` | `true` | Put introduced findings on their lines in Files changed |
| `explorer-url` | | A page that shows this change in the explorer, linked from the comment |
| `site` | `false` | Also write the explorer, opened on this change, to the directory in the `site` output |
| `command` | `npx -y @archdoc/cli` | How to run ArchDoc, such as `node packages/cli/dist/bin.js` for a local build |
| `github-token` | `github.token` | Token used to comment |

Outputs: `report` (the markdown file), `verdict` (`blocking`, `attention`, `info`, or `none`), and `site` (the directory, with `site: true`).

Pull requests from forks get a read-only token, so the comment step is skipped there; the job summary still has the report.

## Link the comment to the explorer

The comment is for deciding; the explorer is for looking around. With `site: true`, the Action writes the explorer as a static site, opened on this change with the same verdict and findings. Host it anywhere, and pass where it will be as `explorer-url`. For example, with a Pages site for previews:

```yaml
      - uses: ArchDoc/archdoc/integrations/github-action@main
        id: archdoc
        with:
          site: true
          explorer-url: https://acme.github.io/archdoc-previews/${{ github.event.number }}/#changes
      # Publish ${{ steps.archdoc.outputs.site }} to that path with your usual deploy step.
```

`archdoc site --base main --out site` does the same locally.

## What counts as "introduced"

The Action checks the repository at the merge base too, the same way, and a finding is introduced only when the base didn't have it. Everything else is listed as already on the base, folded away, and doesn't fail the job.
