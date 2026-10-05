# 02 — Strategy Options

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

---

## Decision 1 — Positioning

| Option | Description | Verdict |
|---|---|---|
| **A. Modernized viewer** | Port v0 to Vite/xyflow 12, add hierarchy, keep the scope as "YAML → interactive diagram" | ❌ Too little. Duplicates LikeC4/Structurizr and doesn't address the mission. |
| **B. AI wiki generator** | LLM reads the repo and writes an architecture site | ❌ Crowded, and the result isn't human-owned. It puts the AI in the driver seat, which is the opposite of the mission. |
| **C. Architecture control plane for AI-assisted development** ⭐ | A versioned, code-mapped model in the repo, plus MCP tools for agents, plus PR-time architectural diff and drift checks, plus an explorer UI for learning | ✅ **Recommended.** Directly expresses the mission and sits in the gap. |

## Decision 2 — Model format

| Option | Pros | Cons |
|---|---|---|
| **2a. Own YAML spec v2** (evolve v1) ⭐ | Continuity with v1. Plain YAML/JSON is easy for both agents and newcomers. JSON Schema gives validation and editor autocomplete for free. Full control to add code mappings, provenance, rules, and tours as first-class fields. | You own the spec and tooling. Needs importers to avoid being an island. |
| **2b. Adopt LikeC4 DSL as the model** | Mature parser, layouts, VS Code extension, and existing MCP. ArchDoc becomes a set of add-ons. | Tied to another project's roadmap and grammar. Code mapping and provenance would live in side files or custom metadata. Steeper for "any experience level" than plain YAML. |
| **2c. Format-agnostic core** (internal graph model, adapters for v2 YAML, LikeC4, Structurizr) | Maximum interoperability | More work up front. Risks a lowest-common-denominator model. |

**Recommendation: 2a now, designed so 2c is possible later.** Define spec v2 in YAML/JSON with a published JSON Schema. Keep the in-memory graph model independent of the file format. Ship *importers* (LikeC4, Structurizr, v1) early. Interoperability is a growth lever, not a core dependency.

## Decision 3 — Where the AI lives

| Option | Description | Verdict |
|---|---|---|
| **3a. Built-in LLM calls** | ArchDoc calls an LLM API itself (API key, prompts in core) | Adds cost, key handling, and provider coupling to every user. Makes CI non-deterministic. |
| **3b. Bring-your-own agent via MCP and skills** ⭐ | ArchDoc core is **deterministic**: it loads, validates, queries, diffs, maps to code, and checks rules. The user's existing agent (Claude Code, Cursor, Copilot, Codex, …) calls ArchDoc's MCP tools to do the reasoning (summarizing, proposing, explaining). | ✅ Zero keys, zero inference cost to the project, works with any agent, and CI stays reproducible. |
| **3c. Hybrid** | 3b by default. An optional "Ask" panel in the web UI uses the user's own API key. | ✅ Good later phase |

**Recommendation: 3b first, 3c later.** "AI-first" means *built to be operated by agents*, not *contains an LLM*. A deterministic core is also what makes "stay in control" credible, because the checks that gate a PR are reproducible.

## Decision 4 — Future state: how proposals are represented

| Option | Description | Pros | Cons |
|---|---|---|---|
| **4a. Changeset files** | `proposals/0007.yaml` lists ops (add/remove/modify) applied on top of the base model | Several proposals can coexist on one branch | A custom patch language with merge and rebase problems. Duplicates what git already does. |
| **4b. Git-native** ⭐ | Future state is the model *edited on a branch*. ArchDoc computes a **semantic diff** between any two revisions (`archdoc diff main...HEAD`). An optional proposal note (ADR-style markdown with rationale) sits next to it. | Reuses PR review, history, and blame. No new concepts for developers. Agents just edit YAML. | Two competing proposals need two branches |
| **4c. In-model "planned" status** | Elements and relationships carry `status: planned \| deprecated` | Can show a roadmap overlay on `main` | Clutters the current-state model if overused |

**Recommendation: 4b, with 4c for long-lived roadmap items.** The core primitive becomes `diff(modelA, modelB)`. It powers the PR comment, the visual before/after overlay, and the agent's "here is what I'm about to change" summary.

## Decision 5 — Code mapping and analysis depth

| Level | Mechanism | Accuracy | Effort |
|---|---|---|---|
| L0 | Element declares `code: [globs]`. ArchDoc resolves files, reports **unmapped** and **stale** paths. | Exact (declared) | Small ⭐ start here |
| L1 | Manifest and infra analyzers: `package.json`/workspaces, `pyproject`, `go.mod`, Dockerfile, docker-compose, k8s, Terraform, OpenAPI | High | Medium |
| L2 | Import-graph analyzers (dependency-cruiser for TS/JS, language-native tools, tree-sitter) map file imports to **observed element→element dependencies**, compared against declared ones to detect **drift** | High for in-process deps | Medium–large |
| L3 | Network-call inference (HTTP clients, queue topics, SQL connections), plus agent-assisted labeling | Medium. Needs human verification. | Large |

**Recommendation:** ship L0 and an L2 analyzer for TypeScript/JavaScript first, which lets ArchDoc dogfood itself. Put the analyzers behind a plugin interface so the community can add languages. Mark every analyzer- or agent-produced fact with **provenance** (`declared | inferred | suggested`) so nothing becomes "truth" without a human accepting it.

## Decision 6 — Codebase strategy

| Option | Pros | Cons |
|---|---|---|
| **6a. Incremental refactor of v0** | Git history continuity | Almost every file changes anyway. CRA migration plus model rewrite makes the "incremental" path longer than a rewrite. |
| **6b. Fresh monorepo in this repo** ⭐ | One repo, stars and issues preserved. Rename `archdoc-ui` → `archdoc` (GitHub redirects old URLs). Tag `v0.2.0` and keep a `legacy/v0` branch. | Breaking change for any v0 users (very few, judging by activity). Provide `archdoc migrate`. |
| **6c. New repo** | Clean slate | Loses issues, stars, and continuity |

**Recommendation: 6b.** Keep the docs site repo, since org GitHub Pages needs the `archdoc.github.io` name. Upgrade it to Docusaurus 3 (or Starlight), and generate the spec reference pages from the JSON Schema in the monorepo so they can't drift again.

---

## Recommended strategy, in one paragraph

Re-launch ArchDoc as an **open-source architecture control plane for AI-assisted development**. A human-owned, YAML-based, **code-mapped** model lives in the repo (`.archdoc/`). A deterministic TypeScript core loads, validates, queries, **diffs**, and **checks** it. Agents get an **MCP server** to locate code in the architecture, assess impact, read rules, and propose changes by editing the model on a branch. Humans get a **PR check** that summarizes the architectural impact of every change and flags drift, plus a modern **explorer UI** that renders current vs. proposed state, maps every box to its code, and offers guided tours for learning. Interoperate with LikeC4 and Structurizr instead of competing with them.

## Key risks

| Risk | Mitigation |
|---|---|
| **Model rot**: the model drifts from code, the classic failure of architecture docs | Drift detection in CI is a core feature, not an add-on. Code mappings make staleness *detectable*. |
| **Hallucinated architecture** from agent-assisted bootstrap | Provenance on every fact. `suggested` facts render differently and must be accepted by a human. Deterministic analyzers come before LLM inference. |
| **Scope creep** (editor, SaaS, many languages, many analyzers) | Phase gates in the roadmap. Dogfood on ArchDoc itself before generalizing. |
| **Overlap with LikeC4**, which also has MCP | Differentiate on code mapping, PR governance, and learning. Import LikeC4 models. Consider contributing upstream where it makes sense. |
| **Graph layout quality at scale** | ELK layered layout with compound nodes. Views and filters by default, never "show everything". |
| **Solo-maintainer bandwidth** | Small core, plugin interfaces, good first issues, and agents doing much of the implementation (with ArchDoc modeling ArchDoc) |
