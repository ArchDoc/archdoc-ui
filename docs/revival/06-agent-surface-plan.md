# 06 — Agent surface plan: fewer tools, and a way to start

ArchDoc offers agents 21 MCP tools, and its loop takes about eight calls per task (`context`, `impact`, edit, `check`, `verify`, `seal`, `propose`, `report`). Several of the tools answer the same question:

- `check` and `verify` report the same facts.
- `validate` is a subset of `check`.
- `report` and `diff` restate `check` plus the change.
- `propose` is a second way to edit the model, and its promise to only add can't be kept, because the agent can edit the files anyway.

Then there's the other end: on a repository without `.archdoc/`, every command stops with "No ArchDoc model", so ArchDoc can't help the agent until someone has written the first model by hand.

This plan cuts the agent surface to five tools, one per question, and adds `archdoc init`. Each phase ends with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm -s archdoc validate --strict`, `archdoc check --base main`, and `archdoc verify`.

Status: `[ ]` to do, `[~]` in progress, `[x]` done.

## The surface

Five MCP tools. Each answers one question, and each CLI command of the same name does the same thing.

| Tool | Question | Replaces |
|---|---|---|
| `archdoc_init` | There's no model: what does the code say it should be? | (new) |
| `archdoc_context` | Where do I start, and what does it affect? | context, search, locate, overview, impact, anchor |
| `archdoc_show` | What is this one thing? | get_element, get_actor, journey, data, code, lineage, simulate |
| `archdoc_check` | What's wrong or stale, and, against a base, what does my change do? | validate, check, verify, diff, report, trace_check |
| `archdoc_seal` | I checked these facts: record it. | seal |

Removed outright: `archdoc_propose`. The MCP server isn't published, so tools are removed rather than deprecated.

Writes: `init` (refuses when a model exists) and `seal` (only `archdoc.sum`). The agent edits `.archdoc/*.yaml` with its own file tools, the same way it edits code.

The loop becomes `context` → edit code and model → `check` → `seal` (three or four calls). `seal` returns what's still unchecked, so the loop ends without another `check`.

**Baseline to beat:** today `tools/list` is 21 tools and 16,178 characters, plus 3,084 characters of server instructions, sent in every agent session.

## 1. One tool per question

- [x] **`check` covers verify, validate, and traces.** Seal findings carry what `verify` printed: the fact, what changed, where the fact is in the model, and the `seal` to run. `check` also reports `trace check` findings for `.archdoc/traces/`. CLI: `archdoc check --seals` exits 1 while facts are unchecked (for CI), and `verify` becomes an alias for it.
- [x] **`check` with a base says what the change does.** It returns the verdict, blocking items, people to ask, affected journeys and actors, and the model changes (from `summarizeChange`, which the PR comment already uses).
  - `format: "markdown"` returns the PR comment, for an agent writing a PR description without a shell.
  - CLI `report` stays: the Action runs it, and people paste it.
- [x] **`check` stays short by default.**
  - Introduced findings come first, one line each with its fix.
  - Findings already on the base come as a count by code.
  - `detail: "all"` lists everything.
  - Budget: under 2,000 characters for a clean change on this repo.
- [x] **`context` covers search, locate, overview, impact, and anchor.** It takes three separate inputs rather than guessing from one string:
  - `task` (words): today's brief.
  - `paths`: the elements that own them, which also answers `locate` for files that don't exist yet.
  - `error` (a log or stack trace): today's `anchor`, the journey steps it likely showed up in.

  For the elements it lands on, it adds what `impact` returned:
  - dependents, and consumers in other repos;
  - affected journeys and actors (critical first);
  - owners and rules.

  With no input, it returns the overview. Its default output stays within today's brief size.
- [x] **`show` covers every kind of ID.** By the kind of ID it's given:
  - an element (`code: true` includes snippet text), actor, journey, data entry, trace, decision, mapping, or a seal fact key (`element:x#path:symbol`, which returns its fingerprint and status);
  - `Entry.field` returns its lineage;
  - a journey with `sample` (a path or JSON) returns the simulation.

  An unknown ID returns the closest matches, as `search` did.
- [x] **`seal` returns what's left.** The facts it sealed, the facts still unchecked (with what changed), and unknown keys.
- [x] **Remove `archdoc_propose`.**
  - Drop the writer and `.archdoc/proposals/`.
  - `provenance: { source: suggested, by: agent:<name> }` stays as something the agent may write by hand. The PR comment lists every model change in any case, under "Model changes".
  - `check` already catches invalid YAML and broken references.
- [x] **Server instructions shrink to the loop.**
  - Instructions: five lines, one per tool, plus "never seal a fact you haven't read".
  - Tool descriptions say when to use each tool, not how it works.
  - Target: `tools/list` under 6,000 characters, instructions under 1,200.
- [x] **CLI mirrors it.**
  - `context`, `show`, `check`, and `seal` are the commands for agents.
  - `search`, `locate`, `impact`, `diff`, `lineage`, `simulate`, `verify`, `validate`, and `trace check|anchor` stay as aliases for one minor release, printing what they're now part of.
  - `view`, `site`, `report`, `map`, `eval`, `sync`, `publish`, `landscape`, `migrate`, and `schema` keep their own jobs.
- [x] **Tests.**
  - The MCP tool list is exactly the five tools, and `init` and `seal` are the only ones that write.
  - Each removed tool's existing test moves to the tool that replaces it, with the same assertions on content.
  - An end-to-end test runs the loop in four calls on a temporary repo: `context` → edit → `check` → `seal`.

## 2. `archdoc init`

Deterministic: no LLM and no network, like the rest of core. It writes a starting model from what the repository declares, marks every fact as inferred, and tells the agent what only it or a person can add. It never overwrites a model, and never seals.

- [x] **Elements from what the repo declares.** Every inferred fact has `code:` paths and `provenance: { source: inferred, by: archdoc init }`. Sources, in order:
  - **Workspace packages** (`package.json` with a name): a container per package, with `code: <dir>/**`. Its description comes from the manifest, and its technology from its dependencies (for example `next`, `react` → web app; `express`, `fastify`, `@nestjs/core` → service).
  - **Other manifests:**
    - `go.mod`: one container per `cmd/*` binary, plus the module.
    - `Cargo.toml`: one container per workspace member.
    - `pyproject.toml` or `setup.py`: one per project.
    - `pom.xml` and `build.gradle`: one per module.
  - **Compose files** (`docker-compose.yml`, `compose.yaml`):
    - Services built from a directory map to the container for that directory.
    - Services from known images become datastores (`postgres`, `mysql`, `mongo`, `redis`) or topics/queues (`kafka`, `rabbitmq`, `nats`), with `technology` set from the image.
    - `depends_on` becomes `uses`.
  - **Fallback:** with no manifests, top-level directories under `apps/`, `services/`, `packages/`, `cmd/`, and `src/` that hold source files.
- [x] **Uses from the code.** The existing analyzers (manifests, TS/JS imports) give dependencies between files. `init` lifts them to the elements that own those files and writes `uses: { b: Imports <name> }`. A placeholder description is marked, so `check` lists it as one to rewrite.
- [x] **Data and contracts from schema sources.**
  - The existing importers find Prisma schemas, SQL migrations, OpenAPI documents, and `.proto` files.
  - Each model, table, schema, or message becomes a `data:` entry with `source:`.
  - A Prisma datasource or a migrations directory becomes a datastore that `stores` those entries.
  - An OpenAPI or proto file becomes `provides: api:` on the element that owns it.
  - Fields come from the source, so nothing is typed by hand.
- [x] **What it can't know, it asks for.** Actors and journeys can't be inferred. `init` writes the model without them, plus a short comment block saying what to add (who uses the system, the two or three flows that matter most). It then prints the next steps (below).
- [x] **Output.**
  - Writes `.archdoc/archdoc.yaml` and `.archdoc/data.yaml` when there is data.
  - Prints counts, coverage (the share of source files an element claims, as `map` reports it), and the next steps.
  - `--dry-run` prints the model without writing it; `--json` returns the model and stats, as does `archdoc_init`.
  - Refuses when `.archdoc/` exists and points to `archdoc map`.
- [x] **Inferred means to review.** The PR comment and the explorer treat `inferred` like `suggested`: listed as facts to review, dashed on the map. Accept one by removing its `provenance` block, as today.
- [x] **The skill learns "model this repository".** A new workflow in `SKILL.md`, the `AGENTS.md` snippet, and ArchDoc's own `AGENTS.md`:
  1. `archdoc_init`.
  2. For each element, `archdoc_show <id>` with code, then rewrite its description to say what it does. Merge or split elements: a monolith needs components with `symbol:` snippets.
  3. Add actors from what the code exposes: routes, CLIs, UIs, scheduled jobs, webhooks.
  4. Write two or three journeys for the flows that matter most, with `code:` on each step.
  5. `archdoc_check` until clean.
  6. Ask a person to review it in `archdoc view`.
  7. Once they accept it, seal it: `archdoc seal --all --by <who>`.
- [x] **Measured.** On three repos, `init`'s elements and `uses` are compared with the hand-written model:
  - **ArchDoc itself:** a pnpm monorepo.
  - **The examples/org repos.**
  - **A new fixture with no JS** (Go, a compose file, SQL migrations).

  Targets:
  - At least 80% of the hand-written containers are found, by matching code paths.
  - At least 70% of the `uses` between them are found.
  - Coverage of at least 80% of source files.

  A test pins the numbers, so a regression shows.

## 3. Model, docs, website

- [x] **Dogfood model.** The critical journeys change, so ask before changing them:
  - `agent-preflight`: steps 5–7 fold into `context`.
  - `review-ai-change`: step 1, "proposes model changes", becomes "edits the model".
  - `keep-the-model-true`: `verify` becomes `check`.
  - `explain-a-bug`: `anchor` becomes `context` with `error`.

  Add an `init` component under `toolchain.analyzers` (or core, wherever its code lands). Add a `start-a-model` journey for a coding-agent on a repo without a model. Update the MCP and CLI descriptions. Re-seal what changed, after checking it.
- [x] **Agent instructions.** `AGENTS.md`, `integrations/agent-skills/AGENTS.md`, and both `SKILL.md` copies describe the five tools and the two workflows (change something; model this repository).
- [x] **README and website.**
  - For agents: the tool table becomes five rows, and the "Model a repository" section is new.
  - Getting started: begins with `archdoc init`.
  - The command table groups the aliases under the command they're part of.
- [x] **Changesets** for `@archdoc/cli`, `@archdoc/mcp`, `@archdoc/analyzers`, `@archdoc/core` (minor; MCP tools removed, CLI aliases kept).

## Result

- **Surface.** `tools/list` is 5 tools in 4,399 characters (from 21 in 16,178), with 999 characters of instructions (from 3,084). The MCP test runs the loop on a temporary repo: `context` → edit → `check` → edit the model → `seal`.
- **init on ArchDoc itself:** all 10 containers, 13 of the 17 uses between them (76%), and 142 of 144 source files. The 4 uses it misses happen at run time, not in imports (the CLI serves the explorer's build, the Action and the landscape template run the CLI, the skill calls MCP).
- **init on the demo org:** every data source the hand-written models name (payments' Prisma and proto, trips' migrations), with the Prisma datasource as a PostgreSQL datastore.
- **init on the Go fixture:** a container per `cmd/` binary and the module, compose's Postgres, Redis, and Kafka, the uses `depends_on` declares, and the migrations' tables stored in the compose database.

Where it differs from the plan:

- `validate`, `diff`, and `trace list` stay CLI commands of their own rather than aliases. They're for people and CI (a model-only gate, a model diff between two files), not questions an agent asks.
- With a base, `archdoc_check` lists concerns (what blocks, what to check) rather than raw findings, the same list the PR comment shows, so the agent and the reviewer see one thing. Findings already on the base are a count; `all` lists them.
- `init` writes containers only, except when one package is the whole repository: then its code directories become components, since a single container says nothing. It lives in `@archdoc/analyzers`, beside the shared answers.
- A path that doesn't exist yet is placed by `context` ("a new file"), which is what `locate` did for files about to be created.

## Done when

- **The agent surface:** `tools/list` has five tools and is under 6,000 characters.
- **The loop:** the end-to-end test finishes the change loop in four calls.
- **`init`:** on a fresh clone with no model, `archdoc init` writes a model that passes `validate`. On ArchDoc and the fixtures, it meets the targets in phase 2.
- **This repo:** its own model, docs, and website describe the new surface, and `archdoc check --base main` and `archdoc verify` are clean.

