# 03 — Target Architecture (proposal)

> Status: **draft for discussion.** It follows the recommendations in [02-strategy-options.md](./02-strategy-options.md): own YAML spec v2, a deterministic core, bring-your-own agent via MCP, git-native proposals, and a fresh monorepo.
> A dogfood model of this architecture, written in the proposed v2 format, is in [`archdoc.v2.example.yaml`](./archdoc.v2.example.yaml).

## 1. System context

```
                ┌──────────────────────────────────────────────┐
  Developer ───▶│  Web Explorer (view, diff, tours, code links) │
  (any level)   └───────────────────────┬──────────────────────┘
                                        │ local HTTP / static build
  AI coding  ──▶ MCP server ─┐          ▼
  agent                      ├──▶  @archdoc/core  ◀── CLI (validate/diff/check/…)
  (Claude Code, Cursor, …)   │     load · validate · query · diff · map · check
                             │          │
  CI (GitHub Action) ────────┘          ├──▶ reads .archdoc/*.yaml (the model, in git)
                                        └──▶ reads source tree via analyzers
```

**Principle:** one deterministic core. Every surface (UI, CLI, MCP, CI) is a thin adapter over the same queries, so a human in the UI and an agent over MCP always see the same answer.

## 2. Monorepo layout

```
archdoc/                       (renamed from archdoc-ui)
├── packages/
│   ├── spec/        # Zod schema → TS types + published JSON Schema; v1→v2 migrator
│   ├── core/        # loader (multi-file), validator, graph, queries, diff, code-map, rules
│   ├── analyzers/   # plugin API + built-ins: manifests, ts-imports (dependency-cruiser), compose/k8s
│   ├── cli/         # `archdoc` binary
│   └── mcp/         # MCP server (stdio + streamable HTTP)
├── apps/
│   └── web/         # Vite + React 19 + @xyflow/react 12 + elkjs explorer
├── integrations/
│   ├── github-action/   # PR architectural-diff comment + drift check
│   ├── agent-skills/    # Claude Code skill / AGENTS.md snippet / Cursor rules
│   └── vscode/          # (later) tree view + "reveal in architecture"
├── examples/        # v1 examples (migrated) + new multi-level examples
└── .archdoc/        # ArchDoc's own model (dogfooding)
```

Tooling: pnpm workspaces, TypeScript 5.x, Node 22/24 LTS, Vitest, Biome or ESLint 9, Changesets for releases, `@modelcontextprotocol/sdk`.

## 3. Spec v2 (sketch)

Design goals: **readable by a junior developer, editable by an agent, validated by a JSON Schema, and backward compatible via `archdoc migrate`.**

### 3.1 Files

```
.archdoc/
├── archdoc.yaml          # root: name, description, imports, defaults
├── model/*.yaml          # elements (can be split however the team likes)
├── rules.yaml            # architectural constraints (optional)
├── tours/*.yaml          # guided learning tours (optional)
└── proposals/*.md        # ADR-style rationale for future-state branches (optional)
```

### 3.2 Elements: one recursive shape with a `kind`

```yaml
archdoc: "2.0"
name: Ride Sharing Platform

elements:
  passenger:
    kind: person                      # person | agent | system | container | component | datastore | queue | external
    description: Books and pays for rides.
    uses:
      mobile-app: Books rides          # v1-compatible shorthand: target → description

  platform:
    kind: system
    description: Everything we build and run.
    elements:                          # hierarchy = C4 levels, but optional
      api-gateway:
        kind: container
        technology: Node.js / Fastify
        code:                          # ← map concept to code
          - path: services/gateway/**
        uses:
          trips:
            description: Creates and queries trips
            technology: HTTP/JSON
          payments: { description: Charges riders, technology: gRPC }
      trips:
        kind: container
        code: [{ path: services/trips/** }]
        owners: ["@rides-team"]
        docs: docs/trips.md            # markdown file or inline markdown
        elements:
          trip-scheduler:
            kind: component
            code: [{ path: services/trips/src/scheduler/** , symbols: [TripScheduler] }]
```

- **IDs** are keys, unique within their parent. They can be referenced by short name when unambiguous, or by dotted path (`platform.trips.trip-scheduler`).
- **Relationships** live with their source (`uses`), as in v1, so the dependency list is readable inline. The core builds the reverse index (`usedBy`) as v0's `consumers` did.
- **`kind: agent`** makes AI agents and automations first-class actors in the model.
- **Status for roadmap overlays:** `status: active | planned | deprecated` on elements and relationships.

### 3.3 Provenance: how humans stay in the driver seat

Every element and relationship can carry its origin:

```yaml
uses:
  billing:
    description: Emits invoice events
    provenance:
      source: inferred              # declared (default) | inferred | suggested
      by: analyzer:ts-imports       # or agent:claude-code, human:@mtfuller
      evidence: services/trips/src/billing-client.ts:12
```

- `declared`: written by a human, and the default when absent.
- `inferred`: produced by a deterministic analyzer, with evidence.
- `suggested`: proposed by an AI agent. The UI renders these dashed and labeled, and they only become "real" when a human removes the `provenance` block or flips it to `declared`, which shows up as a reviewable diff.

### 3.4 Rules: guardrails agents read before editing

```yaml
# rules.yaml
rules:
  - id: no-ui-to-db
    description: Frontends never talk to datastores directly.
    deny: { from: { kind: container, tag: frontend }, to: { kind: datastore } }
  - id: payments-boundary
    description: Only the gateway may call payments.
    allow-only: { to: payments, from: [api-gateway] }
```

Rules are checked against *declared* relationships (model lint) and *observed* relationships from analyzers (drift and violations).

### 3.5 Tours: learning paths for any experience level

```yaml
# tours/request-lifecycle.yaml
title: How a ride gets booked
audience: new-engineer
steps:
  - focus: passenger
    say: Everything starts with a passenger opening the mobile app.
  - focus: platform.api-gateway
    say: The app calls a single entry point, the gateway, which authenticates and routes.
    code: services/gateway/src/routes/trips.ts
  - focus: [platform.trips, payments]
    say: Booking a trip reserves a driver, then pre-authorizes payment.
```

Agents can draft tours ("write an onboarding tour for the billing flow") through MCP. Humans review them like any other change.

## 4. Core API (in-process, used by every surface)

| Function | Returns | Used for |
|---|---|---|
| `load(dir)` | `Model` (validated graph + diagnostics) | everything |
| `query.element(id)` | element + parents, children, uses, usedBy, code, docs, rules | sidebar, MCP |
| `query.locate(paths[])` | owning element(s) for each file, most specific wins | "where am I?" for agents, editor integration |
| `query.impact(target)` | upstream consumers, downstream deps, applicable rules, owners | pre-edit briefing, PR summary |
| `diff(modelA, modelB)` | typed semantic diff: added, removed, changed elements and relationships, moved code mappings | proposals, PR comment, before/after UI |
| `codemap.resolve(model, tree)` | files per element, **unmapped** files, **stale** globs | coverage, drift |
| `analyze(tree, analyzers[])` | observed elements and relationships with evidence | bootstrap, drift |
| `check(model, observed, rules)` | findings: undeclared dependency, rule violation, stale mapping, orphan element | CI gate, MCP |

## 5. Surfaces

### 5.1 CLI

```
archdoc init [--from-code] [--from likec4|structurizr|v1]   # scaffold; optionally bootstrap from analyzers
archdoc validate                                             # schema + references + rules lint
archdoc view [--watch] [--port 0]                            # explorer with live reload (replaces v0 `archdoc file.yaml`)
archdoc locate <path...>                                     # which element owns these files
archdoc impact <element|path>                                # who depends on this and what rules apply
archdoc diff [base...head]                                   # semantic model diff (text | json | markdown | mermaid)
archdoc check [--base main]                                  # drift + rule violations, nonzero exit for CI
archdoc mcp                                                  # start MCP server (stdio)
archdoc migrate                                              # v1 → v2
```

Every command supports `--json`, so agents without MCP can still use the CLI.

### 5.2 MCP server: the "AI-first" surface

| Tool | Purpose |
|---|---|
| `archdoc_overview(level?)` | Compact system summary at a C4 level, so the agent orients cheaply |
| `archdoc_get_element(id)` | Full context for one element: docs, relationships, code paths, owners, rules |
| `archdoc_locate(paths[])` | "Which part of the architecture am I editing?" |
| `archdoc_impact(target)` | Blast radius and constraints **before** an edit |
| `archdoc_check(base?)` | Run drift and rule checks on the working tree **after** an edit |
| `archdoc_diff(base?, head?)` | Architectural summary of the agent's change, for its own PR description |
| `archdoc_propose(edits, rationale)` | Apply model edits (as `suggested` provenance) and write a proposal note. Never touches `declared` facts silently. |
| `archdoc_validate()` | Schema and reference errors with precise paths, so the agent can self-correct |

Resources: `archdoc://model`, `archdoc://element/{id}`, `archdoc://rules`, `archdoc://tour/{id}`.

Shipped next to it: a **Claude Code skill / AGENTS.md snippet** that tells agents the workflow. Call `locate` and `impact` before editing. Call `check` after editing. Call `propose` for any new element or relationship. Put the `diff` output in the PR description.

### 5.3 GitHub Action: "understand what the AI changed"

On every PR, it posts or updates one comment like this:

> **Architectural impact**: touches `platform.trips` (rides-team) and `platform.billing` (payments-team)
> ➕ new relationship `trips → billing` (inferred from `services/trips/src/billing-client.ts:12`), **not declared in model**
> ⚠️ violates `payments-boundary`: only the gateway may call payments
> 🗺️ 3 new files unmapped (`services/trips/src/legacy/**`)
> [Open before/after in ArchDoc ↗]

It's configurable to warn or to fail. This is the single most direct expression of "stay in control of the driver seat".

### 5.4 Web explorer

- **Renderer:** `@xyflow/react` 12 with **ELK** layered layout and compound nodes (expand or collapse a system to see its containers, and so on). This replaces v0's BFS grid and fixes the NaN-orphan class of bugs.
- **Views:** level-of-detail zoom (context → containers → components → files), focus mode (element + N hops), tag/owner filters, and search (⌘K).
- **Diff mode:** overlay of base vs. head. Added is green, removed is red, changed is amber, and `suggested` is dashed.
- **Code panel:** mapped files for the selected element, with links to GitHub or `vscode://`, and the evidence for inferred relationships.
- **Tours:** stepper that pans and zooms the canvas, highlights elements, and shows narration and code links.
- **Learning affordances:** a "what is a container?" glossary popover, plain-language descriptions first and technical details on expand.
- Issues #5 (focus on click) and #6 (resizable panel) are baseline requirements.
- Build output is a static bundle, so the same explorer can be published to GitHub Pages per repo (`archdoc build --site`).

## 6. Three core loops (what success looks like)

1. **Agent pre-flight and post-flight (in the IDE or terminal).** The agent calls `locate` and `impact` and learns that "you're in `trips`, owned by rides-team, consumed by gateway, and the `payments-boundary` rule applies". It edits, then calls `check` and `diff`. If it introduced a new dependency, it calls `propose` so the model change appears in the same PR.
2. **Human review (in the PR).** The reviewer reads the architectural-impact comment first, opens the before/after view, and accepts or rejects the `suggested` model changes with the code.
3. **Learning (anytime).** A new engineer runs `archdoc view` (or opens the published site), follows the "How a ride gets booked" tour, clicks through to the real code, and asks their agent follow-up questions grounded in the same model via MCP.

## 7. Non-goals (for now)

- A hosted SaaS or multi-user real-time editor. The model lives in git, and collaboration happens through PRs.
- Building ArchDoc's own LLM features into the core.
- A drag-and-drop diagram editor. Lightweight edits from the UI that write YAML back are a later phase.
- Replacing code-level tools (IDE call graphs, Sourcegraph).
