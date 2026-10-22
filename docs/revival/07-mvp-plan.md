# 07 — MVP plan: what has to be true before the first release

v2 has most of what Phases 0–5 of the [roadmap](./04-roadmap.md) describe, and parts of 6 and 7. None of it is released. Every package is at `0.0.0`, there's no release workflow, and every way in (the MCP config, the agent skill, the GitHub Action) runs `npx -y @archdoc/cli`, which doesn't exist yet.

This plan replaces the remaining roadmap phases with a release checklist. It comes from a review on 2026-10-21 that ran the CLI, the playground, and the PR report on this repo's own PRs, on the playground's scenario branches, and on simulated everyday changes.

Status: `[ ]` to do, `[~]` in progress, `[x]` done.

## Decisions (2026-10-21)

| Decision | Chosen | Instead of |
|---|---|---|
| Languages at launch | Multi-language: TS/JS plus at least Python and Go | TS/JS first (supersedes Decision 6 in [README.md](./README.md#decisions)) |
| Federation (`sync`, `publish`, `landscape`, `imports`) | Experimental; stays in the code, leaves the main docs, lands after the release | A release requirement |
| Simulation (`show --sample`, "Try a sample", samples) | Hidden until we know it's a feature people use | Shipped as stable |
| Tours, onboarding pages, the Ask panel | Cut from the release | Phase 7 as planned |
| Agent plugin (revised 2026-10-22) | In this repo: the marketplace at the root (`.claude-plugin/marketplace.json`), the plugin in `integrations/claude-plugin/`, so the skill has one copy and the plugin is versioned with the CLI | Its own repo, with the skill copied over on release |
| The PR comment | Only posts when there's a finding | Posts whenever a PR touches mapped code |
| Languages (2026-10-22) | Python and Go import analyzers and symbol indexes, next to TS/JS | Other languages first |
| Decision rules (2026-10-22) | Experimental, with mappings and simulation | Stable |
| How "experimental" shows (2026-10-22) | The JSON Schema and docs mark the fields; `validate` prints a note naming them, which doesn't fail `--strict` or reach the PR comment | A warning per use |

| Tagline (2026-10-22) | "Architecture your AI agents can read, and your PRs can't quietly break." | "An architecture control plane for AI-assisted development", "Software system modeling for the AI age" |

## Open decisions

- **First version number.** `0.x` keeps room to change the format; `1.0` promises it.

## 1. Release pipeline

- [x] Own the `@archdoc` npm scope. The `archdoc` org owns it; 0.1.0 of all six packages was published by hand on 2026-10-21.
- [x] A Changesets release workflow that stages `spec`, `core`, `analyzers`, `federation`, `mcp`, and `cli` with trusted publishing and provenance, for a maintainer to approve (`release.yml`, `scripts/release.mjs`). Each package's trusted publisher allows staged publishing only.
- [x] Build from clean (`pnpm clean` removes every output), so a deleted source file's `.js` can't ship again (0.1.0 shipped a stale `dist/commands/data.js`).
- [x] Turn the pending changesets into the first release's notes (0.1.0's changelogs).
- [x] A CI step that packs every package, installs the tarballs into an empty project, and runs the CLI (`validate`, an `mcp` initialize handshake, and `site`, which needs the bundled explorer): `pnpm smoke`.
- [x] The first release through the workflow, to confirm `npm stage publish` works from CI the way it does in the docs. 0.1.1 and 0.3.0 were staged from CI and approved.

**Exit:** on a clean machine, `npx -y @archdoc/cli mcp` starts the server and `npx -y @archdoc/cli view` opens the explorer.

## 2. Repo name and the Action's address

- [x] Rename `ArchDoc/archdoc-ui` to `ArchDoc/archdoc`. Done: pushes to the old name redirect. Update local remotes with `git remote set-url origin https://github.com/ArchDoc/archdoc.git`.
- [ ] Tag the Action `v1`, and have its docs use `@v1` instead of `@main`.

## 3. Freeze the model format

- [x] List each field as stable or experimental ([docs/experimental.md](../experimental.md#the-model-format)):
  - **Stable:** `actors`, `elements` (`code`, `uses`, `stores`, `provides`), `journeys` (`steps`, `sends`, `creates`, `changes`), `data` (`fields`, `classification`, `references`, `source`, `states`), `rules`, `provenance`, and the trace format.
  - **Experimental:** `imports`, `landscape`, `domains`, `scope: org` rules, `mappings`, and the decision rules (`logic`, `decides`, `branches`).
- [x] Mark experimental fields in the JSON Schema (their descriptions start "Experimental") and docs; `validate` prints a note naming the ones a model uses (`experimentalUses` in core).
- [x] Publish the JSON Schema at a stable URL for editors: `https://cdn.jsdelivr.net/npm/@archdoc/spec@0/schema/archdoc.v2.schema.json`, which serves the newest 0.x from npm.

## 4. Hide simulation

- [x] Remove `show --sample` from the CLI and `archdoc_show`.
- [x] In the explorer, remove "Try a sample" and stop running journeys: steps show their messages' fields, and Rows show only what steps declare (`creates:`, `changes:`). The ERD view stays. Simulation is switched off in one place, `apps/web/src/App.tsx`.
- [x] Stop loading `*.sample.json` and `samples/` in `archdoc view` and `archdoc site`.
- [x] Keep `simulate` in core with its tests, so it can come back. The cross-repo simulation test now calls core directly.
- [x] Move `examples/decisions.yaml` and both samples to `examples/experimental/`.

## 5. Make federation experimental

- [x] Hide `sync`, `publish`, `landscape`, and `view --landscape` from `--help`, with a note after the command list, and one page for everything experimental: [`docs/experimental.md`](../experimental.md).
- [x] Lead the README and website without federation; the playground and demo org say they show an experimental feature.
- [x] Cross-repo findings keep working for repos that already use `imports` (the landscape tests still pass).
- [x] `context` lists journeys in other repos that pass through what a path touches (`journeysElsewhere` in the brief), as `impact` did.

## 6. Cut the CLI surface

- [x] Remove the aliases kept "for a release" that never happened: `search`, `locate`, `impact`, `lineage`, `simulate`, `verify`, and `trace anchor`, `trace check`, `trace show`.
- [x] Hide maintainer commands from `--help`: `eval`, `migrate`.

**Exit:** `archdoc --help` lists `init`, `context`, `show`, `check`, `seal`, `validate`, `view`, `site`, `map`, `diff`, `report`, `trace list`, `mcp`, and `schema`, plus the experimental group.

## 7. Multi-language analysis

- [x] Import analyzers for Python and Go behind the existing plugin API (`python.ts`, `go.ts`), so undeclared dependencies and rule violations are found the way they are for TS/JS. Python resolves through project roots (`src/`, each `pyproject.toml`), packages, and relative imports, and marks `if TYPE_CHECKING:` imports type-only; Go resolves through every `go.mod`, `replace` lines, and `go.work`.
- [x] A symbol index for the same languages, so `context` ranks files and functions there and seals fingerprint their exports. Core counts `_test.go`, `test_*.py`, and `*_test.py` as tests.
- [x] `init` adds uses from those imports, splits a flat Go module or Python project by its packages, and skips a `pyproject.toml` that only declares a workspace.

**Exit:** on one Python and one Go repository, `check --base` flags an undeclared import introduced on a branch, and `eval` recall is within reach of what it is on TS/JS.

Met on 2026-10-22:

| Repository | `init` | Undeclared import on a branch | `eval` recall (Start here) |
|---|---|---|---|
| [golang-gin-realworld-example-app](https://github.com/gothinkster/golang-gin-realworld-example-app) (Go, one module) | 3 packages, the 3 uses between them | ⛔ `common` → `articles` | 92% (18%) |
| [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) (FastAPI + React, uv workspace) | frontend, emails, the backend, Postgres | ⛔ `store` → `api`, after splitting the backend into 3 components by hand | 51% (4%) |
| ArchDoc (TS) | | | 42% (23%) |

Both are `init` models with no descriptions or journeys (the template's backend split into 3 components), so recall is wide rather than sharp: on the template, most recent commits are dependency bumps and frontend changes with subjects `context` can't place. §10 picks this up with described models.

Known gaps: Go package names are guessed from the import path (as `goimports` does), not read from the `package` clause; Python's dynamic imports, `sys.path` changes, and package-dir mappings aren't followed.

## 8. Make the PR comment worth reading

What the review found:

| Change | Verdict today | Worth reading? |
|---|---|---|
| A code change imports another part of the system against a rule | ⛔ blocking, short | Yes |
| The model sends personal data to an external service | ⛔ blocking | Yes |
| A migration renames a column classified as personal data | ⛔ blocking | Yes |
| A one-line comment edit in `packages/core` | ⚠️ comment posted, 104 lines | No |
| ArchDoc's own PR #38 | ⚠️ 227 lines, 11 of 11 journeys "affected" | Mostly not |

`comment: quiet` only skips the comment when the verdict is `none`, and touching code that a critical journey passes through is already "attention". With 261 of 354 files mapped in this repo, nearly every PR gets a comment, so the blocking ones get skipped too.

- [x] Comment only when there's a finding. Touching a critical journey alone is `info`: job summary, no comment.
- [x] No "Before merging" checklist by default. Owners only when the change spans more than one team; critical journeys only when the model changed their steps.
- [x] Show each finding once: the folds list only findings not shown above, the Data fold drops its callout and the data entries Model changes already lists, and what Before merging asks about isn't repeated under To check.
- [x] When an undeclared dependency also breaks a rule, report one finding whose fix is to remove the import or change the rule, never "add it to uses". (A rule that's only a warning keeps both, so the error isn't hidden.)
- [x] Copy fixes:
  - the `seal/changed` sentence ("The code contract proto/charges.proto of charges points at changed since it was sealed");
  - "Touches no code the model maps" on a PR that changed a mapped contract;
  - `type string → undefined` in data changes when a schema field is removed;
  - suggested facts as a list, not one sentence joined by semicolons.
- [~] Measure: replay the last 50 merged PRs of a repository and count how many would get a comment and how many would block, then read every block for false positives (`pnpm replay-prs [repo] --show`). Run it on this repo and the repos in §10. A starting target: under 20% of PRs get a comment, and every block is real.
  - **This repo (2026-10-22), 27 PRs with a model:** 56% would have got a comment. On 8 of the 15, the only item was facts an agent suggested, so suggested facts are now listed in the report but no longer earn a comment on their own: 37%, 2 blocks (7%). Both blocks are real: #19 and #20 added components and imports between them without declaring the uses. The other 8 change a critical journey's steps (3) or add journeys whose steps don't say what they send (5), which `check` flags today but didn't when they were written. Nearly every PR here rewrites the model, so it's a poor baseline; the §10 repos decide whether 20% holds.

**Exit:** a body-only code change posts nothing, and on the scenarios that stay in the release (personal data to an external service, a renamed classified column, an undeclared import, a changed sealed contract) the comment's top fits on one screen.

## 9. Agent plugin

- [x] A Claude Code plugin marketplace in this repo (`.claude-plugin/marketplace.json`), with one plugin (`integrations/claude-plugin/`): the skill (a change, a bug, start a model) and an MCP config pinned to the CLI released with it. `claude plugin validate` passes both. Install: `/plugin marketplace add ArchDoc/archdoc`, then `/plugin install archdoc@archdoc`.
- [x] The skill has one copy, in the plugin; this repo's `.claude/skills/archdoc` must match it, and the plugin's version and CLI pin must match the CLI's (`integrations/agent-skills/test/sync.test.ts`). `pnpm version-packages` and `set-version` run `scripts/sync-plugin.mjs`. *(The release workflow has to call `pnpm version-packages` instead of `pnpm changeset version` for this; a maintainer edits the workflow.)*
- [x] The first run is `init`. On 2026-10-22, the plugin installed from this repo, in a fresh clone of golang-gin-realworld-example-app with no `.archdoc/`, given "This repository has no architecture model yet. Start one, so that archdoc check passes.", allowed only the ArchDoc tools and file edits: 13 turns, 36 seconds, a model with 4 elements, their uses, an actor, and a critical journey with code on each step, all marked suggested. `archdoc check` passes it (0 errors, 4 warnings: the steps don't say what they send, which the agent left rather than guess).
- [x] Document the MCP config and `AGENTS.md` snippet for Cursor, Codex, and other agents (`integrations/agent-skills/README.md`).

**Exit:** on a fresh machine, someone installs the plugin, opens a repository without `.archdoc/`, and ends the session with a model that passes `archdoc check`, without cloning ArchDoc. *Met in a container, except that the marketplace was added from a local clone; `/plugin marketplace add ArchDoc/archdoc` works once this merges to main.*

## 10. Prove it outside this repo

- [ ] Pick 3–5 repositories of different shapes: a TS monorepo, a Python service, a Go service, and one with a Prisma or SQL schema.
- [ ] On each: `init`, describe it with an agent, `check` until clean, `eval`, and the PR replay from §8. Write down what failed.
- [ ] Fix what blocks a first model; document the rest.

## 11. ArchDoc's own model

- [ ] Accept or reject the 65 facts still marked `provenance: suggested` (47 in `model/toolchain.yaml`, 17 in `data.yaml`, 1 in `actors.yaml`) and the open proposal in `.archdoc/proposals/`. *(a person decides)*
- [x] Remove the planned `onboard-contributor` journey, since tours are cut. `new-contributor` stays as someone who reads the explorer.

## 12. Website

- [~] One tagline across the README, the website, and the plugin: "Architecture your AI agents can read, and your PRs can't quietly break." README and plugin done; the website is next.
- [ ] A landing page that tells the 30-second story: the agent's brief before it edits, and the PR comment that blocks a personal-data leak. Its demo is a real explorer built with `archdoc site`, not screenshots. Installing means the plugin.
- [ ] Docs for the stable surface; one experimental page for federation and simulation.
- [ ] Archive `versioned_docs/version-1.0.0` (v0) so search and the version menu don't lead there.

## Not in the release

- Tours, onboarding pages by team, and the Ask panel (Phase 7).
- LikeC4 and Structurizr importers, and the explorer's review inbox (Phase 6).
- Everything in Phase 8.
- Federation and simulation, which stay in the code as experimental.

## Order

1. §1 and §2 first: nothing can be installed until they're done.
2. §3–§6 next: shrink the surface before people depend on it.
3. §7 and §8 in parallel.
4. §9 and §10 together: the outside repos are where the plugin's first run gets tested.
5. §11, then §12 last, so the website describes what actually ships.

## Done when

A developer who has never seen ArchDoc installs the plugin, models a Python or TypeScript repository in one session, and on their next pull request gets a comment only if the change breaks a rule or sends sensitive data somewhere new.
