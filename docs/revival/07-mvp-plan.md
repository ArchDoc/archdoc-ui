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
| Agent plugin | Its own repo, as the way people install ArchDoc; skill text stays in `integrations/agent-skills/` and the release copies it over | Skill text maintained in the plugin repo |
| The PR comment | Only posts when there's a finding | Posts whenever a PR touches mapped code |

## Open decisions

- **Decision rules (`logic:`, `decides:`, `branches:`).** They power simulation, but they're also a review finding on their own ("Changes the decision refund-approval" in the playground). Stable, or experimental with simulation?
- **Which languages.** Python and Go are the proposal. Each needs an import analyzer and a symbol index.
- **One tagline.** The README says "architecture control plane for AI-assisted development"; the newer framing is "software system modeling for the AI age". The README, the website, and the plugin should say the same thing.
- **How "experimental" shows in the model format.** Proposal: the JSON Schema and docs mark the fields, and `validate` warns when a model uses one.
- **First version number.** `0.x` keeps room to change the format; `1.0` promises it.

## 1. Release pipeline

- [ ] Own the `@archdoc` npm scope. *(needs a maintainer)*
- [ ] A Changesets release workflow that publishes `spec`, `core`, `analyzers`, `federation`, `mcp`, and `cli` with npm provenance.
- [ ] Turn the pending changesets into the first release's notes.
- [ ] A CI job that packs the CLI and runs the packed copy (`archdoc validate`, `archdoc mcp` handshake, `archdoc view` serving the bundled explorer), so a missing file in `files:` fails before a release does.

**Exit:** on a clean machine, `npx -y @archdoc/cli mcp` starts the server and `npx -y @archdoc/cli view` opens the explorer.

## 2. Repo name and the Action's address

- [x] Rename `ArchDoc/archdoc-ui` to `ArchDoc/archdoc`. Done: pushes to the old name redirect. Update local remotes with `git remote set-url origin https://github.com/ArchDoc/archdoc.git`.
- [ ] Tag the Action `v1`, and have its docs use `@v1` instead of `@main`.

## 3. Freeze the model format

- [ ] List each field as stable or experimental. Proposal:
  - **Stable:** `actors`, `elements` (`code`, `uses`, `stores`, `provides`), `journeys` (`steps`, `sends`, `creates`, `changes`), `data` (`fields`, `classification`, `references`, `source`, `states`), `rules`, `provenance`, and the trace format.
  - **Experimental:** `imports`, `landscape`, `domains`, `scope: org` rules, `mappings`, and the decision rules (pending the open decision).
- [ ] Mark experimental fields in the JSON Schema and docs; `validate` warns when a model uses one.
- [ ] Publish the JSON Schema at a stable URL for editors.

## 4. Hide simulation

- [ ] Remove `show --sample` from the CLI and `archdoc_show`.
- [ ] In the explorer, remove "Try a sample" and the rows a journey writes. The ERD view stays.
- [ ] Stop loading `*.sample.json` and `samples/` in `archdoc view` and `archdoc site`.
- [ ] Keep `simulate` in core with its tests, so it can come back.
- [ ] Move `examples/decisions.yaml` and its sample out of the quickstart path.

## 5. Make federation experimental

- [ ] Move `sync`, `publish`, and `landscape` under `archdoc experimental` (or hide them from `--help`), with one docs page for all of them.
- [ ] Lead the README and website without federation; the playground's cross-repo scenarios say they show an experimental feature.
- [ ] Cross-repo findings keep working for repos that already use `imports`.
- [ ] `context` lists journeys in other repos that pass through what a path touches. `impact` did; `context` names the other repos' consumers but not their journeys.

## 6. Cut the CLI surface

- [x] Remove the aliases kept "for a release" that never happened: `search`, `locate`, `impact`, `lineage`, `simulate`, `verify`, and `trace anchor`, `trace check`, `trace show`.
- [x] Hide maintainer commands from `--help`: `eval`, `migrate`.

**Exit:** `archdoc --help` lists `init`, `context`, `show`, `check`, `seal`, `validate`, `view`, `site`, `map`, `diff`, `report`, `trace list`, `mcp`, and `schema`, plus the experimental group.

## 7. Multi-language analysis

- [ ] Import analyzers for Python and Go behind the existing plugin API, so undeclared dependencies and rule violations are found the way they are for TS/JS. Today only `ts-imports.ts` exists, so `check`'s strongest finding does nothing outside TS/JS.
- [ ] A symbol index for the same languages, so `context` ranks files and functions there and seals fingerprint their exports.
- [ ] `init` adds uses from those imports (it already reads `go.mod` and `pyproject.toml`).

**Exit:** on one Python and one Go repository, `check --base` flags an undeclared import introduced on a branch, and `eval` recall is within reach of what it is on TS/JS.

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
- [ ] Measure: replay the last 50 merged PRs of a repository and count how many would get a comment and how many would block, then read every block for false positives. Run it on this repo and the repos in §10. A starting target: under 20% of PRs get a comment, and every block is real.

**Exit:** a body-only code change posts nothing, and on the scenarios that stay in the release (personal data to an external service, a renamed classified column, an undeclared import, a changed sealed contract) the comment's top fits on one screen.

## 9. Agent plugin

- [ ] A new repo that is a Claude Code plugin marketplace: one plugin with the skills (a change, a bug, start a model) and an MCP config pinned to the CLI version it was tested with.
- [ ] The release workflow copies the skill text from `integrations/agent-skills/` into the plugin repo, so the sync test keeps covering it.
- [ ] The first run is `init`: from install to a model that `archdoc check` passes, in one session.
- [ ] Document the MCP config and `AGENTS.md` snippet for Cursor, Codex, and other agents.

**Exit:** on a fresh machine, someone installs the plugin, opens a repository without `.archdoc/`, and ends the session with a model that passes `archdoc check`, without cloning ArchDoc.

## 10. Prove it outside this repo

- [ ] Pick 3–5 repositories of different shapes: a TS monorepo, a Python service, a Go service, and one with a Prisma or SQL schema.
- [ ] On each: `init`, describe it with an agent, `check` until clean, `eval`, and the PR replay from §8. Write down what failed.
- [ ] Fix what blocks a first model; document the rest.

## 11. ArchDoc's own model

- [ ] Accept or reject the 65 facts still marked `provenance: suggested` (47 in `model/toolchain.yaml`, 17 in `data.yaml`, 1 in `actors.yaml`) and the open proposal in `.archdoc/proposals/`. *(a person decides)*
- [ ] Remove the planned `onboard-contributor` journey, since tours are cut.

## 12. Website

- [ ] One tagline (see open decisions) across the README, the website, and the plugin.
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
