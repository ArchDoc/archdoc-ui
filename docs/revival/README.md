# ArchDoc Revival: Review & Strategy

A review of the existing ArchDoc codebase (`archdoc-ui` + `ArchDoc.github.io`) and a proposed path to re-architect it around the new mission:

> **ArchDoc is an interactive software modeling platform that empowers engineers to understand the systems AI is modifying and stay in control of the driver seat.** Open-source, AI-first, analyze current state, propose future state changes, map architectural concepts to code, and create a way for devs of any experience level to easily explore and learn the system they're building.

| Doc | What's in it |
|---|---|
| [01 — Current State Assessment](./01-current-state-assessment.md) | What exists, how it works, verified health check, defects, what to salvage |
| [02 — Strategy Options](./02-strategy-options.md) | Mission decomposition, competitive landscape, eight key decisions with options and recommendations, risks |
| [03 — Target Architecture](./03-target-architecture.md) | Proposed monorepo, spec v2 (actors, elements, journeys, code mapping, provenance, rules, tours), multi-repo federation, core API, CLI, MCP tools, PR Action, explorer |
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
2. A **deterministic TypeScript core** (load, validate, query, diff, map to code, check rules). It contains no LLM.
3. An **MCP server + agent skill** so any coding agent asks "where am I, what's the blast radius, what are the rules" *before* editing, and proposes model changes *with* its code changes.
4. A **PR check** that summarizes the *architectural* impact of every change (elements, owners, **affected journeys and actors**, consumers in other repos) and flags drift and rule violations. This is how humans stay in the driver seat.
5. A modern **explorer** (xyflow 12 + ELK) with hierarchy, before/after diff, click-through to code, actor and journey views, and **guided tours** for learning.
6. **Federation across repos.** Each repo owns a namespace and publishes its model. A landscape repo composes the enterprise view, with cross-team journeys and org-wide rules. PR checks and agents see consumers and journeys in other repos.

**Differentiation:** LikeC4 and Structurizr already cover "architecture DSL + diagrams" (LikeC4 even has an MCP server), and DeepWiki and CodeWiki cover "AI-generated repo docs". None of them combine **code mapping + change governance + learning** on a human-owned model that also captures **how people use the systems** and **spans many repos**. That gap is ArchDoc's opening. Interoperate with those tools (importers) rather than compete on DSLs.

## Decisions needed

These are the choices that most change the plan. Recommendations are in [02](./02-strategy-options.md).

1. **Positioning:** architecture control plane for AI-assisted development (recommended), vs. a modernized viewer, vs. an AI wiki generator.
2. **Model format:** own YAML spec v2 with importers (recommended), vs. adopting LikeC4's DSL as the model.
3. **Where the AI lives:** bring-your-own agent via MCP with a deterministic core (recommended), vs. built-in LLM calls.
4. **Future state:** git-native branches + semantic diff (recommended), vs. changeset files.
5. **Codebase:** fresh monorepo in this repo, renamed to `archdoc` (recommended), vs. incremental refactor, vs. a new repo.
6. **Analysis depth to start:** declared globs + TS import graph (recommended), vs. broader multi-language analysis up front.
7. **Usage modeling:** top-level actors + validated journeys (recommended), vs. actors as plain elements, vs. leaving usage to other tools.
8. **Multi-repo:** federated per-repo models + a landscape repo (recommended), vs. one central architecture repo, vs. a hosted registry.
