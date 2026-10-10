# 02 — Strategy Options

> **Status: decided.** All nine recommendations below were accepted on 2026-10-06. The alternatives stay here as the record of what was considered and why.

## The new mission, decomposed

> ArchDoc is an interactive software modeling platform that empowers engineers to understand the systems AI is modifying and stay in control of the driver seat. Open-source, AI-first, analyze current state, propose future state changes, map architectural concepts to code, and create a way for devs of any experience level to easily explore and learn the system they're building.

| Mission phrase | Capability it implies | v0 has it? |
|---|---|---|
| "understand the systems AI is modifying" | Show *what changed architecturally* in an AI-authored change, not only which lines changed | ❌ |
| "stay in the driver seat" | Humans own the model. AI suggestions are explicit, reviewable, and labeled by origin. Agents are given guardrails. | ❌ |
| "AI-first" | A machine interface (MCP, CLI with JSON output) as a first-class surface, equal to the UI | ❌ |
| "analyze current state" | Bootstrap and refresh the model from code and infrastructure. Detect drift between model and code. | ❌ |
| "propose future state changes" | Model branches, semantic diffs, and visual before/after | ❌ |
| "map architectural concepts to code" | Element ↔ path/package/symbol mapping, plus evidence for relationships | ❌ (repo URL only) |
| "devs of any experience level … explore and learn" | Progressive zoom (system → container → component → code), guided tours, request walkthroughs, plain-language explanations | Partial (graph + sidebar) |
| "understand the systems" (beyond boxes and arrows) | Model **data**: what is sent and stored where, how records map between tables and databases, the logic run on request data, and how records change through a journey | ❌ |
| "interactive software modeling platform" (enterprise scale) | Model **how users and teams use systems**, not just how software connects. Span **many repos and teams** without one central owner. | Partial (users as actors, single file) |

## The landscape (October 2026)

This matters because some of the mission is already well served by other tools.

| Tool | What it is | Overlap with the mission | Gap ArchDoc can own |
|---|---|---|---|
| **[LikeC4](https://likec4.dev/)** | Open-source architecture-as-code DSL, diagrams, VS Code extension, **MCP server and agent skills** | High on *modeling* and *agents querying the model* | No code mapping or drift detection. No PR-level architectural diff. Not built around learning. |
| **Structurizr** | Mature C4 DSL and tooling | Modeling and views | Same gaps. Its DSL is aimed at architects. |
| **IcePanel / Ilograph** | Commercial collaborative modeling | Modeling and exploration UX | Closed source and SaaS. Weak links to code. |
| **[DeepWiki](https://deepwiki.com/) / [CodeWiki](https://github.com/FSoft-AI4Code/CodeWiki) / [Litho](https://github.com/sopaco/deepwiki-rs)** | LLM-*generated* wikis and diagrams from a repo | "Analyze current state", "learn the system" | Output is generated each time and not curated. There's no human-owned source of truth, no future-state proposals, and no governance of changes. |
| Code-graph tools (Sourcegraph, dependency-cruiser, Nx graph, …) | Precise *code-level* graphs | "Map to code" | No *architectural* abstraction above packages and files |

**Takeaway:** competing on "yet another architecture DSL + diagram renderer" is a losing position, because LikeC4 already ships a good DSL, renderer, and MCP server for free. Competing on "AI writes a wiki of your repo" is a losing position too.

The opening is in the space between them:

> **A human-owned, code-linked architecture model that sits in the loop of AI-driven change.** It tells the agent *where it is* and *what the rules are* before it edits. It tells the human *what the change means architecturally* after the edit. And it teaches newcomers the system using the same model.

Three capabilities make that defensible together: **code mapping, change governance (diff/drift/proposals), and learning UX.** No tool above combines them.

Two more properties make the model useful beyond one team:

- **Usage, not just structure.** Actors (people, roles, teams, partner orgs, agents) and the **journeys** they take through the systems are first-class. Impact is then reported in human terms: "this change affects *Book a ride* for passengers". Generated wikis and most diagram tools describe software only.
- **Federated across repos.** Each team owns its part of the model in its own repo. A landscape repo composes the enterprise view. AI agents see cross-repo consumers and constraints even when they only have one repo checked out.

---

## Decision 1 — Positioning

| Option | Description | Verdict |
|---|---|---|
| **A. Modernized viewer** | Port v0 to Vite/xyflow 12, add hierarchy, keep the scope as "YAML → interactive diagram" | ❌ Too little. Duplicates LikeC4/Structurizr and doesn't address the mission. |
| **B. AI wiki generator** | LLM reads the repo and writes an architecture site | ❌ Crowded, and the result isn't human-owned. It puts the AI in the driver seat, which is the opposite of the mission. |
| **C. Architecture control plane for AI-assisted development** ⭐ | A versioned, code-mapped model in the repo, plus MCP tools for agents, plus PR-time architectural diff and drift checks, plus an explorer UI for learning | ✅ **Accepted (2026-10-06).** Directly expresses the mission and sits in the gap. |

## Decision 2 — Model format

| Option | Pros | Cons |
|---|---|---|
| **2a. Own YAML spec v2** (evolve v1) ⭐ | Continuity with v1. Plain YAML/JSON is easy for both agents and newcomers. JSON Schema gives validation and editor autocomplete for free. Full control to add code mappings, provenance, rules, and tours as first-class fields. | You own the spec and tooling. Needs importers to avoid being an island. |
| **2b. Adopt LikeC4 DSL as the model** | Mature parser, layouts, VS Code extension, and existing MCP. ArchDoc becomes a set of add-ons. | Tied to another project's roadmap and grammar. Code mapping and provenance would live in side files or custom metadata. Steeper for "any experience level" than plain YAML. |
| **2c. Format-agnostic core** (internal graph model, adapters for v2 YAML, LikeC4, Structurizr) | Maximum interoperability | More work up front. Risks a lowest-common-denominator model. |

**Accepted (2026-10-06): 2a now, designed so 2c is possible later.** Define spec v2 in YAML/JSON with a published JSON Schema. Keep the in-memory graph model independent of the file format. Ship *importers* (LikeC4, Structurizr, v1) early. Interoperability is a growth lever, not a core dependency.

## Decision 3 — Where the AI lives

| Option | Description | Verdict |
|---|---|---|
| **3a. Built-in LLM calls** | ArchDoc calls an LLM API itself (API key, prompts in core) | Adds cost, key handling, and provider coupling to every user. Makes CI non-deterministic. |
| **3b. Bring-your-own agent via MCP and skills** ⭐ | ArchDoc core is **deterministic**: it loads, validates, queries, diffs, maps to code, and checks rules. The user's existing agent (Claude Code, Cursor, Copilot, Codex, …) calls ArchDoc's MCP tools to do the reasoning (summarizing, proposing, explaining). | ✅ Zero keys, zero inference cost to the project, works with any agent, and CI stays reproducible. |
| **3c. Hybrid** | 3b by default. An optional "Ask" panel in the web UI uses the user's own API key. | ✅ Good later phase |

**Accepted (2026-10-06): 3b first, 3c later.** "AI-first" means *built to be operated by agents*, not *contains an LLM*. A deterministic core is also what makes "stay in control" credible, because the checks that gate a PR are reproducible.

## Decision 4 — Future state: how proposals are represented

| Option | Description | Pros | Cons |
|---|---|---|---|
| **4a. Changeset files** | `proposals/0007.yaml` lists ops (add/remove/modify) applied on top of the base model | Several proposals can coexist on one branch | A custom patch language with merge and rebase problems. Duplicates what git already does. |
| **4b. Git-native** ⭐ | Future state is the model *edited on a branch*. ArchDoc computes a **semantic diff** between any two revisions (`archdoc diff main...HEAD`). An optional proposal note (ADR-style markdown with rationale) sits next to it. | Reuses PR review, history, and blame. No new concepts for developers. Agents just edit YAML. | Two competing proposals need two branches |
| **4c. In-model "planned" status** | Elements and relationships carry `status: planned \| deprecated` | Can show a roadmap overlay on `main` | Clutters the current-state model if overused |

**Accepted (2026-10-06): 4b, with 4c for long-lived roadmap items.** The core primitive becomes `diff(modelA, modelB)`. It powers the PR comment, the visual before/after overlay, and the agent's "here is what I'm about to change" summary.

## Decision 5 — Code mapping and analysis depth

| Level | Mechanism | Accuracy | Effort |
|---|---|---|---|
| L0 | Element declares `code: [globs]`. ArchDoc resolves files, reports **unmapped** and **stale** paths. | Exact (declared) | Small ⭐ start here |
| L1 | Manifest and infra analyzers: `package.json`/workspaces, `pyproject`, `go.mod`, Dockerfile, docker-compose, k8s, Terraform, OpenAPI | High | Medium |
| L2 | Import-graph analyzers (dependency-cruiser for TS/JS, language-native tools, tree-sitter) map file imports to **observed element→element dependencies**, compared against declared ones to detect **drift** | High for in-process deps | Medium–large |
| L3 | Network-call inference (HTTP clients, queue topics, SQL connections), plus agent-assisted labeling | Medium. Needs human verification. | Large |

**Accepted (2026-10-06):** ship L0 and an L2 analyzer for TypeScript/JavaScript first, which lets ArchDoc dogfood itself. Put the analyzers behind a plugin interface so the community can add languages. Mark every analyzer- or agent-produced fact with **provenance** (`declared | inferred | suggested`) so nothing becomes "truth" without a human accepting it.

## Decision 6 — Codebase strategy

| Option | Pros | Cons |
|---|---|---|
| **6a. Incremental refactor of v0** | Git history continuity | Almost every file changes anyway. CRA migration plus model rewrite makes the "incremental" path longer than a rewrite. |
| **6b. Fresh monorepo in this repo** ⭐ | One repo, stars and issues preserved. Rename `archdoc-ui` → `archdoc` (GitHub redirects old URLs). Tag `v0.2.0` and keep a `legacy/v0` branch. | Breaking change for any v0 users (very few, judging by activity). Provide `archdoc migrate`. |
| **6c. New repo** | Clean slate | Loses issues, stars, and continuity |

**Accepted (2026-10-06): 6b.** Keep the docs site repo, since org GitHub Pages needs the `archdoc.github.io` name. Upgrade it to Docusaurus 3 (or Starlight), and generate the spec reference pages from the JSON Schema in the monorepo so they can't drift again.

## Decision 7 — How usage is modeled (actors and journeys)

v1 already treated **users as actors who use components**. The question is how far to take it.

| Option | Description | Pros | Cons |
|---|---|---|---|
| **7a. Actors as plain elements** | `kind: person` is just another element in the software tree | Simplest schema | Blurs "who" and "what". Teams that own and use systems need two entities. No notion of a goal or flow. |
| **7b. Top-level actors + journeys** ⭐ | `actors:` (person, role, team, organization, agent) sits beside `elements:`, as v1's `users:` did. `journeys:` describe an actor's goal as ordered steps across elements, validated against declared relationships. | Keeps v1's mental model. Maps how users use systems. Impact reports name affected journeys and actors. Journeys double as tour scripts. A team is one entity that both uses and owns. | Journeys are more for people to maintain (mitigated: `check` flags broken journeys, and agents can draft them) |
| **7c. Separate usage tool** | Leave usage to product analytics or BPMN tools and link out | No extra model surface | Loses the link between user goals and code. Can't answer "which user flows does this PR affect?" |

**Accepted (2026-10-06): 7b.** `archdoc migrate` maps v1 `users` → `actors` directly. Later, journeys can be checked against OpenTelemetry traces to confirm real usage paths.

## Decision 8 — Multi-repo and enterprise scope

Enterprise architecture spans teams and repos that no single person or agent sees in full.

| Option | Description | Pros | Cons |
|---|---|---|---|
| **8a. Central architecture repo** | One repo holds the whole enterprise model, edited by an architecture team | One place to look | Disconnected from code, so it rots. Bottleneck on one team. Can't do code mapping or drift checks per repo. |
| **8b. Federated: per-repo models + landscape repo** ⭐ | Each repo owns a **namespace** in `.archdoc/` and `archdoc publish`es a versioned bundle. Repos `import` what they depend on, pinned in `archdoc.lock`. A **landscape repo** composes all namespaces and adds enterprise actors, cross-team journeys, and org-wide rules. | Ownership follows code ownership. Works with only git and CI. Reproducible. Enables cross-repo impact in PRs and in agent context. | Version skew between repos (surfaced by `check`). Needs a publish step in each repo's CI. |
| **8c. Hosted registry service** | A server collects and serves every repo's model | Live enterprise view, search across everything | Requires running and securing a service. Conflicts with "open, git-native, local-first" as a starting point. |

**Accepted (2026-10-06): 8b now, keeping 8c as an optional later convenience.** Design for federation from Phase 1 (namespaced IDs, an `imports:` block in the schema) even though the federation tooling ships later. Retrofitting global identity is the expensive part.

## Decision 9 — Data modeling

Architecture diagrams usually stop at "A calls B". The mission needs more: which records travel, where they're stored, how fields map between tables and databases, which decisions depend on request data, and how records change along a journey.

| Option | Description | Pros | Cons |
|---|---|---|---|
| **9a. Link to schemas only** | Elements link to their OpenAPI, Prisma, or SQL files. ArchDoc adds nothing on top. | Cheap. No duplication. | Can't answer lineage, classification, or "what happens to this record" questions. No journey data timeline. |
| **9b. Logical data layer linked to physical schemas** ⭐ | `data` entities, messages, and events with fields, classification, and lifecycle states, **imported** from existing schema sources. `stores` maps tables to entities. `sends`/`accepts`/`carries` put data on relationships and contracts. `mappings` give field-level lineage across stores and repos. `logic` describes decisions on request data. Journeys annotate data per step. CEL expressions throughout. | Answers the questions engineers and reviewers actually ask. Enables simulation, classification rules (PII/PCI), and schema-drift checks. Stays linked to code and real schemas. | The largest spec addition. Logic and mappings need upkeep (mitigated: `check` validates them, analyzers import fields, agents draft them as `suggested`). |
| **9c. Full data catalog** | Build or integrate a catalog and lineage platform (DataHub, OpenLineage-style, column-level lineage from query logs) | Very rich lineage for analytics pipelines | Different audience (data platform teams). Heavy. Drifts from the application-architecture focus. |

**Accepted (2026-10-06): 9b, with import/export bridges to 9c tools later.** Keep logic declarative and readable. It's the contract that code, reviewers, and agents check against, not a second implementation. Use CEL for conditions and mappings so expressions can be evaluated (`archdoc simulate`) without inventing a language.

---

## Recommended strategy, in one paragraph

Re-launch ArchDoc as an **open-source architecture control plane for AI-assisted development**. A human-owned, YAML-based, **code-mapped** model lives in each repo (`.archdoc/`). It describes the software, the **actors** (people, teams, partners, agents) who use it, the **journeys** they take through it, and the **data** that flows and is stored along the way. Repos publish their models, and a landscape repo composes them into an **enterprise view**. A deterministic TypeScript core loads, validates, queries, **diffs**, and **checks** it. Agents get an **MCP server** to locate code in the architecture, assess impact, read rules, and propose changes by editing the model on a branch. Humans get a **PR check** that summarizes the architectural impact of every change (including affected journeys and consumers in other repos) and flags drift, plus a modern **explorer UI** that renders current vs. proposed state, maps every box to its code, and offers guided tours for learning. Interoperate with LikeC4 and Structurizr instead of competing with them.

## Key risks

| Risk | Mitigation |
|---|---|
| **Model rot**: the model drifts from code, the classic failure of architecture docs | Drift detection in CI is a core feature, not an add-on. Code mappings make staleness *detectable*. |
| **Hallucinated architecture** from agent-assisted bootstrap | Provenance on every fact. `suggested` facts render differently and must be accepted by a human. Deterministic analyzers come before LLM inference. |
| **Scope creep** (editor, SaaS, many languages, many analyzers) | Phase gates in the roadmap. Dogfood on ArchDoc itself before generalizing. |
| **Overlap with LikeC4**, which also has MCP | Differentiate on code mapping, PR governance, and learning. Import LikeC4 models. Consider contributing upstream where it makes sense. |
| **Graph layout quality at scale** | ELK layered layout with compound nodes. Views and filters by default, never "show everything". |
| **Journeys go stale** | `check` validates every step against declared relationships. Later, telemetry traces confirm real paths. |
| **Data model becomes a second schema to maintain** | Import fields from real schema sources instead of retyping them. Schema-drift checks catch divergence. Logic is a readable contract linked to code, not a reimplementation. |
| **Version skew across repos** | Pinned imports in `archdoc.lock`. `check` flags references to removed or deprecated elements. A landscape CI job reports skew org-wide. |
| **Solo-maintainer bandwidth** | Small core, plugin interfaces, good first issues, and agents doing much of the implementation (with ArchDoc modeling ArchDoc) |
