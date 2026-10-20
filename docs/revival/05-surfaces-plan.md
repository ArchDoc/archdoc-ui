# 05 — Surfaces plan

A review of main after PR #36 found that the model and engine are sound, but every surface (explorer, PR comment, agent tools) shows everything the model knows instead of answering the reader's question, and the surfaces disagree with each other. This plan carries out the review's "Suggested order". Each phase ends with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm -s archdoc validate --strict`, and `archdoc check --base main`.

Status: `[ ]` to do, `[~]` in progress, `[x]` done.

## 1. Trust: every surface tells the truth

The PR report said data changed when it didn't, blamed old warnings on the PR, and the explorer's Changes tab disagreed with both.

- [ ] **One way to load a revision.** `loadRevision({ target, cwd, ref? })` in `@archdoc/analyzers` builds the model at the working tree or a commit with what the working tree gets: schema sources applied, other repos' models from the lockfile at that commit, and the file list. `report`, `diff`, MCP `archdoc_diff`, and the view server use it.
- [ ] **Introduced findings by comparison.** `checkRepository({ base })` checks the base revision too (its analyzers see changed files as they were at the base) and marks a finding introduced only when the base didn't have it. Uses the merge base, like `report`.
- [ ] **One change summary.** `summarizeChange(base, head, …)` in core returns the verdict, blocking items, people to ask, journeys, consumers, data, suggested facts, findings, and counts. `prReport`, the explorer's Changes tab, `diff`, and MCP render it, so totals agree.
- [ ] **The explorer compares full revisions.** `view --base` and the branch picker send the base as a full payload (schemas, imports), so the Changes tab shows what the PR comment shows.
- [ ] **Typed example data.** Generated examples respect field types (int, uuid, enum, timestamp…), so the simulator's default run takes the right branch.
- [ ] **Branches drawn as branches.** Journey sequence diagrams group `when:` steps under `alt / else` with the decision's conditions.

## 2. Reviewers: a PR comment that says what to do

- [ ] **Verdict first.** One line: blocking, needs attention, or no architectural impact. Then blocking items with how to fix them, then a "Before merging" checklist (owners, other repos' teams, critical journeys), then only the changed edges as a diagram. Everything else folds.
- [ ] **Quiet when nothing matters.** No impact: a one-line comment, and the Action doesn't post a new comment at all (it only updates one it already posted).
- [ ] **Findings on the diff line.** `archdoc check --format github` prints workflow annotations for introduced findings; the Action runs it, so they appear in Files changed.
- [ ] **A link to an interactive view.** `archdoc site --base <ref> --out <dir>` writes the explorer as a static site opened on Changes. The Action takes an `explorer-url` input and links it; its README shows deploying the site per PR.

## 3. Agents: a starting point, measured

- [ ] **Symbols and paths in search.** Index exported symbols per file (deterministic, from the TS analyzer) and search file paths and symbol names, not only descriptions. `archdoc_check`-style names split on `_`.
- [ ] **`archdoc context <task or paths>`.** One brief: files and symbols to start in (ranked), other callers of the same functions ("does the same job elsewhere"), data, rules, the narrowest affected journeys (those whose step `code:` names the file), tests to run, owners. MCP `archdoc_context`.
- [ ] **`archdoc eval`.** Replays recent commits: query each subject through `context` and report how many changed files the brief named (recall) and how many it pointed at. `--min-recall` fails CI.

## 4. Newcomers: an explorer that starts from what people do

- [ ] **Overview tab.** The model's description, its journeys as cards (path, steps, repos, decisions), owners. Replaces the count tiles and instructions. Hovering a journey lights it on the map.
- [ ] **One level at a time.** The map shows top-level boxes; components appear when a box is opened. Box type shown by shape, not a caps label. Unselected edges stay faint.
- [ ] **Journeys as stories.** One view: lanes with steps as rows, decisions and their branches drawn as forks, the current step's detail in the side panel, samples choose the branch. Fits beside the panel.
- [ ] **Tabs.** Overview, Journeys, Data, Changes. The sidebar stops being a catalog.
- [ ] **Readable labels.** No "· the step says"; provenance in a tooltip.

## 5. Debugging: traces

- [ ] **Spec.** A trace document (`.archdoc/traces/*.yaml`, never part of the model): `trace`, `title`, `symptom`, `reproduce`, `expands: <journey>#<step>`, steps in journey step syntax plus `role` (ok, cause, spreads, symptom), `evidence` (reproduced, read, inferred), `observed`/`expected`, `missing`; `works-in`; `fix`.
- [ ] **Core.** `checkTrace` (elements, hops, code references, hops the model doesn't declare) and `anchorError(text)` (paths and frames → elements → journey steps, ranked). Deterministic.
- [ ] **CLI and MCP.** `archdoc trace check|anchor`, `archdoc_anchor`, `archdoc_trace_check`; the agent skill says when to write one. The PR comment links traces a PR adds.
- [ ] **Explorer.** A trace view: the log, the diagnosis, the modeled step with its real hops beneath, cause and missing hops marked, evidence on every claim.

## 6. Polish

- [ ] **Tokens.** One type scale and semantic colors (added, changed, removed, breaks; accent only for selection and links) in the explorer; Mermaid classDefs use the same meanings.
- [ ] **Glossary.** One term per concept across explorer, CLI, and report ("uses" for connections).
- [ ] **Website.** ArchDoc.github.io describes v2.

## Done when

The playground's scenario branches produce a PR comment whose verdict, counts, and journeys match the explorer's Changes tab; `report --base main` on main says there's no impact; `archdoc eval` on this repo beats the 41% baseline; the dogfood model lists the new elements; docs and changesets are updated.
