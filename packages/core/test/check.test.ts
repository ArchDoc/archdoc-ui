import { describe, expect, it } from "vitest";
import { check, type ObservedDependency, observedEdges } from "../src/index.js";
import { model, root } from "./helpers.js";

const m = model({
  "archdoc.yaml": root(`
    elements:
      web: { kind: container, tags: [frontend], code: apps/web/**, uses: { api: Calls } }
      api:
        kind: container
        code: services/api/**
        elements:
          routes: { kind: component, code: services/api/routes/** }
          store: { kind: component, code: services/api/store/** }
      db: { kind: datastore, code: db/** }
      jobs: { kind: container, code: services/jobs/** }
      lonely: { kind: container, code: services/lonely/** }
      gone: { kind: container, code: services/gone/**, uses: { db: Old } }
    rules:
      - id: no-ui-to-db
        deny: { from: { tag: frontend }, to: { kind: datastore } }
      - id: only-api-touches-db
        severity: warning
        allow-only: { to: db, from: [api] }
      - id: only-api-touches-db-typo
        deny: { from: nothing-here, to: db }
      - id: later
        require-review: { journeys: { importance: critical } }
  `),
});

const dep = (
  from: string,
  to: string,
  extra: Partial<ObservedDependency> = {},
): ObservedDependency => ({
  from,
  to,
  analyzer: "test",
  line: 1,
  ...extra,
});

describe("observedEdges", () => {
  it("maps file dependencies onto elements and checks them against declarations", () => {
    const edges = observedEdges(m, [
      dep("apps/web/a.ts", "services/api/routes/x.ts"), // covered by web → api (a declaration to the whole)
      dep("services/api/routes/r.ts", "services/api/store/s.ts"), // siblings: still to declare
      dep("services/api/routes/r.ts", "services/api/x.ts"), // a part to its own parent: ignored
      dep("services/jobs/j.ts", "db/schema.ts"), // undeclared
      dep("services/jobs/j.ts", "db/types.ts", { typeOnly: true }),
      dep("README.md", "db/x"), // unmapped source: ignored
    ]);
    expect(edges.map((e) => [e.from, e.to, e.declared, e.typeOnly, e.dependencies.length])).toEqual(
      [
        ["api.routes", "api.store", false, false, 1],
        ["jobs", "db", false, false, 2],
        ["web", "api.routes", true, false, 1],
      ],
    );
  });
});

describe("check", () => {
  const result = check(m, {
    observed: [
      dep("services/jobs/j.ts", "db/schema.ts", { specifier: "../../db/schema" }),
      dep("apps/web/w.ts", "db/client.ts", { typeOnly: true }),
    ],
    files: [
      "apps/web/w.ts",
      "services/api/routes/r.ts",
      "services/api/store/s.ts",
      "db/schema.ts",
      "services/jobs/j.ts",
    ],
  });
  const codes = result.findings.map((f) => `${f.severity} ${f.code} ${f.element ?? f.rule ?? ""}`);

  it("flags undeclared dependencies, with type-only ones as warnings", () => {
    expect(codes).toContain("error drift/undeclared-dependency jobs");
    expect(codes).toContain("warning drift/undeclared-dependency web");
    const f = result.findings.find(
      (x) => x.element === "jobs" && x.code === "drift/undeclared-dependency",
    );
    expect(f?.evidence).toEqual(["services/jobs/j.ts:1 (../../db/schema)"]);
    expect(f?.files).toEqual(["services/jobs/j.ts"]);
  });

  it("evaluates deny and allow-only rules on declared and observed relationships", () => {
    const rules = result.findings
      .filter((f) => f.code === "rule/violation")
      .map((f) => `${f.severity} ${f.rule}: ${f.message.split(",")[0]}`);
    expect(rules).toEqual(
      expect.arrayContaining([
        "error no-ui-to-db: The code has web → db",
        "warning only-api-touches-db: The model declares gone → db",
        "warning only-api-touches-db: The code has jobs → db",
      ]),
    );
  });

  it("reports unknown rule selectors", () => {
    expect(codes).toContain("warning rule/unknown-selector only-api-touches-db-typo");
  });

  it("reports stale code paths and orphan elements", () => {
    expect(codes).toContain("warning drift/stale-path lonely");
    expect(codes).toContain("warning model/orphan-element lonely");
    expect(codes).toContain("warning model/orphan-element api.store");
    // Elements with relationships, or with parts, aren't orphans.
    expect(codes).not.toContain("warning model/orphan-element db");
    expect(codes).not.toContain("warning model/orphan-element api");
  });

  it("puts errors first", () => {
    const severities = result.findings.map((f) => f.severity);
    expect(severities.indexOf("warning")).toBeGreaterThan(severities.lastIndexOf("error"));
  });

  it("lets parts of one element depend on each other under a deny rule", () => {
    const parts = model({
      "archdoc.yaml": root(`
        elements:
          web:
            kind: container
            elements:
              ui: { kind: component, uses: { graph: Renders } }
              graph: { kind: component }
          mcp: { kind: container }
        rules:
          - id: surfaces
            deny: { from: [web, mcp], to: [web, mcp] }
      `),
    });
    expect(check(parts).findings.filter((f) => f.code === "rule/violation")).toEqual([]);
  });
});
