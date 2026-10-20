import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anchorError,
  checkTrace,
  createBundle,
  federate,
  formatAnchors,
  formatTrace,
  formatTraceChecks,
  integrityOf,
  listRepoFiles,
  loadModel,
  loadTraces,
  type Model,
  parseTrace,
  readModelSourcesAtRef,
  readTraceSources,
  serializeBundle,
  traceCodeRefs,
  traceSkeleton,
  tracesInChange,
} from "../src/index.js";
import { dedent, model } from "./helpers.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

const shop = () =>
  model({
    "archdoc.yaml": `
      archdoc: "2.0"
      namespace: shop
      imports:
        payments: { github: acme/payments, version: ^5 }
      actors:
        buyer: { kind: person, uses: { web: Shops } }
      elements:
        web:
          kind: container
          code: apps/web/**
          uses: { api: Calls }
        api:
          kind: container
          code: services/api/**
          uses:
            db: Reads and writes orders
            payments.charges: Charges the card
          elements:
            orders:
              kind: component
              code: services/api/orders/**
            checkout:
              kind: component
              code: [{ path: services/api/checkout/**, }, { path: services/api/checkout/pay.ts, symbol: payOrder }]
        db: { kind: datastore, code: db/** }
        mailer: { kind: container, code: services/mailer/** }
        search:
          kind: system
          elements:
            orders: { kind: component }
      journeys:
        checkout:
          actor: buyer
          goal: Buy what's in the cart
          importance: critical
          steps:
            - { from: buyer, to: web, action: Clicks pay }
            - { from: web, to: api, action: POST /checkout, code: services/api/checkout/pay.ts }
            - { from: api, to: db, action: Saves the order, sends: Order }
            - { from: api, to: payments.charges, action: Charges the card }
        browse:
          actor: buyer
          goal: Find something
          steps:
            - { from: buyer, to: web, action: Searches }
            - { from: web, to: api, action: GET /products }
      data:
        Order:
          kind: entity
          fields: { id: { type: uuid } }
    `,
  });

const trace = (yaml: string, file = ".archdoc/traces/t.yaml") => {
  const r = parseTrace(file, dedent(yaml));
  if (!r.trace) throw new Error(JSON.stringify(r.diagnostics));
  return r.trace;
};

const FILES = [
  "apps/web/src/cart.ts",
  "services/api/checkout/pay.ts",
  "services/api/orders/save.ts",
  "db/schema.sql",
  "services/mailer/send.ts",
];
const TEXT: Record<string, string> = {
  "services/api/checkout/pay.ts": "export function payOrder() {\n  return save();\n}\n",
};
const opts = { files: FILES, read: (p: string) => TEXT[p] };

const codesOf = (r: { findings: { code: string }[] }) => r.findings.map((f) => f.code);

describe("parseTrace", () => {
  it("reads a trace, with where each part is written", () => {
    const t = trace(`
      trace: t
      title: Orders save twice
      symptom: duplicate key
      expands: checkout#3
      steps:
        - { from: api, to: db, action: Saves, role: cause, evidence: reproduced, code: services/api/orders/save.ts:12 }
    `);
    expect(t.id).toBe("t");
    expect(t.spec.steps[0]?.role).toBe("cause");
    expect(t.locations.expands).toMatchObject({ line: 4 });
    expect(t.locations["steps.0.code"]).toMatchObject({ line: 6 });
  });

  it("reports schema problems with a location, and duplicate IDs", () => {
    const bad = parseTrace(
      "x.yaml",
      "trace: x\ntitle: t\nsymptom: s\nsteps:\n  - { from: a, to: b, role: culprit }\n",
    );
    expect(bad.trace).toBeUndefined();
    expect(bad.diagnostics[0]).toMatchObject({ code: "schema/invalid", location: { line: 5 } });
    const text = "trace: x\ntitle: t\nsymptom: s\nsteps: [{ from: a, to: b }]\n";
    const r = loadTraces([
      { path: "a.yaml", text },
      { path: "b.yaml", text },
    ]);
    expect(r.traces).toHaveLength(1);
    expect(r.diagnostics).toMatchObject([
      { code: "trace/duplicate", message: expect.stringContaining("a.yaml") },
    ]);
  });

  it("reads code references in every form", () => {
    expect(
      traceCodeRefs([
        "a.ts",
        "a.ts:12",
        "a.ts:12:5",
        "a.ts:10-20",
        { path: "b.ts", lines: 3, symbol: "f" },
      ]),
    ).toEqual([
      { path: "a.ts" },
      { path: "a.ts", lines: "12" },
      { path: "a.ts", lines: "12" },
      { path: "a.ts", lines: "10-20" },
      { path: "b.ts", lines: "3", symbol: "f", description: undefined },
    ]);
  });
});

describe("checkTrace", () => {
  it("resolves the journey step it expands, and each hop against the model", () => {
    const r = checkTrace(
      shop(),
      trace(`
        trace: t
        title: Checkout fails
        symptom: "500"
        expands: checkout#2
        steps:
          - { from: web, to: api, action: Posts the cart, evidence: reproduced }
          - from: api
            to: api.orders
            action: Saves the order
            role: cause
            evidence: read
            code: services/api/checkout/pay.ts:2
            observed: { Order.id: null }
            expected: { Order.id: uuid }
            missing: { to: db, call: insert }
          - { from: api.orders, to: db, action: Writes, role: spreads, evidence: read }
          - { from: api, to: web, action: Answers 500, role: symptom, evidence: reproduced }
      `),
      opts,
    );
    expect(r.findings).toEqual([]);
    const v = r.view;
    expect(v.anchor).toMatchObject({
      status: "found",
      journey: "checkout",
      step: 2,
      importance: "critical",
      modeled: { from: { id: "web" }, to: { id: "api" }, code: "services/api/checkout/pay.ts" },
    });
    expect(v.steps.map((s) => s.hop.kind)).toEqual(["uses", "inside", "uses", "returns"]);
    // orders → db is declared on api, the parent: the model is coarser there.
    expect(v.steps[2]?.hop).toMatchObject({
      relationship: { from: "api", to: "db" },
      lifted: true,
    });
    expect(v.steps[1]).toMatchObject({
      from: { id: "api", status: "resolved", type: "element" },
      role: "cause",
      evidence: "read",
      within: true,
      code: [
        { path: "services/api/checkout/pay.ts", lines: "2", exists: true, element: "api.checkout" },
      ],
      missing: { from: { id: "api" }, to: { id: "db" }, call: "insert", hop: { kind: "uses" } },
    });
    // db is past the step it expands (web → api).
    expect(v.steps[2]?.within).toBe(false);
    expect(v.causes).toEqual([2]);
    expect(v.undeclared).toEqual([]);
  });

  it("reports elements, journeys, and steps that don't exist", () => {
    const m = shop();
    const r = checkTrace(
      m,
      trace(`
        trace: t
        title: x
        symptom: x
        expands: nope#1
        actor: ghost
        steps:
          - { from: web, to: nowhere, role: cause, evidence: read }
          - { from: orders, to: db, evidence: read }
          - { from: web, to: api, evidence: read }
        works-in: { element: missing }
      `),
    );
    expect(codesOf(r)).toEqual([
      "trace/unknown-journey",
      "trace/unknown-actor",
      "trace/unknown-element",
      "trace/unknown-element",
      "trace/ambiguous-element",
    ]);
    expect(r.findings[2]?.message).toContain('"missing" is not an element');
    expect(r.findings[3]).toMatchObject({ step: 1, location: { line: 7 } });
    expect(r.findings[4]?.message).toContain("api.orders or search.orders");
    expect(r.findings[0]?.message).toContain("Known: checkout, browse");
    const step = checkTrace(
      m,
      trace(
        "trace: t\ntitle: x\nsymptom: x\nexpands: checkout#9\nsteps: [{ from: web, to: api, role: cause, evidence: read }]",
      ),
    );
    expect(step.findings).toMatchObject([
      { code: "trace/unknown-step", message: expect.stringContaining("has 4 steps") },
    ]);
  });

  it("warns about hops the model doesn't declare, stale code, and a missing cause", () => {
    const r = checkTrace(
      shop(),
      trace(`
        trace: t
        title: x
        symptom: x
        steps:
          - { from: web, to: mailer, action: Sends a receipt, code: services/mailer/send.ts }
          - { from: api, to: db, code: [services/api/gone.ts, "services/api/checkout/pay.ts:40", { path: services/api/checkout/pay.ts, symbol: refund }], evidence: read }
          - { from: api.checkout, to: db, code: apps/web/src/cart.ts:1, evidence: read }
      `),
      opts,
    );
    expect(r.findings.map((f) => [f.severity, f.code, f.step])).toEqual([
      ["warning", "trace/no-anchor", undefined],
      ["warning", "trace/no-cause", undefined],
      ["warning", "trace/undeclared-hop", 1],
      ["warning", "trace/stale-code", 2],
      ["warning", "trace/stale-code", 2],
      ["warning", "trace/stale-code", 2],
      ["info", "trace/no-evidence", undefined],
      ["info", "trace/code-elsewhere", 3],
    ]);
    const messages = r.findings.map((f) => f.message).join("\n");
    expect(messages).toContain("Step 1: web → mailer isn't a relationship the model declares");
    expect(messages).toContain("services/api/gone.ts is not in the repository");
    expect(messages).toContain("has 3 lines, not 40");
    expect(messages).toContain("doesn't declare refund");
    expect(messages).toContain("Step 1 says no evidence");
    expect(r.view.undeclared).toEqual([1]);
    expect(r.view.steps[0]?.within).toBeUndefined();
  });

  it("notes ends in a repo that isn't synced once, and checks them once it is", () => {
    const t = trace(`
      trace: t
      title: x
      symptom: x
      expands: checkout#4
      steps:
        - { from: api, to: payments.charges, role: cause, evidence: read }
        - { from: payments.charges, to: payments.ledger, evidence: read }
        - { from: payments.charges, to: payments.refunds, evidence: read }
    `);
    const unsynced = checkTrace(shop(), t);
    expect(unsynced.findings.map((f) => [f.code, f.message])).toEqual([
      [
        "trace/unverified",
        "payments isn't synced, so what the trace says about it (steps 1, 2, 3) can't be checked. Run archdoc sync.",
      ],
    ]);
    expect(unsynced.view.steps.map((s) => s.hop.kind)).toEqual([
      "unverified",
      "unverified",
      "unverified",
    ]);

    const synced = federated(shop());
    const r = checkTrace(synced, t);
    expect(r.findings.map((f) => f.code)).toEqual(["trace/unknown-element"]);
    expect(r.findings[0]?.message).toContain(
      'payments@5.1.0 has no "refunds". Did you mean payments.charges.refunds?',
    );
    expect(r.view.anchor?.modeled?.to).toMatchObject({
      id: "payments.charges",
      status: "external",
      namespace: "payments",
    });
    expect(r.view.steps.map((s) => s.hop)).toMatchObject([
      { kind: "uses", relationship: { from: "api", to: "payments.charges", namespace: "shop" } },
      {
        kind: "uses",
        relationship: { from: "payments.charges", to: "payments.ledger", namespace: "payments" },
      },
      { kind: "unknown" },
    ]);
  });

  it("expands a journey in another repo", () => {
    const r = checkTrace(
      federated(shop()),
      trace(`
        trace: t
        title: x
        symptom: x
        expands: payments.refund#1
        steps: [{ from: payments.charges, to: payments.ledger, role: cause, evidence: read }]
      `),
    );
    expect(r.findings).toEqual([]);
    expect(r.view.anchor).toMatchObject({
      namespace: "payments",
      status: "found",
      modeled: { from: { id: "payments.charges" }, to: { id: "payments.ledger" } },
    });
    expect(r.view.steps[0]?.within).toBe(true);
  });

  it("checks ArchDoc's own traces against the code", async () => {
    const m = await loadModel(".", { cwd: repo });
    const { traces, diagnostics } = loadTraces(await readTraceSources(".", { cwd: repo }));
    expect(diagnostics).toEqual([]);
    const files = await listRepoFiles(repo);
    const read = (p: string) => readFileSync(join(repo, p), "utf8");
    for (const t of traces) {
      const r = checkTrace(m, t, { files, read });
      expect(r.findings.filter((f) => f.severity === "error")).toEqual([]);
    }
    const report = traces.find((t) => t.id === "report-false-data-changes");
    expect(report).toBeDefined();
    const r = checkTrace(m, report as never, { files, read });
    expect(r.view.anchor?.modeled).toMatchObject({
      from: { id: "toolchain.cli" },
      to: { id: "toolchain.core" },
    });
    expect(r.view.causes).toEqual([2]);
    expect(formatTrace(r.view)).toContain(
      "2. ✗ cause  toolchain.cli → toolchain.core.loader: Loads base at the ref  [reproduced]",
    );
  });
});

describe("the model loader", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "archdoc-traces-"));
    await mkdir(join(dir, ".archdoc/traces"), { recursive: true });
    await mkdir(join(dir, ".archdoc/model/traces"), { recursive: true });
    await writeFile(join(dir, ".archdoc/archdoc.yaml"), 'archdoc: "2.0"\nnamespace: shop\n');
    await writeFile(
      join(dir, ".archdoc/model/traces/api.yaml"),
      "elements:\n  api: { kind: container }\n",
    );
    await writeFile(
      join(dir, ".archdoc/traces/slow.yaml"),
      "trace: slow\ntitle: Slow\nsymptom: timeout\nsteps: [{ from: api, to: api }]\n",
    );
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...args], {
        cwd: dir,
      });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("never reads traces as model files, here or at a commit", async () => {
    const m = await loadModel(".", { cwd: dir });
    expect(m.diagnostics).toEqual([]);
    // Only the top-level traces/ directory is special.
    expect(m.files).toEqual([".archdoc/archdoc.yaml", ".archdoc/model/traces/api.yaml"]);
    const at = await readModelSourcesAtRef(".", "main", { cwd: dir });
    expect(at.sources.map((s) => s.path)).toEqual([
      "main:.archdoc/archdoc.yaml",
      "main:.archdoc/model/traces/api.yaml",
    ]);
  });

  it("reads traces on their own", async () => {
    const sources = await readTraceSources(".", { cwd: dir });
    expect(sources.map((s) => s.path)).toEqual([".archdoc/traces/slow.yaml"]);
    expect(loadTraces(sources).traces[0]?.id).toBe("slow");
    expect(await readTraceSources("nowhere", { cwd: dir })).toEqual([]);
  });
});

describe("anchorError", () => {
  const files = [...FILES, "services/api/orders/src/save.ts"];

  it("maps a Node stack from built files to source files, elements, and journey steps", () => {
    const text = [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "    at saveOrder (file:///srv/app/services/api/orders/dist/save.js:14:9)",
      "    at async payOrder (/srv/app/services/api/checkout/pay.ts:2:10)",
      "    at async Promise.all (index 0)",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ].join("\n");
    const r = anchorError(shop(), text, { files });
    expect(r.evidence.filter((e) => e.kind === "frame")).toMatchObject([
      {
        path: "services/api/orders/src/save.ts",
        line: 14,
        function: "saveOrder",
        element: "api.orders",
        depth: 0,
      },
      {
        path: "services/api/checkout/pay.ts",
        line: 2,
        function: "payOrder",
        element: "api.checkout",
        depth: 1,
      },
      { depth: 2 },
    ]);
    expect(r.elements.map((e) => e.element)).toEqual(["api.checkout", "api.orders"]);
    // The step whose code: is in the stack ranks first.
    expect(r.anchors[0]).toMatchObject({ journey: "checkout", step: 2, from: "web", to: "api" });
    expect(r.anchors[0]?.reasons[0]).toBe(
      "its code is services/api/checkout/pay.ts, which the error names",
    );
    expect(r.unmapped).toEqual([]);
    // Deterministic.
    expect(anchorError(shop(), text, { files })).toEqual(r);
  });

  it("reads Python, Go, Rust, and plain path:line references", () => {
    const m = shop();
    const python = anchorError(
      m,
      'Traceback (most recent call last):\n  File "/srv/app/services/api/checkout/pay.ts", line 2, in pay\n  File "services/api/orders/save.ts", line 9, in save\nKeyError: id',
      { files },
    );
    // Python prints the innermost frame last.
    expect(python.evidence.map((e) => [e.element, e.depth])).toEqual([
      ["api.checkout", 1],
      ["api.orders", 0],
    ]);
    const goFile = anchorError(m, "panic\n\t/build/services/mailer/send.go:12 +0x1d", {
      files: ["services/mailer/send.go"],
    });
    expect(goFile.evidence[0]).toMatchObject({
      kind: "frame",
      path: "services/mailer/send.go",
      line: 12,
      element: "mailer",
    });
    const rust = anchorError(
      m,
      "error[E0382]: borrow of moved value\n --> services/mailer/src/main.rs:4:5",
      {},
    );
    expect(rust.evidence[0]).toMatchObject({
      kind: "frame",
      path: "services/mailer/src/main.rs",
      line: 4,
      column: 5,
      element: "mailer",
    });
    const plain = anchorError(
      m,
      "ERROR db/schema.sql:3 relation exists; see apps/web/src/cart.ts",
      { files },
    );
    expect(plain.evidence.map((e) => [e.kind, e.path, e.line])).toEqual([
      ["path", "db/schema.sql", 3],
      ["path", "apps/web/src/cart.ts", undefined],
    ]);
  });

  it("uses names the model knows: data entries and symbols", () => {
    const r = anchorError(shop(), "payOrder failed: Order not saved", {});
    expect(r.evidence).toMatchObject([
      { kind: "identifier", text: "payOrder", names: "symbol", element: "api.checkout" },
      { kind: "identifier", text: "Order", names: "data" },
    ]);
    expect(r.anchors[0]).toMatchObject({ journey: "checkout", step: 3 });
    expect(r.anchors[0]?.reasons).toContain("sends or writes Order, which the error names");
  });

  it("says when nothing maps, and keeps paths it can't place", () => {
    const r = anchorError(shop(), "Segfault in /usr/lib/libfoo.so:1", { files });
    expect(r.anchors).toEqual([]);
    expect(r.unmapped).toEqual(["/usr/lib/libfoo.so"]);
    expect(formatAnchors(r)).toContain("Nothing in the error maps to the model");
  });

  it("suggests a trace that parses, with a step for each call between elements", () => {
    const text =
      "Error: no order\n    at saveOrder (/srv/app/services/api/orders/save.ts:14:9)\n    at payOrder (/srv/app/services/api/checkout/pay.ts:2:10)";
    const m = shop();
    const r = anchorError(m, text, { files });
    const skeleton = traceSkeleton(r, text);
    const parsed = parseTrace("skeleton.yaml", skeleton);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.trace?.spec).toMatchObject({
      trace: "error-no-order",
      expands: "checkout#2",
      steps: [
        {
          from: "api.checkout",
          to: "api.orders",
          code: "services/api/checkout/pay.ts:2",
          evidence: "reproduced",
          role: "symptom",
        },
      ],
    });
    const checked = checkTrace(m, parsed.trace as never, { files });
    expect(checked.findings.filter((f) => f.severity === "error")).toEqual([]);
    // Without frames, one step on the best anchor.
    const bare = traceSkeleton(anchorError(m, "Order not saved", {}), "Order not saved");
    expect(parseTrace("b.yaml", bare).trace?.spec.steps).toMatchObject([{ from: "api", to: "db" }]);
    expect(
      parseTrace("c.yaml", traceSkeleton(anchorError(m, "?", {}), "?")).trace?.spec.actor,
    ).toBeDefined();
  });
});

describe("tracesInChange", () => {
  it("lists the traces a change adds or edits, with their journey step", () => {
    const { traces } = loadTraces([
      {
        path: ".archdoc/traces/a.yaml",
        text: "trace: a\ntitle: A\nsymptom: s\nexpands: checkout#3\nsteps: [{ from: x, to: y, role: cause }]\n",
      },
      {
        path: ".archdoc/traces/b.yaml",
        text: "trace: b\ntitle: B\nsymptom: s\nsteps: [{ from: x, to: y }]\n",
      },
    ]);
    expect(tracesInChange(["src/x.ts", ".archdoc/traces/a.yaml"], traces)).toEqual([
      {
        id: "a",
        title: "A",
        anchor: "checkout step 3",
        file: ".archdoc/traces/a.yaml",
        journey: "checkout",
        step: 3,
        causes: [1],
      },
    ]);
    expect(tracesInChange(["repo/.archdoc/traces/b.yaml"], traces).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("trace text", () => {
  it("sums up checks", () => {
    const r = checkTrace(
      shop(),
      trace(
        "trace: t\ntitle: Broken\nsymptom: x\nexpands: checkout#2\nsteps: [{ from: web, to: mailer, role: cause, evidence: read }]",
      ),
    );
    expect(formatTraceChecks([r])).toBe(
      [
        "! t · Broken",
        "    expands checkout#2 (web → api) · 1 step · cause at step 1 · 1 hop the model doesn't declare",
        "    ! .archdoc/traces/t.yaml:5:9 warning trace/undeclared-hop Step 1: web → mailer isn't a relationship the model declares. If the code really does this, add it to the model (archdoc_propose) or fix the code.",
        "",
        "1 trace: 0 errors, 1 warning.",
      ].join("\n"),
    );
    expect(formatTraceChecks([])).toContain("No traces.");
  });
});

/** The shop model with a synced payments repo. */
function federated(m: Model): Model {
  const { bundle } = createBundle(
    [
      {
        path: "archdoc.yaml",
        text: dedent(`
          archdoc: "2.0"
          namespace: payments
          actors:
            clerk: { kind: role, uses: { charges: Refunds } }
          elements:
            charges:
              kind: container
              uses: { ledger: Records }
              elements:
                refunds: { kind: component }
            ledger: { kind: datastore }
          journeys:
            refund:
              actor: clerk
              goal: Refund a charge
              steps:
                - { from: charges, to: ledger, action: Records the refund }
        `),
      },
    ],
    "archdoc.yaml",
    { version: "5.1.0", commit: "a".repeat(40), source: "github:acme/payments" },
  );
  if (!bundle) throw new Error("payments doesn't build");
  const text = serializeBundle(bundle);
  return federate(m, {
    lockPath: ".archdoc/archdoc.lock",
    lock: {
      lockfileVersion: 1,
      imports: {
        payments: {
          source: "github:acme/payments",
          requested: "^5",
          version: "5.1.0",
          bundle: "vendor/payments.json",
          integrity: integrityOf(text),
        },
      },
    },
    bundles: new Map([
      ["payments", { path: ".archdoc/vendor/payments.json", text, integrity: integrityOf(text) }],
    ]),
  });
}
