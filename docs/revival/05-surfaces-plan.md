# 05 — Surfaces plan

A review of main after PR #36 found that the model and engine are sound, but every surface (explorer, PR comment, agent tools) shows everything the model knows instead of answering the reader's question, and the surfaces disagree with each other. This plan carries out the review's "Suggested order". Each phase ends with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm -s archdoc validate --strict`, and `archdoc check --base main`.

Status: `[ ]` to do, `[~]` in progress, `[x]` done.

## 1. Trust: every surface tells the truth

The PR report said data changed when it didn't, blamed old warnings on the PR, and the explorer's Changes tab disagreed with both.

- [x] **One way to load a revision.** `loadRevision({ target, cwd, ref? })` in `@archdoc/analyzers` builds the model at the working tree or a commit with what the working tree gets: schema sources applied, other repos' models from the lockfile at that commit, and the file list. `report`, `diff`, MCP `archdoc_diff`, and the view server use it.
- [x] **Introduced findings by comparison.** `checkRepository({ base })` checks the base revision too (its analyzers see changed files as they were at the base) and marks a finding introduced only when the base didn't have it. Uses the merge base, like `report`.
- [x] **One change summary.** `summarizeChange(base, head, …)` in core returns the verdict, blocking items, people to ask, journeys, consumers, data, suggested facts, findings, and counts. `prReport`, the explorer's Changes tab, `diff`, and MCP render it, so totals agree.
- [x] **The explorer compares full revisions.** `view --base` and the branch picker send the base as a full payload (schemas, imports), so the Changes tab shows what the PR comment shows.
- [x] **Typed example data.** Imported entries arrived without the types their schema sources give them, so examples were strings. Bundles now carry those fields (`publish` and `sync` read the schema sources), so the simulator's default run evaluates.
- [x] **Branches drawn as branches.** Journey sequence diagrams group `when:` steps under `alt / else` with the decision's conditions.

## 2. Reviewers: a PR comment that says what to do

- [x] **Verdict first.** One line: blocking, needs attention, or no architectural impact. Then blocking items with how to fix them, then a "Before merging" checklist (owners, other repos' teams, critical journeys), then only the changed edges as a diagram. Everything else folds.
- [x] **Quiet when nothing matters.** No impact: a one-line comment, and the Action doesn't post a new comment at all (it only updates one it already posted).
- [x] **Findings on the diff line.** `archdoc check --format github` prints workflow annotations for introduced findings; the Action runs it, so they appear in Files changed.
- [x] **A link to an interactive view.** `archdoc site --base <ref> --out <dir>` writes the explorer as a static site opened on Changes. The Action takes an `explorer-url` input and links it; its README shows deploying the site per PR.

## 3. Agents: a starting point, measured

- [x] **Symbols and paths in search.** Index exported symbols per file (deterministic, from the TS analyzer) and search file paths and symbol names, not only descriptions. `archdoc_check`-style names split on `_`.
- [x] **`archdoc context <task or paths>`.** One brief: files and symbols to start in (ranked), other callers of the same functions ("does the same job elsewhere"), data, rules, the narrowest affected journeys (those whose step `code:` names the file), tests to run, owners. MCP `archdoc_context`.
- [x] **`archdoc eval`.** Over the 50 commits before this work: 64% recall against 43% for search. Replays recent commits: query each subject through `context` and report how many changed files the brief named (recall) and how many it pointed at. `--min-recall` fails CI.

## 4. Newcomers: an explorer that starts from what people do

- [x] **Overview tab.** The model's description, its journeys as cards (path, steps, repos, decisions), owners. Replaces the count tiles and instructions. Hovering a journey lights it on the map.
- [x] **One level at a time.** The map shows top-level boxes; components appear when a box is opened. Box type shown by shape, not a caps label. Unselected edges stay faint.
- [x] **Journeys as stories.** One view: lanes with steps as rows, decisions and their branches drawn as forks, the current step's detail in the side panel, samples choose the branch. Fits beside the panel.
- [x] **Tabs.** Overview, Journeys, Data, Changes. The sidebar stops being a catalog.
- [x] **Readable labels.** No "· the step says"; provenance in a tooltip.

## 5. Debugging: traces

- [x] **Spec.** A trace document (`.archdoc/traces/*.yaml`, never part of the model): `trace`, `title`, `symptom`, `reproduce`, `expands: <journey>#<step>`, steps in journey step syntax plus `role` (ok, cause, spreads, symptom), `evidence` (reproduced, read, inferred), `observed`/`expected`, `missing`; `works-in`; `fix`.
- [x] **Core.** `checkTrace` (elements, hops, code references, hops the model doesn't declare) and `anchorError(text)` (paths and frames → elements → journey steps, ranked). Deterministic.
- [x] **CLI and MCP.** `archdoc trace check|anchor`, `archdoc_anchor`, `archdoc_trace_check`; the agent skill says when to write one. The PR comment says which traced bug a PR fixes. MCP `archdoc_report` gives agents the comment's verdict before they open a PR.
- [x] **Explorer.** A trace view: the log, the diagnosis, the modeled step with its real hops beneath, cause and missing hops marked, evidence on every claim.

## 6. Polish

- [x] **Tokens.** One type scale and semantic colors (added, changed, removed, breaks; accent only for selection and links) in the explorer; Mermaid classDefs use the same meanings.
- [x] **Glossary.** One term per concept across explorer, CLI, and report ("uses" for connections).
- [x] **Website.** ArchDoc.github.io describes v2.

## Result

On the playground, `report --base main` says "No architectural impact" on main, and each scenario branch gets a verdict the explorer's Changes tab repeats: pii-to-fraud and break-contract are blocking, looser-refunds needs a check, rename-email is blocking. `archdoc eval` over the 50 commits before this work: 62–64% of changed source files named in the brief or under its elements, against 43% for search. This branch's own PR comment says it fixes the bug traced in `report-false-data-changes`.

## Done when

The playground's scenario branches produce a PR comment whose verdict, counts, and journeys match the explorer's Changes tab; `report --base main` on main says there's no impact; `archdoc eval` on this repo beats the 41% baseline; the dogfood model lists the new elements; docs and changesets are updated.
