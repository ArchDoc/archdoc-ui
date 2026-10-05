# 01 — Current State Assessment

_Assessed October 2026 against `main` @ `7294093` (archdoc-ui v0.2.0, Nov 2023) and `ArchDoc.github.io` @ `5fa9937` (Apr 2025)._

## TL;DR

ArchDoc v0 is a **small, working proof of concept**: about 1,000 lines of TypeScript that read one YAML file and render a flat graph of "users" and "components" in React Flow, with a details sidebar. It still installs, builds, and passes its tests on Node 22. But the data model is too thin for the new mission. It has no hierarchy, no link to code, no notion of change over time, and no machine interface. The toolchain (Create React App, `reactflow` v11, Docusaurus 2, Node 14/16 CI) is deprecated or end-of-life.

**What's worth keeping is the idea and the brand, not the code.** That means the "model it, don't diagram it" philosophy, the plain-YAML approach with no special DSL, the `@archdoc` npm scope, the `archdoc.github.io` domain, the example models, and the UX shape (graph + details sidebar).

---

## Repository 1: `archdoc-ui`

### Layout

```
archdoc-ui/
├── bin/index.js              # npm bin shim → cli/dist
├── cli/                      # Node CLI (commander + express), ~50 LOC
│   └── src/{index.ts, actions/view.ts}
├── ui/                       # Create React App (React 18, TS 4)
│   └── src/
│       ├── App.tsx                         # fetch('/model') → parse → render
│       ├── util/ArchdocSpecParser.ts       # YAML → AJV validate → flat model
│       ├── models/ArchdocSpec.tsx          # spec types + JSON Schema (AJV)
│       ├── models/ArchdocModel2.tsx        # runtime model (used)
│       ├── models/ArchdocModel.tsx         # runtime model (UNUSED, older)
│       └── components/
│           ├── ArchdocGraphViewer/         # React Flow canvas, BFS layout, floating edges
│           ├── DetailSidebar/ UsageSummary/ Menu/ MenuItem/ ErrorPopup/
├── examples/ {blog, mealplanner, ridesharing}.yaml
└── .github/workflows/ {build, release, publish}.yml
```

### How it works today

1. `archdoc model.yaml` runs a CLI that starts Express on a **hard-coded port 7123**. It serves the YAML file at `/model` and the prebuilt CRA bundle at `/`, then opens a browser.
2. The browser fetches `/model`, parses YAML, and validates it with AJV against a schema shaped like `{ archdoc, users: {name: spec}, components: {name: spec} }`.
3. The parser flattens everything into `ArchDocComponent[]` with `type: "user" | "service"`. It computes reverse edges (`consumers`) from `dependencies`.
4. Layout is a custom breadth-first "ranking": users go in column 0, their dependencies in column 1, and so on. Nodes are placed on a fixed 200px grid.
5. Clicking a node opens a sidebar with the description, tags, repo link, consumers, dependencies, and documentation (plain text).

### Spec v1 (what users can express)

| Concept | Supported |
|---|---|
| Users (actors) and components | ✅ two flat maps |
| Component → component dependency with a description | ✅ `dependencies: {target: "why"}` |
| Tags, repository URL, free-text documentation | ✅ |
| Hierarchy (system ▸ container ▸ component), boundaries, groups | ❌ |
| Element kinds (database, queue, external system, …) | ❌ (only `user` / `service` icons) |
| Technology, protocol, sync/async, data flow | ❌ |
| Mapping to code (paths, packages, symbols) | ❌ (only a repo URL) |
| Multiple files, imports, views, flows/sequences | ❌ |
| Change over time (current → future state) | ❌ |
| Rules or constraints ("UI must not call DB") | ❌ |
| Spec-version handling | ❌ (`archdoc:` is read but never checked; docs say `1.0.0`, examples say `0.1.0`) |

### Health check (verified in this review)

| Check | Result |
|---|---|
| `yarn install --frozen-lockfile` (root, cli, ui) on Node 22 | ✅ passes (with peer-dependency warnings) |
| `cli` build (`tsc`) | ✅ |
| `ui` tests (`react-scripts test`) | ✅ 13/13. Only `computeGraphRanking` is tested, plus 3 placeholder tests |
| `ui` build | ✅ but the **545 KB gzipped** main bundle (see below) |
| End-to-end: `archdoc examples/ridesharing.yaml` in headless Chromium | ✅ renders and selection works |

### Defects found

1. **Components that no user reaches get NaN positions and break rendering.** `computeGraphRanking` only walks from users, so in `ui/public/simple-arch.yaml` the `widget-service` node gets no position. React Flow then logs `<path> attribute d: Expected number, "MNaN,NaN…"`. Verified in the browser. (`ArchdocGraph.ts`, `getColumnPosition` returns `[-1,-1]`, so `lengths[-1]` is `undefined` and the result is `NaN`.)
2. **A user with no `dependencies` crashes the parser.** The `components` branch defaults missing `dependencies` to `{}`, but the `users` branch doesn't. Verified: the UI shows `ERROR: TypeError: Cannot convert undefined or null to object`.
3. **Users can't be dependency targets, and components can't depend on users.** Validation checks only against component names. This is fine for C4 "people" but rules out actors such as an external partner system that calls back in.
4. **The sidebar covers the canvas.** The MiniMap and the right-hand nodes render under the fixed sidebar (open issues #6 and #5 relate to this).
5. **Edge arrows don't meet node outlines, and labels are off-center** (open issues #3 and #4).
6. **Bundle bloat.** `@icon-park/react/es/all` pulls in every icon. `d3` is a dependency but unused. `express` is listed in the UI's dependencies.
7. **Dead code.** `ArchdocModel.tsx`, `examples/simpleArch.ts`, `simple-arch*.json`, `sampleGraph`, `createNodesAndEdges`, and a `server` script pointing at a missing `server.js`. Many `console.log` statements are left in.
8. **Selection re-runs the full model parse** (`useEffect` on `selectedNode` calls `parseArchdocModel`).
9. **CI tests Node 14 and 16 (both EOL) and runs with `CI=false`**, so lint warnings never fail. Workflows use `actions/*@v1/v2`. Releases use `standard-version` (deprecated), and the CHANGELOG entries are empty.

### Toolchain status (October 2026)

| Piece | In use | Status |
|---|---|---|
| Create React App 5 | `ui` | **Deprecated (Feb 2025).** Conflicts with React 19 peers. Replace with Vite. |
| `reactflow` 11 | graph | Renamed to **`@xyflow/react` 12**, with a breaking import/API migration |
| TypeScript 4.x | all | Several majors behind |
| Node 14/16 | CI | EOL. Target Node 22/24 LTS. |
| AJV 8 + hand-written schema | spec | Fine, but types and schema are maintained separately |
| yarn v1, three separate lockfiles | repo | Use one workspace (pnpm) |

---

## Repository 2: `ArchDoc.github.io`

- **Docusaurus 2.4** site (React 17). Docusaurus 3 has been current since late 2023. Content is versioned (`1.0.0`).
- **Content:** spec overview, definitions, schema pages for `ArchDoc`, `User`, and `Component`, a getting-started guide, and one launch blog post ("ArchDoc Specification v1.0", May 2023).
- **Leftover template content:** `src/pages/markdown-page.md`, the `docusaurus*.png` and `undraw_*` images, a README that's still the template, an empty `docs/archdoc-ui/index.md` ("Docs Overview"), and `projectName: 'archdoc-spec'`.
- **Spec-doc mismatches with the code:**
  - The docs mark `dependencies` as required, but the code treats it as optional for components.
  - The docs and UI disagree on terminology ("services" was renamed to "components" in 0.2.0, but the node type is still `service`).
  - The archdoc-ui README links to a GitHub wiki that doesn't exist.
- The blog post's positioning ("an open, free alternative to Structurizr / IcePanel / Ilograph") is still a useful seed for the new mission, but the landscape has moved (see [02-strategy-options.md](./02-strategy-options.md)).

## Open issues (archdoc-ui)

| # | Title | Status after re-architecture |
|---|---|---|
| 3 | Node labels misaligned | Moot with a new renderer |
| 4 | Edge arrows don't end at node shape | Moot with a new renderer |
| 5 | Auto focus/center on clicked node | Carry forward as a UX requirement |
| 6 | Resizable side panel | Carry forward as a UX requirement |

## What to salvage

| Keep | Why |
|---|---|
| Brand, `@archdoc` npm scope, `archdoc.github.io`, MIT license | Existing identity and distribution |
| Philosophy: plain YAML, no custom DSL; "model, don't diagram" | Even more relevant now: agents edit structured YAML reliably, and JSON Schema gives them precise errors |
| `examples/*.yaml` | Fixtures for the v1→v2 migrator and layout tests |
| `ArchdocGraph.test.ts` cases | Reuse as regression cases for the new layout engine |
| UX shape: canvas + details panel, consumer/dependency inversion, click-through navigation | Proven, simple, and the starting point for "explore and learn" |
| Floating-edge geometry (`util.ts`) | Optional. xyflow 12 ships an equivalent example. |

Everything else is cheaper to rewrite than to migrate.
