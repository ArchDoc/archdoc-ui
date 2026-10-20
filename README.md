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

The quickest way to see everything is the playground: one command sets up the demo org in [`examples/org`](./examples/org) (four repos, released and synced, with a branch ready for each scenario) in `.playground/`:

```bash
pnpm install && pnpm playground --open      # builds if needed, then opens the whole org in the explorer
```

`.playground/PLAYGROUND.md` ([what it sets up](./examples/org/README.md#playground)) lists what to try: simulating a refund, field lineage across repos, and what a pull request would be told when it sends personal data to a third party, breaks an API another repo uses, loosens a decision, or renames a classified column. Run it again for a fresh copy.

For single systems, [`examples/`](./examples) has one model per part of the platform. They are a quickstart, a modular monolith taken apart into components with code snippets, an event-driven system, decisions and simulation, a 24-table schema, and sensitive data. Each is one file you can open with `archdoc view examples/quickstart.yaml`. Three variants of the quickstart show what a change looks like to a reviewer, compared straight from the files: `archdoc diff examples/quickstart.yaml examples/quickstart.add-reviews.yaml`. [examples/README.md](./examples/README.md) says what each one shows.

The packages aren't published yet, so run the CLI from a clone:

```bash
pnpm install && pnpm build
pnpm archdoc view --watch --open            # explore ArchDoc's own model in your browser
pnpm archdoc validate                       # check it
pnpm archdoc context pr report shows type undefined for data fields   # where to start a task
pnpm archdoc search cli command             # where does this live?
pnpm archdoc show toolchain.cli                      # details of an element, actor, or journey by ID
pnpm archdoc locate packages/core/src/load/fs.ts   # which element owns this file?
pnpm archdoc impact packages/cli/src/commands      # what would changing it affect?
pnpm archdoc map                            # how the repo's files map onto the model
pnpm archdoc check                          # drift: imports the model doesn't declare, broken rules
pnpm archdoc diff main                      # what changed in the model since main
pnpm archdoc report --base main             # the architectural impact of your branch, as markdown
pnpm archdoc eval --min-recall 0.5          # how well context points at what recent commits changed
pnpm archdoc sync                           # pin imported repos' models in archdoc.lock
pnpm archdoc publish 1.0.0 --out -          # the bundle other repos would import
pnpm archdoc landscape build                # in a landscape repo: check it and write the site
pnpm archdoc validate examples/quickstart.yaml               # a single-file model
pnpm archdoc migrate packages/spec/test/fixtures/v1/blog.yaml  # convert a v0/v1 model to v2
pnpm archdoc schema -o archdoc.schema.json  # JSON Schema for editor validation
```

`view` opens the explorer. Click a box to see what it is, what it uses, who uses it, and which journeys pass through it. Open a box to see what's inside. Focus on an actor to see what it uses and owns, or pick a journey and step through it. With `--watch`, the explorer updates as you save model files, and shows any problems at the top. The Changes tab compares the model on two branches, or a branch and your working tree, with the number of changes on the tab. It lists them in the order to review them: what breaks (rules and checks the change newly fails), the journeys affected, elements and arrows, data (including sensitive data that goes somewhere new), and facts an agent suggested. Click one to go to it. On the canvas, new and changed boxes and relationships are marked, removed ones appear as ghosts, and suggested facts are dashed. Pick the branches at the top; `--base main` picks the base to start with, and the address keeps the pair, so a link opens the same comparison. A branch is read from git the way the working tree is read from disk: with what its schema sources say, the other repos its lockfile pins, its sample data, and code links to the files at its commit.

`validate` checks the schema, every reference, and every journey step against the declared relationships. It reports problems as `file:line:column` and exits nonzero on errors, so it works as a CI gate.

`show` prints the details of any element, actor, journey, or data entry by ID. An element's `code:` can point at whole paths and at snippets: a line range (`{ path: app/checkout.rb, lines: 40-88 }`) or a declaration (`{ path: app/checkout.rb, symbol: Checkout::PlaceOrder.call }`), each with what it's for. That lets a component inside a container say where its logic lives, even when the container is one deployable app. `show <element> --code` prints each snippet's text, the explorer links each one to its lines (finding where a symbol is declared), and `check` warns when a snippet no longer matches the code. `context` is where an agent starts a task: give it the task in words, the files it plans to change, or both, and it returns a short brief: the files and functions to open first (ranked from file names, exported symbols, tool names, the owning element, and the journey steps that name a file), other code that does the same job (other callers of the functions those files use from another element), the data and rules involved, the narrowest journeys (those whose steps name the files; the rest as a count), the tests to run, and owners. It reads an index of the code's exported symbols and named imports that the TS/JS analyzer builds. `eval` measures it: it replays the last 50 commits, asks `context` with each subject, and reports how many of the source files each changed the brief named in Start here or under the elements it involved (recall), next to plain `search`, using the model and code as they are now. `--min-recall` fails CI below a threshold. `search`, `locate`, and `impact` answer the questions an agent should ask before it edits: where does this belong, which part of the architecture is this, who depends on it, and which actors and journeys does a change affect? `map` shows how much of the repository the model covers, which files no element claims, and which code paths no longer match anything.

## Keep the model honest

`archdoc check` compares the model with the code. Analyzers read workspace manifests and TS/JS imports, and `check` reports dependencies between elements that the model doesn't declare, relationships that break the rules in `.archdoc/rules.yaml`, broken journeys, code paths that match nothing, and elements nothing connects to. With `--base main`, it marks what your change introduced and fails only on that, so it works as a CI gate from day one.

`archdoc diff` shows what changed in the model itself, by element, relationship, actor, and journey rather than by line. `diff`, `report --base`, and `view --base` also take another model file in place of a git ref, to compare two versions side by side.

## Data: what's sent and stored

Boxes and arrows say *that* two things talk. Data says *what* they exchange and *where* it lands. Data entries are records (`entity`), requests and responses (`message`), and `event`s, with fields, a `classification` on sensitive ones, and an optional lifecycle:

```yaml
data:
  Charge:
    kind: entity
    fields:
      card_last4: { type: string, classification: pci }
      status: { type: enum, values: [authorized, captured, refunded] }
    states:
      - authorized -> captured -> refunded
elements:
  ledger:
    kind: datastore
    stores: { charges: { entity: Charge } }
  charges:
    kind: container
    provides:
      - { api: proto/charges.proto, accepts: RefundRequest, returns: Refund }
    uses:
      ledger: { description: Records charges, sends: Charge }
```

Fields don't have to be retyped. Point an entry at the schema it comes from, and keep only what the schema can't say, such as classifications:

```yaml
data:
  Charge:
    kind: entity
    source: { prisma: prisma/schema.prisma#Charge }
    fields:
      card_last4: { classification: pci }
```

`archdoc check` reads sources with schema importers: SQL migrations (`sql: migrations#charges`, replayed in order), Prisma, OpenAPI and JSON Schema (`openapi: openapi/trips.yaml#Trip`), and Protobuf (`proto: proto/charges.proto#RefundRequest`). It reports schema drift: a modeled field the schema no longer has (an error when it's classified, because a renamed column loses its classification), fields the schema has that the model doesn't, and types or enum values that differ.

A field can point at another entry's field, like a foreign key: `charge_id: { references: Charge.id }`, or `references: Charge` for its key. A field whose `type` names another entry points at it too, and SQL and Prisma sources fill `references` in from their foreign keys and relations. `validate` reports references that don't resolve.

A message is the same idea however it travels; how it travels is a detail on the arrow. Contracts and relationships can say their `transport` (`http`, `grpc`, `kafka`, `sqs`, `eventbridge`, or anything else). Pub-sub is a topic or event the publisher `provides`, which subscribers `use`, rather than a broker box every service points at. The explorer draws a subscription from the publisher to the subscriber, labelled with its channel and transport, and messages flow that way, even on a journey step written from the subscriber's side. Relationships `send` data, contracts `accept`, `return`, or `carry` it, datastores `store` it, and journey steps say what they `send`, `create`, and `change` (`Charge.status: captured -> refunded`). Every arrow on a journey carries a message. A step can say it (`sends:`); otherwise it carries what the relationship it travels along sends, what the API it calls accepts (or, for a lookup, returns), or what it writes through a mapping or creates and changes. `validate` warns about a step none of these name, and `archdoc show <journey>` prints each step's message and where it comes from. Each step is one interaction: a step from one service to another that also writes into a datastore neither of them is gets a warning, asking for storing it to be a step of its own (`order-service → erp-db`), and the explorer plays such a step as two arrows until it's split. Data in another repo is referenced by namespace, like elements (`payments.Charge`). `validate` reports data that isn't defined, fields that don't exist, values outside an enum, state changes the lifecycle doesn't allow, and data sent to an element that doesn't accept it. Rules can say where classified data may be stored and where it may never go:

```yaml
rules:
  - id: pci-stays-in-payments
    data: { classification: pci, stored-in: { namespace: payments } }
  - id: no-pii-to-external
    data: { classification: pii, not-sent-to: { kind: external } }
```

Mappings say how one record becomes another, field by field, as [CEL](https://cel.dev) expressions; logic blocks say how an element decides on the data it receives. Journey steps name the decision they take and what each outcome does:

```yaml
logic:
  refund-approval:
    runs-in: charges.refunds
    input: { request: RefundRequest, charge: Charge }
    rules:
      - when: "request.reason == 'safety'"
        then: escalate-to-safety
      - when: "request.amount_cents <= charge.amount_cents / 2"
        then: auto-approve
      - else: needs-finance-approval
mappings:
  refund-to-ledger:
    from: { refund: Refund }
    to: ledger.ledger_entries
    fields:
      account: "'charge:' + refund.charge_id"
      amount_cents: -refund.amount_cents
journeys:
  refund:
    steps:
      - from: api-gateway
        to: charges
        sends: RefundRequest
        decides: refund-approval
        branches:
          auto-approve: { changes: { Charge.status: captured -> partially_refunded } }
      - { from: charges, to: ledger, via: refund-to-ledger, when: auto-approve }
```

`archdoc lineage Refund.amount_cents` (and the `archdoc_lineage` MCP tool) lists every place a value is copied or derived, across repos, and the tables it lands in. `archdoc simulate refund --sample request.json` runs a journey against a sample request without running anything: the branch each decision takes and why, the records each step creates and changes, and where they're stored. `validate` checks that mappings and logic read fields that exist, parse, and cover every case, and that journeys only take branches their logic can decide.

The explorer shows data on the same canvas as the system. Pick a message and the arrows it travels along light up and flow; pick an entity and the datastore that stores it opens into its tables, with a line for each foreign key (or open any datastore's tables from its card). Click a field, in a table or the details panel, and its lineage lights up: the field in every table on the way, and the arrows its value travels, while the panel lists each mapping expression. Open a journey and each step's message travels along its arrow, while the datastores it writes to open into their tables and show the row each step adds or the fields it changes; the details panel expands each step to its message's fields. The journey card leads with what the current step does, then who it goes between and what it carries, with how datastores are shown kept at the bottom. "Inspect data" opens the record the step sends from one element to another (or, where a step stores what it wrote, the records it writes): every value, nested objects included, with sensitive fields marked and values the model doesn't declare called out, or as JSON to copy. It stays open as you step through, and the details panel shows the same view for every step. While a journey is open, any datastore it writes to can switch between its schema (ERD) and its rows: the rows the sample starts with, and each record the journey creates or changes, linked to the rows it points at. Tables show their names and how many fields they have until you open one, so a big schema reads at a glance; a field's lineage opens the tables it goes through. During a journey, the tables it doesn't write or read fold into one box, and in Rows only the rows it creates, changes, or reads stay, with the rows they point at; click a folded table to bring it back, or tick "All tables". Rows are ordered to keep the lines between them from crossing. A journey runs when it opens, on a sample named after it (`archdoc view` loads `<journey>.sample.json` files and any `samples/*.json` in the repo; an entry can be a list of rows, the first being the one the journey reads) or else on example data made up from each field's name and type, so rows always show values, never a mapping's expressions. Edit a sample and run it, and the same views show its values: what each message carries, the branch each decision takes, and the records each step writes. Agents get the same answers from the `archdoc_data`, `archdoc_lineage`, and `archdoc_simulate` MCP tools.

The pull request report lists the data entries a change touches, the mappings and decisions it changes (with the expressions before and after), and calls out sensitive data that goes somewhere new, external services first.

## Share models across repos

Each repo owns its namespace and models its own part. When it depends on another team's repo, it imports that repo's model and refers to its elements by namespace:

```yaml
# .archdoc/archdoc.yaml in the rides repo
namespace: rides
imports:
  payments: { github: acme/payments, version: ^5 }
elements:
  api-gateway:
    kind: container
    uses:
      payments.charges: { description: Asks for a refund, via: proto/charges.proto }
```

`archdoc sync` reads each import's model at the newest release tag its range allows (`v5.2.0`, read straight from git, so private repos work with the credentials you already have) and vendors it in `.archdoc/vendor/`, pinned in `.archdoc/archdoc.lock`. Commit both: `check`, the explorer, MCP, and CI then work offline and reproducibly, and taking a new release shows up as a diff in review. From then on, `validate` and `check` report references into other repos that don't exist at the pinned version, deprecated targets, contracts (`via`) the target doesn't `provide`, journey steps that start in another repo but don't follow its relationships, and imports built against a different major version than yours.

A repo also learns who uses *it* from the landscape: the repo that imports every team's model and adds enterprise actors and cross-team journeys. Point at it with `landscape: { github: acme/architecture, version: ^1 }` and `archdoc sync` brings it with every model it pins. Then `archdoc impact`, `archdoc show`, and the MCP tools list consumers and journeys in other repos, and the pull request report says which consumers a change breaks (an element they use is removed, or a contract they use `via`) before it merges.

The landscape repo itself runs `archdoc landscape build`. It composes every repo's model into one (each repo a system, its elements inside), checks journeys that cross teams, owners (every team must be defined somewhere), and its rules across repos, and writes the explorer as a static site for GitHub Pages; `archdoc view --landscape` shows the same thing live. The explorer groups the landscape by repo, team, or domain, and marks where a journey crosses from one repo into another. The landscape also defines `domains:` for grouping, and its rules marked `scope: org` run in every repo that imports it, just as its teams resolve owners there. [`integrations/landscape-template`](./integrations/landscape-template) is a starting point, with a workflow that takes every team's newest release weekly and publishes the site.

`archdoc sync --update` moves to the newest allowed release, and `archdoc sync --frozen` checks the lock in CI. `archdoc publish` writes a validated, versioned bundle (`dist/payments@5.2.0.json`) for repos that import it by `url:`. [`examples/org`](./examples/org) is a demo org of four repos that import each other.

## Review pull requests

The [GitHub Action](./integrations/github-action) comments on every pull request with its architectural impact. It leads with Mermaid diagrams, which GitHub renders natively: one of the change (what was added, changed, or removed, and what an agent suggested, among its unchanged neighbors) and one of each of the most important journeys it affects, with the affected steps highlighted. With a landscape synced, it also lists consumers in other repos and marks the ones the change breaks. Below them: the elements it touches and their owners, the journeys and actors it affects (critical first), what changed in the model, facts an agent suggested that need a person's review, and drift the change introduced. It can fail the check on new drift. `archdoc report --base main` writes the same report, ready to paste into a PR description.

## Use it with your coding agent

`archdoc mcp` starts an MCP server. Its read-only tools answer the questions an agent should ask: `archdoc_search`, `archdoc_overview`, `archdoc_locate`, `archdoc_impact`, `archdoc_get_element`, `archdoc_code` (an element's code, with the text of its snippets), `archdoc_get_actor`, `archdoc_journey`, `archdoc_validate`, `archdoc_check`, and `archdoc_diff`. One tool writes: `archdoc_propose` adds elements and relationships to the model as suggestions for a person to review, with a rationale note in `.archdoc/proposals/`. It only adds, and writes nothing that wouldn't validate.

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
  federation/ @archdoc/federation  share models across repos: sync, archdoc.lock, publish
apps/
  web/    @archdoc/web    the explorer (React, React Flow, ELK), served by `archdoc view`
integrations/
  agent-skills/           Claude Code skill, AGENTS.md snippet, MCP configs
  landscape-template/     starting point for a landscape repo, with a sync-and-publish workflow
  github-action/          the pull request impact comment and drift gate
examples/                 one model per part of the platform, the quickstart's change variants, and org/, a demo org
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
