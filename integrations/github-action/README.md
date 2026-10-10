# ArchDoc GitHub Action

Shows reviewers what a pull request means for the architecture, before they merge. On every pull request, it:

1. Posts one comment (and keeps it up to date) with:
   - a diagram of the change: the elements it touches and the model changes, colored added, changed, or removed, with suggested facts dotted and unchanged neighbors in grey
   - a sequence diagram of each of the most important affected journeys, with the steps that pass through the change highlighted
   - the elements the change touches, and their owners
   - the journeys and actors it affects, critical ones first
   - what changed in the model, and facts suggested by agents that need a person's review
   - drift the change introduced: imports the model doesn't declare, and broken rules
2. Writes the same report to the job summary.
3. Fails the job when the pull request introduces drift (configurable). Drift that was already there doesn't fail it.

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
| `comment` | `true` | Post and update the pull request comment |
| `command` | `npx -y @archdoc/cli` | How to run ArchDoc, such as `node packages/cli/dist/bin.js` for a local build |
| `github-token` | `github.token` | Token used to comment |

Pull requests from forks get a read-only token, so the comment step is skipped there; the job summary still has the report.

## What counts as "introduced"

A finding is introduced by the pull request when a file behind it changed, for example the file with an undeclared import. Rule and journey findings also count when the pull request changes the model. Everything else is listed as already there, folded away, and doesn't fail the job.
