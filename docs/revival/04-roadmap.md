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

- [ ] `@archdoc/spec`: Zod schema for v2 with:
  - `actors` (person, role, team, organization, agent)
  - `elements` (kinds, hierarchy, `uses`, `code`, `status`, `provenance`)
  - `journeys`
  - `namespace` and an `imports:` block. Federation tooling comes in Phase 4, but global identity is designed in now.
  - a minimal `data` section (entities with fields) and `sends` on relationships. Mappings, logic, and simulation come in Phase 5, but data references are designed in now.
  - Generated JSON Schema.
  - `archdoc migrate` from v1 (`users` → `actors`, `components` → `elements`).
- [ ] `@archdoc/core`: multi-file loader, reference resolution, diagnostics with file and line, `query.element` / `query.actor` / `usedBy` (including "which actors use me").
- [ ] Journey validation: every step must follow a declared relationship.
- [ ] `archdoc validate`, `archdoc view --watch` (no fixed port; live reload).
- [ ] `apps/web`: Vite + React 19 + xyflow 12 + ELK. Includes:
  - compound nodes, expand/collapse
  - actor view ("what does this team use and own?")
  - journey view (step-through highlight)
  - focus mode, search, resizable details panel, center on select
- [ ] Migrate `examples/*.yaml`. Port the v0 ranking tests as layout regression fixtures, including the orphan-node and no-deps-user cases from the assessment.
- [ ] **Dogfood:** write `.archdoc/` for ArchDoc itself, starting from [`archdoc.v2.example.yaml`](./archdoc.v2.example.yaml).

**Exit:** `npx @archdoc/cli view` renders a 3-level model of ArchDoc with its actors, and steps through at least one journey. v1 files migrate cleanly.

## Phase 2: Code mapping + MCP (M) ⭐ first "AI-first" milestone

- [ ] `codemap.resolve`: files per element, unmapped files, stale globs. `archdoc locate`, `archdoc impact` (including affected actors and journeys).
- [ ] `@archdoc/mcp`: `overview`, `get_element`, `get_actor`, `journey`, `locate`, `impact`, `validate` (read-only tools first).
- [ ] `integrations/agent-skills`: Claude Code skill and AGENTS.md snippet with the pre-flight/post-flight workflow.
- [ ] Explorer code panel: mapped files, plus GitHub/`vscode://` links and code entry points per journey step.

**Exit:** in this repo, an agent asked to "add a command to the CLI" calls `locate` and `impact` first, without being told, because of the skill or snippet. It can say which actors and journeys the change affects. A human can click any box and land in its code.

## Phase 3: Diff, drift, and the PR loop (M–L) ⭐ the "driver seat" milestone

- [ ] `diff(modelA, modelB)` + `archdoc diff` (text, json, markdown, mermaid outputs), covering actors and journeys as well as elements.
- [ ] Analyzer plugin API. First analyzers: workspace/package manifests and TS/JS import graph (dependency-cruiser).
- [ ] `check`: undeclared dependency, rule violation, broken journey, stale mapping, orphan element. `rules.yaml`.
- [ ] `integrations/github-action`: architectural-impact PR comment (elements, owners, **affected journeys and actors**, drift), configurable warn or fail.
- [ ] MCP write tools: `check`, `diff`, `propose` (writes `suggested` provenance and a proposal note).
- [ ] Explorer diff mode (base vs. head overlay, suggested = dashed, affected journeys highlighted).

**Exit:** on this repo's own PRs, the Action posts an accurate architectural-impact comment that names the affected journeys. An agent-introduced cross-package import that the model doesn't declare is flagged.

## Phase 4: Multi-repo federation (M–L) ⭐ the "enterprise" milestone

- [ ] `archdoc publish`: versioned, validated model bundle. Default target is a release asset on a git tag. Static URL and OCI are options.
- [ ] `imports:` resolution, `archdoc sync`, and `archdoc.lock` (pinned, offline-friendly, reproducible in CI).
- [ ] Cross-repo reference checks: dangling, deprecated, or version-skewed references.
- [ ] Element `provides:` (OpenAPI, AsyncAPI, topics), so cross-repo relationships can target contracts.
- [ ] Landscape repo template:
  - `archdoc landscape build` composes all namespaces into one enterprise site
  - enterprise actors and teams
  - cross-team journeys
  - org-wide rules
  - grouping by business domain
- [ ] Cross-repo impact:
  - The PR comment lists consumers and journeys in other repos.
  - The MCP `impact` tool reads the landscape from the lockfile or a cached bundle.
- [ ] Explorer landscape view: group by repo, team, or domain. Journeys animate across repo boundaries.

**Exit:** a demo org of at least 3 repos plus a landscape repo. A PR that changes a contract in one repo lists its consumers and affected journeys in the other repos *before* merge. After release, a consumer repo's `check` flags the reference that no longer resolves.

## Phase 5: Data (M–L) ⭐ the "what actually happens" milestone

- [ ] Spec: `data` entities, messages, and events with fields, `classification`, and lifecycle `states`. `stores:` maps tables and collections to entities. `sends` / `accepts` / `returns` / `carries` attach data to relationships and contracts.
- [ ] Schema importers (as analyzers): SQL migrations, Prisma, TypeORM, OpenAPI/JSON Schema components, Protobuf, Avro. Schema-drift findings in `check`.
- [ ] `mappings:` with CEL field expressions, which give field-level lineage across tables, datastores, and repos. `archdoc lineage <entity.field>`.
- [ ] `logic:` blocks: decisions on request data written as CEL rules, linked to the implementing code.
- [ ] Journey data annotations (`sends`, `decides`, `branches`, `creates`, `changes`) and `archdoc simulate <journey> --sample <file>`.
- [ ] Checks:
  - classification rules (for example, PCI only stored in `payments`, PII not sent to external elements)
  - invalid state transitions
  - steps that send data the target doesn't accept
  - broken mappings
- [ ] MCP: `archdoc_data`, `archdoc_lineage`, `archdoc_simulate`.
- [ ] PR comment: changed fields, mappings, logic thresholds, and classification flows.
- [ ] Explorer:
  - data view (entities and where they're stored)
  - field lineage graph
  - journey data timeline with a sample-request simulator

**Exit:** for *Refund a fare*, the explorer shows which branch a sample request takes, which records are created or changed at each step, and which tables they land in across `payments` and `trips`. A PR that starts sending a PII field to an external element is flagged.

## Phase 6: Bootstrap + interoperability (M)

- [ ] `archdoc init --from-code`: run analyzers and emit a draft model where every fact is `inferred`. Ship an agent prompt or skill to refine names and descriptions and to draft actors, journeys, mappings, and logic blocks, all marked `suggested`.
- [ ] More analyzers: docker-compose, Kubernetes, OpenAPI, Python and Go imports (community-friendly issues).
- [ ] Importers: LikeC4, Structurizr DSL/JSON (including multi-workspace). Exporters: Mermaid, LikeC4.
- [ ] Explorer "review inbox": accept or reject `suggested` and `inferred` facts, writing YAML back.

**Exit:** a stranger can point ArchDoc at a mid-sized open-source TS monorepo and get a reviewable draft model in minutes.

## Phase 7: Learning experience (M)

- [ ] Tours (`tours/*.yaml`, or generated from journeys, including their data timelines) + explorer stepper + MCP `tour` resource. Agent drafts tours, human reviews.
- [ ] Level-of-detail zoom down to files. Glossary popovers. "Explain this element / journey" prompt templates exposed via MCP prompts.
- [ ] Onboarding by team: "start here" pages built from what a team owns and uses.
- [ ] Published static site: `archdoc build --site` + GitHub Pages recipe.
- [ ] Optional "Ask" panel in the explorer that uses the user's own LLM key (Decision 3c).

**Exit:** a new contributor to ArchDoc completes the "How ArchDoc works" tour and makes their first PR without asking the maintainer for orientation.

## Phase 8: Reach (ongoing)

- VS Code extension: architecture tree view, "reveal file in architecture", CodeLens on mapped entry points.
- Observed usage: check journeys against OpenTelemetry traces and surface undocumented paths. Compare simulated data paths with traced ones.
- Data catalog bridges: export lineage to OpenLineage-compatible tools. Import column lineage from data platforms (Decision 9c).
- Optional hosted registry for published bundles (Decision 8c).
- Docs site: Docusaurus 3 (or Starlight), spec pages generated from the JSON Schema, a relaunch blog post.
- Community: spec governance (RFC process for spec changes), analyzer plugin registry, showcase models.

---

## Suggested first slice

If you want a single end-to-end proof that the mission works before committing to the whole plan, build a **thin vertical slice** on ArchDoc's own repo:

1. A v2 model of ArchDoc with actors, one journey, `code:` globs, and a namespace (Phase 1, minimal).
2. `archdoc locate` / `impact` exposed via MCP, with impact naming the affected journey (Phase 2, read-only).
3. `archdoc diff` + `check` for undeclared dependencies on TS imports, run in a GitHub Action comment (Phase 3, narrow).

No UI work is required for the slice. The existing v0 viewer, or a Mermaid export in the PR comment, is enough to show the loop. If the slice feels valuable in daily AI-assisted work, the rest of the roadmap is justified. Multi-repo and data come next. Because namespaces and data references exist in the schema from the start, both are purely additive.
