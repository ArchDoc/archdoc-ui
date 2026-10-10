# ArchDoc

**An architecture control plane for AI-assisted development.**

ArchDoc is an interactive software modeling platform that helps engineers understand the systems AI is modifying and stay in the driver's seat. It's open source and AI-first. It analyzes the current state of a system, proposes future-state changes, and maps architectural concepts to code. Developers of any experience level can use it to explore and learn the system they're building.

> **Status: v2 is under active development.** The v0 viewer (`@archdoc/archdoc-ui`) is frozen at [`v0.2.0`](https://github.com/ArchDoc/archdoc/releases/tag/v0.2.0) on the [`legacy/v0`](https://github.com/ArchDoc/archdoc/tree/legacy/v0) branch. The plan for v2 is in [`docs/revival/`](./docs/revival/README.md).

## Why

- AI agents change code faster than people can follow the architecture.
- Architecture docs drift away from the code and stop being trusted.
- Generated repo wikis describe the code, but nobody owns them.

## What

A **human-owned model** lives in each repo, in `.archdoc/` next to the code. It describes four things:

| Section | Answers |
|---|---|
| **Actors** | *Who* uses the system: people, roles, teams, partner orgs, and AI agents |
| **Elements** | *What* the system is made of: systems, containers, components, and datastores, each mapped to code paths |
| **Journeys** | *How* an actor reaches a goal, step by step across elements, checked against real relationships |
| **Data** | *With what*: what is sent and stored, how fields map between tables, and the logic that runs on request data |

A **deterministic engine** (`@archdoc/core`) answers every question about the model. It contains no LLM, so the same question gets the same answer in the IDE, the browser, and CI. Your own coding agent does the reasoning.

People and agents reach the engine through the surface that fits the moment:

- **AI agents, before editing:** an MCP server and agent skill. *Where am I? What depends on this? Which rules and journeys apply?*
- **Reviewers, before merging:** a PR impact check. It lists affected journeys, owners, data changes, and consumers in other repos, and flags drift.
- **Everyone, anytime:** the explorer, with a hierarchy view, actor and journey views, data timelines, tours, and click-through to code.
- **Enterprises, across teams:** the landscape, which composes every repo's model into one view.

## A taste of the model

```yaml
# .archdoc/archdoc.yaml
archdoc: "2.0"
namespace: rides
name: Rides Platform

actors:
  passenger:
    kind: person
    description: Books and pays for rides from the mobile app.
    uses:
      mobile-app: Requests rides, pays, rates drivers

elements:
  mobile-app:
    kind: container
    technology: React Native
    code: [{ path: apps/mobile/** }]
    uses:
      api-gateway: Calls all backend APIs
  api-gateway:
    kind: container
    code: [{ path: services/gateway/** }]

journeys:
  book-a-ride:
    actor: passenger
    goal: Get a ride to a destination
    importance: critical
    steps:
      - { from: passenger, to: mobile-app, action: Enters destination and confirms }
      - { from: mobile-app, to: api-gateway, action: POST /trips }
```

ArchDoc's own model is in [`.archdoc/`](./.archdoc). A model can live in one file, or be split across `.archdoc/` however the team likes: `actors.yaml`, `model/*.yaml`, `journeys/*.yaml`, `rules.yaml`.

## Try it

The packages aren't published yet, so run the CLI from a clone:

```bash
pnpm install && pnpm build
pnpm archdoc view --watch --open            # explore ArchDoc's own model in your browser
pnpm archdoc validate                       # check it
pnpm archdoc search cli command             # where does this live?
pnpm archdoc show toolchain.cli                      # details of an element, actor, or journey by ID
pnpm archdoc locate packages/core/src/load/fs.ts   # which element owns this file?
pnpm archdoc impact packages/cli/src/commands      # what would changing it affect?
pnpm archdoc map                            # how the repo's files map onto the model
pnpm archdoc check                          # drift: imports the model doesn't declare, broken rules
pnpm archdoc diff main                      # what changed in the model since main
pnpm archdoc report --base main             # the architectural impact of your branch, as markdown
pnpm archdoc validate examples/blog.yaml    # a single-file model
pnpm archdoc migrate examples/v1/blog.yaml  # convert a v0/v1 model to v2
pnpm archdoc schema -o archdoc.schema.json  # JSON Schema for editor validation
```

`view` opens the explorer. Click a box to see what it is, what it uses, who uses it, and which journeys pass through it. Open a box to see what's inside. Focus on an actor to see what it uses and owns, or pick a journey and step through it. With `--watch`, the explorer updates as you save model files, and shows any problems at the top. With `--base main`, it also shows what changed since that ref: new and changed boxes and relationships are marked, removed ones appear as ghosts, suggested facts are dashed, and the journeys the change affects are flagged.

`validate` checks the schema, every reference, and every journey step against the declared relationships. It reports problems as `file:line:column` and exits nonzero on errors, so it works as a CI gate.

`show` prints the details of any element, actor, or journey by ID. `search`, `locate`, and `impact` answer the questions an agent should ask before it edits: where does this belong, which part of the architecture is this, who depends on it, and which actors and journeys does a change affect? `map` shows how much of the repository the model covers, which files no element claims, and which code paths no longer match anything.

## Keep the model honest

`archdoc check` compares the model with the code. Analyzers read workspace manifests and TS/JS imports, and `check` reports dependencies between elements that the model doesn't declare, relationships that break the rules in `.archdoc/rules.yaml`, broken journeys, code paths that match nothing, and elements nothing connects to. With `--base main`, it marks what your change introduced and fails only on that, so it works as a CI gate from day one.

`archdoc diff` shows what changed in the model itself, by element, relationship, actor, and journey rather than by line.

## Review pull requests

The [GitHub Action](./integrations/github-action) comments on every pull request with its architectural impact: the elements it touches and their owners, the journeys and actors it affects (critical first), what changed in the model, facts an agent suggested that need a person's review, and drift the change introduced. It can fail the check on new drift.

## Use it with your coding agent

`archdoc mcp` starts an MCP server. Its read-only tools answer the questions an agent should ask: `archdoc_search`, `archdoc_overview`, `archdoc_locate`, `archdoc_impact`, `archdoc_get_element`, `archdoc_get_actor`, `archdoc_journey`, `archdoc_validate`, `archdoc_check`, and `archdoc_diff`. One tool writes: `archdoc_propose` adds elements and relationships to the model as suggestions for a person to review, with a rationale note in `.archdoc/proposals/`. It only adds, and writes nothing that wouldn't validate.

[`integrations/agent-skills`](./integrations/agent-skills) has a Claude Code skill, an `AGENTS.md` snippet, and MCP configs that teach agents the workflow: at the start of a task, search the model for where the change belongs and check its impact; after editing, check for drift and propose the model changes the code needs. This repository uses them itself (`.mcp.json`, `.claude/skills/archdoc`, `AGENTS.md`).

## Roadmap

ArchDoc is built in phases. Each phase ends with an exit test, not a date. The full roadmap is in [`docs/revival/04-roadmap.md`](./docs/revival/04-roadmap.md).

| Phase | Delivers |
|---|---|
| 0 · Reset | pnpm monorepo, Node 22/24 CI, this README |
| 1 · Model core + explorer | Spec v2, `archdoc validate`, `archdoc view`, ArchDoc modeling itself |
| 2 · Code mapping + MCP | `locate` and `impact` for agents, before they edit |
| 3 · Diff, drift, PR loop | Semantic diff, TypeScript import analysis, a PR impact comment, a before/after view, agents proposing model changes |
| 4 · Federation | Models published across repos, a landscape repo, cross-repo impact |
| 5 · Data | Entities, storage, field lineage, logic, and simulation |
| 6 · Bootstrap + interop | Draft models from code, LikeC4/Structurizr importers |
| 7 · Learning | Tours, team onboarding pages, a static site |
| 8 · Reach | VS Code, OpenTelemetry checks, community spec process |

## Repository layout

```
packages/
  spec/   @archdoc/spec   v2 schema (Zod), TypeScript types, JSON Schema, v1 migration
  core/   @archdoc/core   load, validate, and query models (no LLM)
  cli/    @archdoc/cli    the `archdoc` command, including the `view` server
  mcp/    @archdoc/mcp    MCP server for coding agents
  analyzers/ @archdoc/analyzers  find the dependencies code actually has (manifests, TS/JS imports)
apps/
  web/    @archdoc/web    the explorer (React, React Flow, ELK), served by `archdoc view`
integrations/
  agent-skills/           Claude Code skill, AGENTS.md snippet, MCP configs
  github-action/          the pull request impact comment and drift gate
examples/                 example models in v2 (v1 originals in examples/v1)
docs/revival/             the relaunch plan: assessment, strategy, architecture, roadmap
.archdoc/                 ArchDoc's own model
```

## Development

You need Node 22.12+ (or 24) and pnpm 10 (`corepack enable` sets it up).

```bash
pnpm install
pnpm lint        # Biome
pnpm typecheck   # tsc -b, which also builds every package
pnpm test        # Vitest
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to propose changes.

## License

[MIT](./LICENSE)
