# 03 — Target Architecture (proposal)

> Status: **draft for discussion.** It follows the recommendations in [02-strategy-options.md](./02-strategy-options.md): own YAML spec v2, a deterministic core, bring-your-own agent via MCP, git-native proposals, a fresh monorepo, **actors and journeys as first-class model content**, and **federated multi-repo models**.
> A dogfood model of this architecture, written in the proposed v2 format, is in [`archdoc.v2.example.yaml`](./archdoc.v2.example.yaml). A multi-repo enterprise example is in [`landscape.example.yaml`](./landscape.example.yaml).

## 1. System context

```
                ┌──────────────────────────────────────────────┐
  Developer ───▶│  Web Explorer (view, diff, journeys, tours)   │
  (any level)   └───────────────────────┬──────────────────────┘
                                        │ local HTTP / static build
  AI coding  ──▶ MCP server ─┐          ▼
  agent                      ├──▶  @archdoc/core  ◀── CLI (validate/diff/check/publish/…)
  (Claude Code, Cursor, …)   │     load · resolve · query · diff · map · check
                             │          │
  CI (GitHub Action) ────────┘          ├──▶ this repo's .archdoc/*.yaml (the part this team owns)
                                        ├──▶ other repos' published models (pinned in archdoc.lock)
                                        └──▶ source tree via analyzers
```

**Principle:** one deterministic core. Every surface (UI, CLI, MCP, CI) is a thin adapter over the same queries, so a human in the UI and an agent over MCP always see the same answer.

## 2. Monorepo layout

```
archdoc/                       (renamed from archdoc-ui)
├── packages/
│   ├── spec/        # Zod schema → TS types + published JSON Schema; v1→v2 migrator
│   ├── core/        # loader, resolver (local + federated), graph, queries, diff, journeys, code-map, rules
│   ├── analyzers/   # plugin API + built-ins: manifests, ts-imports (dependency-cruiser), compose/k8s
│   ├── cli/         # `archdoc` binary
│   └── mcp/         # MCP server (stdio + streamable HTTP)
├── apps/
│   └── web/         # Vite + React 19 + @xyflow/react 12 + elkjs explorer
├── integrations/
│   ├── github-action/   # PR architectural-impact comment + drift check (local and cross-repo)
│   ├── agent-skills/    # Claude Code skill / AGENTS.md snippet / Cursor rules
│   └── vscode/          # (later) tree view + "reveal in architecture"
├── examples/        # v1 examples (migrated) + multi-level and multi-repo examples
└── .archdoc/        # ArchDoc's own model (dogfooding)
```

Tooling: pnpm workspaces, TypeScript 5.x, Node 22/24 LTS, Vitest, Biome or ESLint 9, Changesets for releases, `@modelcontextprotocol/sdk`.

## 3. Spec v2 (sketch)

Design goals: **readable by a junior developer, editable by an agent, validated by a JSON Schema, and backward compatible via `archdoc migrate`.**

The model has three kinds of content. They answer different questions:

| Section | Answers | v1 equivalent |
|---|---|---|
| `actors` | **Who** uses or operates the systems: people, roles, teams, partner organizations, AI agents | `users` |
| `elements` | **What** the software is: systems, containers, components, datastores, queues, external services | `components` |
| `journeys` | **How** actors use the systems to reach a goal, step by step across elements | (none) |

### 3.1 Files

```
.archdoc/
├── archdoc.yaml          # root: namespace, name, imports, defaults
├── actors.yaml           # who uses the system (optional split)
├── model/*.yaml          # elements (can be split however the team likes)
├── journeys/*.yaml       # how actors use the system (optional)
├── rules.yaml            # architectural constraints (optional)
├── tours/*.yaml          # guided learning tours (optional)
├── proposals/*.md        # ADR-style rationale for future-state branches (optional)
└── archdoc.lock          # pinned versions of imported models from other repos (generated)
```

### 3.2 Actors: users and teams are first-class

v1's idea that **users are actors who use components** stays, and it gets broader. Actors are kept in their own top-level section, separate from software elements, because "who uses the system and why" is a different question from "what the system is made of".

```yaml
actors:
  passenger:
    kind: person                 # person | role | team | organization | agent
    description: Books and pays for rides from the mobile app.
    segment: external customer
    uses:
      rides.mobile-app: Requests rides, pays, rates drivers

  support-team:
    kind: team
    description: Resolves rider and driver issues.
    members: ["@acme/support"]   # links the actor to a real team handle
    uses:
      support.admin-console: Looks up trips and issues refunds
      zendesk: Works the ticket queue

  finance-team:
    kind: team
    uses:
      payments.ledger-reports: Runs month-end close

  fraud-bot:
    kind: agent
    description: Automated agent that flags suspicious trips.
    uses:
      trips.api: Reads trip events
```

- **Kinds:**
  - `person`: a persona.
  - `role`: a permission-based role, such as "dispatcher".
  - `team`: an internal team.
  - `organization`: a partner or customer org.
  - `agent`: an AI agent or automation.
- **A team is one entity with two roles.** The same `support-team` actor can **use** systems and **own** elements (`owners: [support-team]`). The explorer can then show both "what does this team use?" and "what does this team own?"
- `uses` from an actor works like v1's user `dependencies`. The core builds the reverse index, so every element can answer **"who uses me?"**, not only "what calls me?".

### 3.3 Elements: one recursive shape with a `kind`

```yaml
archdoc: "2.0"
namespace: rides                 # globally unique id for this repo's model (see §3.9)
name: Rides Platform

elements:
  mobile-app:
    kind: container
    technology: React Native
    code: [{ path: apps/mobile/** }]
    uses:
      api-gateway: Calls all backend APIs

  api-gateway:
    kind: container
    technology: Node.js / Fastify
    owners: [rides-team]
    code:                          # ← map concept to code
      - path: services/gateway/**
    uses:
      trips.api:                   # ← element in ANOTHER repo (namespace "trips")
        description: Creates and queries trips
        technology: HTTP/JSON
      payments.charges: { description: Charges riders, technology: gRPC }
```

- **IDs** are keys, unique within their parent and namespace. Inside a repo, use short names or dotted paths. Across repos, prefix with the namespace (`payments.charges`).
- **Relationships** live with their source (`uses`), as in v1. The core builds the reverse index (`usedBy`), including across repos once models are federated.
- **Hierarchy is optional:** `elements:` can nest (system → container → component), matching C4 levels.
- **Interfaces:** an element can declare what it exposes (`provides: [{ api: openapi/trips.yaml }, { topic: trip.completed }]`). Cross-repo relationships can then target a contract instead of an implementation detail.
- **Status for roadmap overlays:** `status: active | planned | deprecated` on elements and relationships.

### 3.4 Journeys: how actors use systems

A journey is a named goal for an actor, expressed as ordered steps across elements. It's model data, not only documentation.

```yaml
# journeys/book-a-ride.yaml
journey: book-a-ride
actor: passenger
goal: Get a ride to a destination
importance: critical             # critical | high | normal, used to rank impact
steps:
  - from: passenger
    to: rides.mobile-app
    action: Enters destination and confirms
  - from: rides.mobile-app
    to: rides.api-gateway
    action: POST /trips
    code: services/gateway/src/routes/trips.ts
  - from: rides.api-gateway
    to: trips.api
    action: Create trip, match driver
  - from: rides.api-gateway
    to: payments.charges
    action: Pre-authorize fare
```

Journeys are what let ArchDoc map **how users use systems**, not just how software connects:

- **Validated against the model.** Each step must follow a declared `uses` relationship. If a refactor removes `gateway → payments`, `archdoc check` reports that the "Book a ride" journey is broken.
- **Impact in human terms.** The PR comment and the `impact` query report *which journeys and actors* a change touches. For example: "This change affects *Book a ride* (passenger, critical) and *Refund a fare* (support-team)."
- **Actor-centric views.** The explorer can show "everything the support team touches across the enterprise", built from actors' `uses` plus journeys.
- **Learning.** Tours can be generated from journeys, so a newcomer learns the system the way its users experience it.
- **Observed usage (later).** Journeys can be checked against OpenTelemetry traces to confirm real paths and find undocumented ones, the same way analyzers check code dependencies.

### 3.5 Provenance: how humans stay in the driver seat

Every actor, element, relationship, and journey step can carry its origin:

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

### 3.6 Rules: guardrails agents read before editing

```yaml
# rules.yaml
rules:
  - id: no-ui-to-db
    description: Frontends never talk to datastores directly.
    deny: { from: { kind: container, tag: frontend }, to: { kind: datastore } }
  - id: payments-boundary
    description: Only the gateway may call payments.
    allow-only: { to: payments.charges, from: [rides.api-gateway] }
  - id: critical-journeys-reviewed
    description: Changes that touch a critical journey need a review from the journey's owning team.
    require-review: { journeys: { importance: critical } }
```

Rules are checked against *declared* relationships (model lint) and *observed* relationships from analyzers (drift and violations). In a federated setup, rules can be defined at the landscape level and apply to every repo.

### 3.7 Tours: learning paths for any experience level

```yaml
# tours/request-lifecycle.yaml
title: How a ride gets booked
audience: new-engineer
from-journey: book-a-ride        # optional: reuse the journey's steps
steps:
  - focus: passenger
    say: Everything starts with a passenger opening the mobile app.
  - focus: rides.api-gateway
    say: The app calls a single entry point, the gateway, which authenticates and routes.
    code: services/gateway/src/routes/trips.ts
```

Agents can draft tours ("write an onboarding tour for the refund journey") through MCP. Humans review them like any other change.

### 3.8 Multi-repo and enterprise architecture

Enterprise architecture spans many teams and many repos. No single repo, team, or agent session sees all of it. ArchDoc handles this through **federation**: each team owns its piece, and the full picture is composed on top.

```
 repo: acme/rides          repo: acme/trips          repo: acme/payments       repo: acme/support-tools
 .archdoc/ (ns: rides)     .archdoc/ (ns: trips)     .archdoc/ (ns: payments)  .archdoc/ (ns: support)
        │ archdoc publish         │                         │                          │
        └────────────┬────────────┴────────────┬────────────┴─────────────┬────────────┘
                     ▼                         ▼                          ▼
          versioned model bundles (release asset, static URL, OCI artifact, or git ref)
                     │
                     ▼
      repo: acme/architecture  (the "landscape")
        landscape.yaml: imports every namespace, defines enterprise actors,
        cross-team journeys, and org-wide rules  →  enterprise explorer site
```

**Key ideas:**

1. **Each repo owns a namespace.** `namespace: payments` in `archdoc.yaml` makes `payments.charges` a globally unique ID. A repo may *reference* other namespaces but never *defines* their elements. Ownership follows code ownership.
2. **Publish, don't copy.** `archdoc publish` emits a versioned, validated JSON bundle of the repo's model (elements, actors it defines, journeys, provides/uses). By default it's attached to a git tag or release. It can also go to a static URL or an OCI registry.
3. **Import with pins.** A repo that depends on others declares `imports:` in `archdoc.yaml`. `archdoc sync` resolves them and writes `archdoc.lock`, so CI is reproducible and offline-friendly.

   ```yaml
   # acme/rides/.archdoc/archdoc.yaml
   namespace: rides
   imports:
     trips:    { github: acme/trips,    version: ^3 }
     payments: { github: acme/payments, version: ^5 }
     zendesk:  { file: ../vendors/zendesk.yaml }   # external system stubs
   ```

4. **A landscape repo composes everything.** It imports all namespaces and adds things no single team owns: enterprise-wide actors and teams, **cross-team journeys** ("Refund a fare" spans support-tools → payments → trips), org-wide rules, and domain groupings (business capabilities). It builds the enterprise explorer site.
5. **Cross-repo references are validated.** `archdoc check` reports a reference to an element that the pinned version of the other repo doesn't have, or one that's marked `deprecated` there.
6. **Cross-repo impact.** Because published bundles include `uses`, the landscape knows every consumer of every element. The PR check in `acme/payments` can say: "`payments.charges` is used by 3 elements in 2 other repos, and by 2 critical journeys. This change removes a field from the `charges` contract." This is the multi-repo version of "understand what the AI changed".
7. **Agents see beyond their repo.** The MCP server in any repo can query the landscape from the lockfile or a cached landscape bundle. An agent working in `rides` can learn that `payments.charges` is owned by payments-team and that only the gateway may call it, without having that repo checked out.
8. **Shared definitions flow back down.** The landscape can publish an `org` bundle with enterprise teams and org-wide rules. Product repos import it so `owners: [payments-team]` resolves and org rules run in every repo's CI. Locally, an unresolved team is a warning. In the landscape build, it's an error.
9. **Scales down.** A single repo with no `imports` and no landscape is the default experience. Federation is opt-in and uses only git, files, and CI. A hosted registry is a possible later convenience, never a requirement.

## 4. Core API (in-process, used by every surface)

| Function | Returns | Used for |
|---|---|---|
| `load(dir)` | `Model` (validated graph + diagnostics) | everything |
| `resolve(model, lock)` | federated graph across namespaces, plus dangling-reference diagnostics | multi-repo |
| `query.element(id)` | element + parents, children, uses, usedBy (code and actors), code, docs, rules, owners | sidebar, MCP |
| `query.actor(id)` | what the actor uses directly, journeys it takes part in, what it owns (for teams) | actor views, MCP |
| `query.locate(paths[])` | owning element(s) for each file, most specific wins | "where am I?" for agents, editor integration |
| `query.impact(target)` | upstream consumers (local and cross-repo), downstream deps, **affected actors and journeys**, applicable rules, owners | pre-edit briefing, PR summary |
| `journeys.validate(model)` | broken steps (missing relationship, deleted element) | `check` |
| `diff(modelA, modelB)` | typed semantic diff of actors, elements, relationships, journeys, and code mappings | proposals, PR comment, before/after UI |
| `codemap.resolve(model, tree)` | files per element, **unmapped** files, **stale** globs | coverage, drift |
| `analyze(tree, analyzers[])` | observed elements and relationships with evidence | bootstrap, drift |
| `check(model, observed, rules)` | findings: undeclared dependency, rule violation, broken journey, dangling cross-repo reference, stale mapping, orphan element | CI gate, MCP |
| `publish(model)` | versioned JSON bundle | multi-repo |

## 5. Surfaces

### 5.1 CLI

```
archdoc init [--from-code] [--from likec4|structurizr|v1]   # scaffold; optionally bootstrap from analyzers
archdoc validate                                             # schema + references + journeys + rules lint
archdoc view [--watch] [--port 0]                            # explorer with live reload (replaces v0 `archdoc file.yaml`)
archdoc locate <path...>                                     # which element owns these files
archdoc impact <element|actor|path>                          # who depends on this, which journeys, which rules
archdoc diff [base...head]                                   # semantic model diff (text | json | markdown | mermaid)
archdoc check [--base main]                                  # drift, rules, journeys, cross-repo refs; nonzero exit for CI
archdoc sync                                                 # resolve imports → archdoc.lock
archdoc publish                                              # emit a versioned model bundle for other repos
archdoc landscape build                                      # compose all namespaces into an enterprise site
archdoc mcp                                                  # start MCP server (stdio)
archdoc migrate                                              # v1 → v2 (users → actors, components → elements)
```

Every command supports `--json`, so agents without MCP can still use the CLI.

### 5.2 MCP server: the "AI-first" surface

| Tool | Purpose |
|---|---|
| `archdoc_overview(level?)` | Compact system summary at a C4 level, so the agent orients cheaply |
| `archdoc_get_element(id)` | Full context for one element: docs, relationships, code paths, owners, actors who use it, rules |
| `archdoc_get_actor(id)` | What an actor or team uses, owns, and which journeys it takes part in |
| `archdoc_locate(paths[])` | "Which part of the architecture am I editing?" |
| `archdoc_impact(target)` | Blast radius and constraints **before** an edit: consumers across repos, affected journeys and actors, rules |
| `archdoc_journey(id)` | Steps of a journey, with code entry points per step |
| `archdoc_check(base?)` | Run drift, rule, and journey checks on the working tree **after** an edit |
| `archdoc_diff(base?, head?)` | Architectural summary of the agent's change, for its own PR description |
| `archdoc_propose(edits, rationale)` | Apply model edits (as `suggested` provenance) and write a proposal note. Never touches `declared` facts silently, and never edits another namespace. Cross-repo changes become a proposal for the owning repo. |
| `archdoc_validate()` | Schema and reference errors with precise paths, so the agent can self-correct |

Resources: `archdoc://model`, `archdoc://element/{id}`, `archdoc://actor/{id}`, `archdoc://journey/{id}`, `archdoc://rules`, `archdoc://landscape`.

Shipped next to it: a **Claude Code skill / AGENTS.md snippet** that tells agents the workflow. Call `locate` and `impact` before editing. Call `check` after editing. Call `propose` for any new element or relationship. Put the `diff` output in the PR description.

### 5.3 GitHub Action: "understand what the AI changed"

On every PR, it posts or updates one comment like this:

> **Architectural impact**: touches `payments.charges` (payments-team)
> 👥 **Journeys affected:** *Book a ride* (passenger · critical), *Refund a fare* (support-team)
> 🔗 **Cross-repo consumers:** `rides.api-gateway`, `support.admin-console` (pinned at payments@5.2). The `charges` contract loses field `currency_hint`.
> ➕ new relationship `charges → ledger` (inferred from `src/ledger-client.ts:12`), **not declared in model**
> ⚠️ `critical-journeys-reviewed`: needs review from rides-team
> [Open before/after in ArchDoc ↗]

It's configurable to warn or to fail. In the landscape repo, a scheduled run can open issues for dangling cross-repo references and broken journeys.

### 5.4 Web explorer

- **Renderer:** `@xyflow/react` 12 with **ELK** layered layout and compound nodes (expand or collapse a system to see its containers, and so on). This replaces v0's BFS grid and fixes the NaN-orphan class of bugs.
- **Views:**
  - **Landscape:** all namespaces grouped by repo, team, or business domain.
  - **System:** the C4 levels, from context down to components.
  - **Actor:** everything a person, role, or team uses and owns.
  - **Journey:** the path of one journey, animated step by step across repos.
  - **Focus:** an element plus N hops.
  - Tag and owner filters, and search (⌘K).
- **Diff mode:** overlay of base vs. head. Added is green, removed is red, changed is amber, and `suggested` is dashed. Affected journeys are highlighted.
- **Code panel:** mapped files for the selected element, with links to GitHub or `vscode://` (in the owning repo for cross-repo elements), and the evidence for inferred relationships.
- **Tours:** stepper that pans and zooms the canvas, highlights elements, and shows narration and code links.
- **Learning affordances:** a "what is a container?" glossary popover, plain-language descriptions first and technical details on expand.
- Issues #5 (focus on click) and #6 (resizable panel) are baseline requirements.
- Build output is a static bundle, so the same explorer can be published to GitHub Pages per repo (`archdoc build --site`) or for the whole enterprise (`archdoc landscape build`).

## 6. Four core loops (what success looks like)

1. **Agent pre-flight and post-flight (in the IDE or terminal).** The agent calls `locate` and `impact` and learns that "you're in `trips`, owned by rides-team, used by passengers and drivers in two critical journeys, and the `payments-boundary` rule applies". It edits, then calls `check` and `diff`. If it introduced a new dependency, it calls `propose` so the model change appears in the same PR.
2. **Human review (in the PR).** The reviewer reads the architectural-impact comment first: affected journeys, cross-repo consumers, drift. They open the before/after view, and accept or reject the `suggested` model changes with the code.
3. **Cross-repo change (across teams).** A change to `payments.charges` in the payments repo shows the consumers and journeys in other repos *before* merge. After release, consumers' `archdoc sync` picks up the new version, and their `check` flags any reference that no longer resolves.
4. **Learning (anytime).** A new engineer opens the enterprise explorer and picks their team. They see what the team owns and uses, then follow the "Refund a fare" journey end to end across three repos, clicking through to real code. Follow-up questions go to their agent, grounded in the same model via MCP.

## 7. Non-goals (for now)

- A hosted SaaS or multi-user real-time editor. The model lives in git, and collaboration happens through PRs. A hosted registry for published bundles is a possible later convenience, not a requirement.
- Building ArchDoc's own LLM features into the core.
- A drag-and-drop diagram editor. Lightweight edits from the UI that write YAML back are a later phase.
- Replacing code-level tools (IDE call graphs, Sourcegraph) or product analytics. Journeys describe intended usage. Telemetry integration only *checks* them.
