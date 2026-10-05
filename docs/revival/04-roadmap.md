# 04 — Roadmap

Phases are gated by **exit criteria**, not dates. Each phase ships something usable on its own. ArchDoc models itself from Phase 1 onward (`.archdoc/` in this repo). That dogfooding is the main test of the product.

Sizes: **S** ≈ a few focused sessions, **M** ≈ a couple of weeks part-time, **L** ≈ a month or more part-time.

## Phase 0: Reset (S)

- [ ] Tag `v0.2.0` and create a `legacy/v0` branch. Note in the README that v0 is frozen.
- [ ] Decide on the open questions in [README.md](./README.md#decisions-needed).
- [ ] Rename the repo `archdoc-ui` → `archdoc` (optional, GitHub redirects old URLs). Rewrite the README around the new mission.
- [ ] Scaffold the pnpm monorepo, Node 22/24 CI (lint + typecheck + test with `CI=true`), Changesets, CONTRIBUTING, CODE_OF_CONDUCT, and issue templates.
- [ ] Close or relabel issues #3–#6 (carry #5 and #6 into the new UI requirements).

**Exit:** green CI on an empty monorepo, and a README that states the mission.

## Phase 1: Model core + explorer (M)

- [ ] `@archdoc/spec`: Zod schema for v2 (elements, kinds, hierarchy, `uses`, `code`, `status`, `provenance`), generated JSON Schema, `archdoc migrate` from v1.
- [ ] `@archdoc/core`: multi-file loader, reference resolution, diagnostics with file and line, `query.element` / `usedBy`.
- [ ] `archdoc validate`, `archdoc view --watch` (no fixed port; live reload).
- [ ] `apps/web`: Vite + React 19 + xyflow 12 + ELK. Compound nodes, expand/collapse, focus mode, search, resizable details panel, center on select.
- [ ] Migrate `examples/*.yaml`. Port the v0 ranking tests as layout regression fixtures, including the orphan-node and no-deps-user cases from the assessment.
- [ ] **Dogfood:** write `.archdoc/` for ArchDoc itself, starting from [`archdoc.v2.example.yaml`](./archdoc.v2.example.yaml).

**Exit:** `npx @archdoc/cli view` renders a 3-level model of ArchDoc. v1 files migrate cleanly.

## Phase 2: Code mapping + MCP (M) ⭐ first "AI-first" milestone

- [ ] `codemap.resolve`: files per element, unmapped files, stale globs. `archdoc locate`, `archdoc impact`.
- [ ] `@archdoc/mcp`: `overview`, `get_element`, `locate`, `impact`, `validate` (read-only tools first).
- [ ] `integrations/agent-skills`: Claude Code skill and AGENTS.md snippet with the pre-flight/post-flight workflow.
- [ ] Explorer code panel: mapped files and GitHub/`vscode://` links.

**Exit:** in this repo, an agent asked to "add a command to the CLI" calls `locate` and `impact` first, without being told, because of the skill or snippet. A human can click any box and land in its code.

## Phase 3: Diff, drift, and the PR loop (M–L) ⭐ the "driver seat" milestone

- [ ] `diff(modelA, modelB)` + `archdoc diff` (text, json, markdown, mermaid outputs).
- [ ] Analyzer plugin API. First analyzers: workspace/package manifests and TS/JS import graph (dependency-cruiser).
- [ ] `check`: undeclared dependency, rule violation, stale mapping, orphan element. `rules.yaml`.
- [ ] `integrations/github-action`: architectural-impact PR comment, configurable warn or fail.
- [ ] MCP write tools: `check`, `diff`, `propose` (writes `suggested` provenance and a proposal note).
- [ ] Explorer diff mode (base vs. head overlay, suggested = dashed).

**Exit:** on this repo's own PRs, the Action posts an accurate architectural-impact comment. An agent-introduced cross-package import that the model doesn't declare is flagged.

## Phase 4: Bootstrap + interoperability (M)

- [ ] `archdoc init --from-code`: run analyzers and emit a draft model where every fact is `inferred`. Ship an agent prompt or skill to refine names and descriptions, marked `suggested`.
- [ ] More analyzers: docker-compose, Kubernetes, OpenAPI, Python and Go imports (community-friendly issues).
- [ ] Importers: LikeC4, Structurizr DSL/JSON. Exporters: Mermaid, LikeC4.
- [ ] Explorer "review inbox": accept or reject `suggested` and `inferred` facts, writing YAML back.

**Exit:** a stranger can point ArchDoc at a mid-sized open-source TS monorepo and get a reviewable draft model in minutes.

## Phase 5: Learning experience (M)

- [ ] Tours (`tours/*.yaml`) + explorer stepper + MCP `tour` resource. Agent drafts tours, human reviews.
- [ ] Level-of-detail zoom down to files. Glossary popovers. "Explain this element" prompt templates exposed via MCP prompts.
- [ ] Published static site: `archdoc build --site` + GitHub Pages recipe.
- [ ] Optional "Ask" panel in the explorer that uses the user's own LLM key (Decision 3c).

**Exit:** a new contributor to ArchDoc completes the "How ArchDoc works" tour and makes their first PR without asking the maintainer for orientation.

## Phase 6: Reach (ongoing)

- VS Code extension: architecture tree view, "reveal file in architecture", CodeLens on mapped entry points.
- Docs site: Docusaurus 3 (or Starlight), spec pages generated from the JSON Schema, a relaunch blog post.
- Community: spec governance (RFC process for spec changes), analyzer plugin registry, showcase models.

---

## Suggested first slice

If you want a single end-to-end proof that the mission works before committing to the whole plan, build a **thin vertical slice** on ArchDoc's own repo:

1. A v2 model of ArchDoc with `code:` globs (Phase 1, minimal).
2. `archdoc locate` / `impact` exposed via MCP (Phase 2, read-only).
3. `archdoc diff` + `check` for undeclared dependencies on TS imports, run in a GitHub Action comment (Phase 3, narrow).

No UI work is required for the slice. The existing v0 viewer, or a Mermaid export in the PR comment, is enough to show the loop. If the slice feels valuable in daily AI-assisted work, the rest of the roadmap is justified.
