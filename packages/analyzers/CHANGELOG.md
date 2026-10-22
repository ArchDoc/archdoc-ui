# @archdoc/analyzers

## 0.3.0

### Minor Changes

- Moves to 0.3.0. Skips 0.2.x, whose git tags (v0.1.2 to v0.2.0) belong to the v0 viewer. From now on, all six @archdoc packages share one version.

## 0.1.1

### Patch Changes

- a0022a8: Packages are built from clean before they're released, so they no longer ship leftover files from removed sources (0.1.0's CLI included an unused `dist/commands/data.js`). Each package now publishes as public by default.
- Updated dependencies [a0022a8]
  - @archdoc/core@0.1.1

## 0.1.0

### Minor Changes

- 0c16f45: Add `archdoc context <words…|paths…>` and the `archdoc_context` MCP tool: a short brief for starting a task, with the files and symbols to open first, other callers of the functions they use ("does the same job elsewhere"), data, rules, the journeys whose steps name the files, tests, and owners. `@archdoc/analyzers` indexes exported symbols and named imports (`indexCode`), and `search` matches file paths and symbol names with it, splitting identifiers on `_`, `-`, and camelCase. `archdoc eval` replays recent commits through `context` and reports recall; `--min-recall` fails below a threshold.
- 9b10e0b: Five agent tools instead of 21, one per question, and `archdoc init`.
  
  The MCP server now has `archdoc_context` (where to start, from a task, paths, or an error; who uses it; an overview with nothing), `archdoc_show` (one thing by ID: an element with its code, actor, journey run on a sample, data entry, `Entry.field` lineage, trace, or sealed fact), `archdoc_check` (model problems, drift, rules, traces, and sealed facts whose code changed, each with its fix; with a base, the PR comment's verdict, journeys, and who to ask; `format: "markdown"` returns the comment), `archdoc_seal` (which now says what's left to check), and `archdoc_init`. The search, locate, overview, impact, anchor, get_element, get_actor, journey, data, code, lineage, simulate, validate, verify, diff, report, trace_check, and propose tools are gone: agents edit `.archdoc/` directly and `check` validates it. The tool list an agent reads drops from about 16,000 characters to under 4,500.
  
  The CLI commands of the same name print the same answers, shared in `@archdoc/analyzers`: `check` leads with the verdict and fixes (`--all` lists everything, `--seals` is what `verify` was), `show` takes any ID and `--sample`, and `context` takes `--error` and no arguments. `search`, `locate`, `impact`, `lineage`, `simulate`, `verify`, and `trace anchor/check/show` still work, with a note naming the command they're part of. `check` now checks traces too.
  
  `archdoc init` writes a starting model for a repository without one: containers from manifests (npm, Go, Cargo, Python, Maven, Gradle) and code directories, datastores and queues from compose files, uses from imports, and data, datastores, and contracts from Prisma, SQL migrations, OpenAPI, and protobuf, every fact marked `provenance: inferred`. Inferred facts show in the PR comment and the explorer as facts to review, like suggested ones. It never writes over a model and never seals.
- 56bcc26: Data on the system canvas. A data field can point at another entry's field with `references: Charge.id` (or `Charge`, for its key); a field whose type names another entry points at it too, and SQL migrations and Prisma schemas fill references in from their foreign keys and relations. `validate` reports references that don't resolve, and the landscape keeps them pointing at the right entries. In the explorer, picking a message lights up the arrows it travels along and animates them; picking an entity opens the datastore that stores it into its tables, with a line for each foreign key, and any datastore's tables open from its card. A field's lineage now lights up on the same canvas, in every table and along every arrow on the way, instead of replacing it with a separate graph. `archdoc view` reads schema sources, so the explorer shows the types and foreign keys `check` sees.
- 5d62016: Diff, drift, and the pull request loop. `@archdoc/core` adds a semantic model diff (`diffModels`), models at any git ref (`loadModelAtRef`), `check` (undeclared dependencies, `deny` and `allow-only` rules, stale code paths, orphan elements), and the pull request impact report. The new `@archdoc/analyzers` package finds workspace manifest dependencies and TS/JS imports. The CLI adds `archdoc check [--base]`, `archdoc diff [range]`, and `archdoc report --base`. `@archdoc/mcp` drops an unused dependency on `@archdoc/spec`.
- e6a2e96: Agents close the loop, and reviewers see the change. `@archdoc/mcp` adds `archdoc_check`, `archdoc_diff`, and `archdoc_propose`, its first write tool: it adds elements and relationships to the model as suggestions with a rationale note in `.archdoc/proposals/`, never changes or removes what's there, keeps the YAML's formatting, and writes nothing that wouldn't validate. `@archdoc/core` adds `propose`, `planProposal`, `insertIntoMap`, and `readModelSourcesAtRef`. `@archdoc/analyzers` adds `checkRepository`, shared by the CLI and MCP. `archdoc view --base <ref>` shows the explorer's before/after view: changed boxes and relationships, removed ones as ghosts, suggested facts dashed, and affected journeys flagged.
- 1e8fc9f: Seals: know which parts of the model to re-check when code changes.
  
  `archdoc seal` records a fingerprint of the code each model fact points at in `.archdoc/archdoc.sum`. An element's paths are fingerprinted by the files it owns and the names they export, so a new file or a renamed export breaks the seal and a function body doesn't. Snippets, decisions, mappings, and contracts are fingerprinted by their lines (without comments and whitespace), journey steps by their entry file's exports, and data entries by their schema's fields.
  
  `archdoc check` reports `seal/changed` (with what changed) and `seal/unsealed` when a repository has an `archdoc.sum`, and with `--base` only what the change caused, so the PR comment lists them under "To check". `archdoc verify` lists the facts to re-check, with what changed and where each fact is in the model, and exits 1 while there are any. `archdoc seal <fact|element-id> --by <who>` records that someone checked. Without facts, it seals only new facts and keeps changed ones flagged, and `--all` seals everything. The PR comment says which facts a change sealed again, and who did. MCP adds `archdoc_verify` and `archdoc_seal`, which writes only `archdoc.sum`.
  
  `archdoc view` shows the same facts: the overview lists what to re-check, a box whose facts changed carries a "re-check" mark on the map, and its panel says what changed and which `archdoc seal` to run. When a change touches no code the model maps, the PR comment says so instead of "Touches the model only".
- 527f9fe: Schema importers. A data entry's `source:` names the schema it comes from: SQL migrations (`sql: migrations#charges`, replayed in file order through CREATE and ALTER TABLE), Prisma (`prisma: prisma/schema.prisma#Charge`), OpenAPI and JSON Schema (`openapi: openapi/trips.yaml#Trip`, `jsonschema: schemas/rider.json`), or Protobuf (`proto: proto/charges.proto#RefundRequest`). Fields can leave out their type when the entry has a source; `archdoc check` fills it in and reports schema drift: a modeled field the schema doesn't have (an error when it's classified, since a rename loses the classification), fields the schema has that the model doesn't, and type or enum mismatches. `@archdoc/analyzers` exports `importSchemas` and the `SchemaImporter` API; `@archdoc/core` exports `schemaDrift`, `applySchemas`, and `normalizeType`.
- a970b49: Pub-sub is a topic on the arrow. Contracts and relationships take a `transport` (http, grpc, kafka, sqs, eventbridge, or anything else). Core's `subscriptionOf` says when a relationship subscribes to a topic or event, and a journey step's message says when its data goes against the step (`against`), such as a subscriber's step to what it subscribes to. The explorer draws subscriptions from the publisher to the subscriber, labelled with their channel and transport, and plays messages, message focus, and journey steps the way the data goes. Tables inside an opened datastore take the datastore's emphasis instead of looking disabled.
  
  Code references can point at snippets: a line range (`lines: 40-88`) or a declaration (`symbol: Checkout::PlaceOrder.call`). `check` warns when a snippet no longer matches the code (`drift/stale-snippet`). `archdoc show <element> --code` and the new `archdoc_code` MCP tool print each snippet's text, so an agent reads the right lines before searching. In the explorer, every snippet links to its lines and shows them: `archdoc view` finds where each symbol's declaration is (core's `resolveSnippets`), and flags a snippet that no longer matches the code.
  
  `archdoc diff a.yaml b.yaml`, `archdoc report --base a.yaml`, and `archdoc view --base a.yaml` compare two model files without git. The PR report counts a changed relationship as touching the element it starts from, so its journeys are listed. `archdoc view` finds `<journey>.sample.json` files next to a model. A reference like `shop.orders` now resolves to that element even when the namespace is also `shop`.
  
  The examples are one flat folder: a quickstart, a modular monolith with components and snippets, an event-driven system, decisions, a big schema, and sensitive data. Three variants of the quickstart show changes to compare, and `examples/org/` (formerly `examples/acme/`) is the multi-repo demo.
- c942c74: A PR comment you can trust, and that tells a reviewer what to do.
  
  - `loadRevision` (analyzers) builds the model at any ref the way the working tree is built: schema sources, other repos' models pinned at that commit, and the repository's files. `report`, `diff`, MCP's `archdoc_diff`, and the explorer use it, so a field whose type comes from a schema no longer shows as changed on every pull request.
  - `check --base` checks the merge base too, and marks a finding introduced only when the base didn't have it. A one-line model edit is no longer blamed for warnings already on main.
  - `summarizeChange` (core) is one verdict on a change: blocking, attention, info, or none, with what blocks the merge and how to fix it, what to check, and who to involve. The PR comment and the explorer's Changes tab both render it.
  - The PR comment leads with that verdict, then blocking issues, a Before merging checklist, and a diagram of only what changed; journeys, consumers, data, drift, model changes, and findings already on the base fold. A change with no architectural impact gets one line.
  - Journey diagrams draw the steps after a decision as `alt / else` blocks with the decision's conditions.
  - A changed decision touches the element it runs in and the journeys, here and in other repos, that decide with it.
  - Bundles carry what the model's schema sources say (`schemas`), so a repo that imports another sees its field types.
  - `check --format github` prints workflow annotations; `report --explorer-url` links the change in the explorer; `archdoc site` writes the explorer as a static site, opened on a change with `--base`.

### Patch Changes

- 3f624eb: Share models across repos. `archdoc sync` reads each import's model at the newest release tag its range allows (with git, from GitHub or any git URL), vendors it in `.archdoc/vendor/`, and pins it in `.archdoc/archdoc.lock`; `--update` takes new releases and `--frozen` checks the lock in CI. `archdoc publish` writes a validated, versioned bundle for `url:` imports. `validate` and `check` now report references into other repos that don't exist at the pinned version, deprecated targets and contracts, `via` contracts the target doesn't provide, journey steps that start in another repo but don't follow its relationships, and version skew between imports. The spec adds `provides` (api, topic, event), `via` on relationships, `git:` imports with an optional `path`, and the bundle and lockfile formats. A journey step from a publisher to a subscriber now follows the message. The new `@archdoc/federation` package holds sync and publish; `check` treats lockfile and vendor changes as model changes.
- Updated dependencies [0c16f45]
- Updated dependencies [9b10e0b]
- Updated dependencies [88b968a]
- Updated dependencies [565c92d]
- Updated dependencies [bd15e1f]
- Updated dependencies [a87a18f]
- Updated dependencies [a5810d6]
- Updated dependencies [56bcc26]
- Updated dependencies [59c4690]
- Updated dependencies [5d62016]
- Updated dependencies [32d17a6]
- Updated dependencies [c3db021]
- Updated dependencies [3f624eb]
- Updated dependencies [748bedf]
- Updated dependencies [7e4b25c]
- Updated dependencies [5ccd0d8]
- Updated dependencies [b9b658d]
- Updated dependencies [71b92f5]
- Updated dependencies [030b5ce]
- Updated dependencies [e6a2e96]
- Updated dependencies [1e8fc9f]
- Updated dependencies [423d593]
- Updated dependencies [7e01863]
- Updated dependencies [6dee848]
- Updated dependencies [527f9fe]
- Updated dependencies [41786cd]
- Updated dependencies [a970b49]
- Updated dependencies [c942c74]
- Updated dependencies [b4d81ae]
  - @archdoc/core@0.1.0
