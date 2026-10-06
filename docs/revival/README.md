# ArchDoc Revival: Review & Strategy

A review of the existing ArchDoc codebase (`archdoc-ui` + `ArchDoc.github.io`) and a proposed path to re-architect it around the new mission:

> **ArchDoc is an interactive software modeling platform that empowers engineers to understand the systems AI is modifying and stay in control of the driver seat.** Open-source, AI-first, analyze current state, propose future state changes, map architectural concepts to code, and create a way for devs of any experience level to easily explore and learn the system they're building.

| Doc | What's in it |
|---|---|
| [01 — Current State Assessment](./01-current-state-assessment.md) | What exists, how it works, verified health check, defects, what to salvage |
| [02 — Strategy Options](./02-strategy-options.md) | Mission decomposition, competitive landscape, nine key decisions with options and recommendations, risks |
| [03 — Target Architecture](./03-target-architecture.md) | Proposed monorepo, spec v2 (actors, elements, journeys, data, code mapping, provenance, rules, tours), multi-repo federation, core API, CLI, MCP tools, PR Action, explorer |
| [04 — Roadmap](./04-roadmap.md) | Phased plan with exit criteria, plus a suggested first vertical slice |
| [archdoc.v2.example.yaml](./archdoc.v2.example.yaml) | ArchDoc's own target architecture, written in the proposed spec v2 (dogfooding) |
| [landscape.example.yaml](./landscape.example.yaml) | A fictional multi-repo company: two product repos and the landscape repo that composes them |

## Summary

**Today:** a working but thin v0 (about 1,000 LOC). It reads a flat YAML list of users and components and renders it with React Flow. It still builds and passes its tests on Node 22, but it has two confirmed rendering and parsing crashes, a deprecated toolchain (CRA, `reactflow` v11, Docusaurus 2), and a data model with no hierarchy, no code linkage, no notion of change, and no machine interface.

**Recommendation:** relaunch ArchDoc as an **open-source architecture control plane for AI-assisted development**:

1. A **human-owned, code-mapped model** (YAML spec v2) versioned in the repo, where every fact carries **provenance** (declared, inferred, or AI-suggested). It models three things:
   - **actors**: people, roles, teams, partner orgs, and AI agents
   - the software **elements** they use
   - the **journeys** that show how actors use systems to reach their goals
   - the **data**: what is sent and stored where, field mappings between tables and databases, logic on request data, and how records change through a journey
2. A **deterministic TypeScript core** (load, validate, query, diff, map to code, check rules). It contains no LLM.
3. An **MCP server + agent skill** so any coding agent asks "where am I, what's the blast radius, what are the rules" *before* editing, and proposes model changes *with* its code changes.
4. A **PR check** that summarizes the *architectural* impact of every change (elements, owners, **affected journeys and actors**, data and classification changes, consumers in other repos) and flags drift and rule violations. This is how humans stay in the driver seat.
5. A modern **explorer** (xyflow 12 + ELK) with hierarchy, before/after diff, click-through to code, actor, journey, and data views (field lineage, a journey data timeline with a sample-request simulator), and **guided tours** for learning.
6. **Federation across repos.** Each repo owns a namespace and publishes its model. A landscape repo composes the enterprise view, with cross-team journeys and org-wide rules. PR checks and agents see consumers and journeys in other repos.

**Differentiation:** LikeC4 and Structurizr already cover "architecture DSL + diagrams" (LikeC4 even has an MCP server), and DeepWiki and CodeWiki cover "AI-generated repo docs". None of them combine **code mapping + change governance + learning** on a human-owned model that also captures **how people use the systems**, **what happens to their data**, and **spans many repos**. That gap is ArchDoc's opening. Interoperate with those tools (importers) rather than compete on DSLs.

## Decisions

All nine were accepted on **2026-10-06**, each as recommended. Rationale and the rejected alternatives are in [02](./02-strategy-options.md).

| # | Decision | Accepted | Not chosen |
|---|---|---|---|
| 1 | Positioning | Architecture control plane for AI-assisted development | Modernized viewer; AI wiki generator |
| 2 | Model format | Own YAML spec v2 + importers (LikeC4, Structurizr, v1) | Adopt LikeC4 DSL; format-agnostic core up front |
| 3 | Where the AI lives | Your own agent via MCP; deterministic core with no LLM | Built-in LLM calls (an optional "Ask" panel may come later) |
| 4 | Future state | Git branches + semantic model diff, with optional proposal notes | Changeset files |
| 5 | Codebase | Fresh pnpm monorepo in this repo, renamed to `archdoc`; v0 kept on `legacy/v0` | Incremental refactor; new repo |
| 6 | Analysis depth first | Declared `code:` globs + TS/JS import graph, behind a plugin API | Manifests/infra first; multi-language + network inference |
| 7 | Usage modeling | Top-level `actors` (person, role, team, organization, agent) + validated `journeys` | Actors as plain elements; leave usage to other tools |
| 8 | Multi-repo | Federated per-repo namespaces + `archdoc publish` + `archdoc.lock` + a landscape repo | One central architecture repo; hosted registry (possible later convenience) |
| 9 | Data | Logical data layer linked to real schemas: entities, `stores`, `mappings`, `logic` (CEL), journey data, simulation | Links to schemas only; full data catalog (bridges later) |

## Next step

Phase 0 in [04-roadmap.md](./04-roadmap.md):
- tag `v0.2.0` and create `legacy/v0`
- rename the repo
- scaffold the monorepo with Node 22/24 CI
- rewrite the README
