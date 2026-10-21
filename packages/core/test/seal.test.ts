import { describe, expect, it } from "vitest";
import {
  type CodeIndex,
  describeChanges,
  fingerprints,
  formatSum,
  normalizeForSeal,
  parseSum,
  sealableFacts,
  sealedPaths,
  sealFindings,
  sealStatuses,
  sealSum,
} from "../src/index.js";
import { model, root } from "./helpers.js";

const m = model({
  "archdoc.yaml": root(`
    elements:
      api:
        kind: container
        code:
          - { path: services/api/** }
          - { path: services/api/refunds.ts, symbol: approve }
        provides:
          - { api: proto/charges.proto }
      db: { kind: datastore }
    data:
      Charge:
        kind: entity
        source: { prisma: prisma/schema.prisma#Charge }
        fields: { card_last4: { classification: pci } }
    logic:
      approval:
        input: { charge: Charge }
        code: { path: services/api/refunds.ts, symbol: approve }
        rules: [{ else: review }]
    actors:
      rider: { kind: person, uses: { api: Asks } }
    journeys:
      refund:
        actor: rider
        goal: Get money back
        steps:
          - { from: rider, to: api, action: Asks, code: services/api/routes.ts }
  `),
});

const refunds = [
  "// Refunds.",
  "export function approve(amount: number) {",
  "  return amount < 100;",
  "}",
  "",
  "export const other = 1;",
].join("\n");

const repo = (overrides: Record<string, string | undefined> = {}) => {
  const texts: Record<string, string | undefined> = {
    "services/api/refunds.ts": refunds,
    "services/api/routes.ts": "export const routes = [];\n",
    "services/api/README.md": "# API\n",
    "services/api/refunds.test.ts": "test\n",
    "proto/charges.proto": 'syntax = "proto3";\nmessage Charge {}\n',
    ...overrides,
  };
  const files = Object.keys(texts).filter((f) => texts[f] !== undefined);
  const index: CodeIndex = {
    files,
    sources: [
      {
        path: "services/api/refunds.ts",
        exports: exportsOf(texts["services/api/refunds.ts"]),
        imports: [],
      },
      {
        path: "services/api/routes.ts",
        exports: exportsOf(texts["services/api/routes.ts"]),
        imports: [],
      },
    ],
  };
  return { files, read: (p: string) => texts[p], index };
};

function exportsOf(text: string | undefined) {
  return [...(text ?? "").matchAll(/export (?:function|const) (\w+)/g)].map((x, i) => ({
    name: x[1] as string,
    kind: "function" as const,
    line: i + 1,
  }));
}

const schemas = (fields: Record<string, string>) => [
  {
    data: "Charge",
    kind: "prisma",
    ref: "prisma/schema.prisma#Charge",
    files: ["prisma/schema.prisma"],
    fields: Object.fromEntries(Object.entries(fields).map(([k, type]) => [k, { type }])),
  },
];

describe("seals", () => {
  it("finds every fact that points at code", () => {
    expect(sealableFacts(m).map((f) => `${f.key} ${f.kind}`)).toEqual([
      "contract:api#proto/charges.proto content",
      "data:Charge schema",
      "element:api structure",
      "element:api#services/api/refunds.ts:approve content",
      "logic:approval content",
      "step:refund#1 structure",
    ]);
    expect(sealedPaths(m)).toEqual(["proto/charges.proto", "services/api/refunds.ts"]);
  });

  const sealedAt = (r: ReturnType<typeof repo>, fields: Record<string, string> = { id: "uuid" }) =>
    fingerprints(m, { ...r, schemas: schemas(fields) });

  it("doesn't break on edits that leave the facts true: comments, blank lines, bodies outside snippets", () => {
    const { sum } = sealSum(sealStatuses(sealedAt(repo()), undefined), { all: true });
    const edited = repo({
      "services/api/refunds.ts": `${refunds.replace("// Refunds.", "// Refunds, reworded.")}\n\n`,
      "services/api/routes.ts": "export const routes = ['/refunds'];\n",
      "services/api/refunds.test.ts": "another test\n",
    });
    const statuses = sealStatuses(sealedAt(edited), sum);
    expect(statuses.filter((s) => s.state !== "sealed")).toEqual([]);
  });

  it("says what changed when a fact's code does", () => {
    const { sum } = sealSum(sealStatuses(sealedAt(repo()), undefined), { all: true });
    const changed = repo({
      "services/api/refunds.ts": refunds.replace("amount < 100", "amount < 500"),
      "services/api/new.ts": "export const fresh = 1;\n",
      "proto/charges.proto": undefined,
    });
    const statuses = sealStatuses(sealedAt(changed, { id: "uuid", ssn: "string" }), sum);
    const changes = Object.fromEntries(
      statuses.filter((s) => s.state === "changed").map((s) => [s.fact.key, s.changes]),
    );
    expect(changes).toEqual({
      "contract:api#proto/charges.proto": ["proto/charges.proto is gone"],
      "data:Charge": ["+ ssn (string)"],
      "element:api": ["+ services/api/new.ts"],
      "element:api#services/api/refunds.ts:approve": ["services/api/refunds.ts (approve) changed"],
      "logic:approval": ["services/api/refunds.ts (approve) changed"],
    });
    const findings = sealFindings(statuses, ".archdoc/archdoc.sum");
    expect(findings.map((f) => f.code)).toEqual(Array(5).fill("seal/changed"));
    expect(findings.find((f) => f.message.includes("data entry Charge"))?.message).toContain(
      "then run archdoc seal data:Charge",
    );
  });

  it("reports renamed exports in a structure", () => {
    expect(
      describeChanges(
        { kind: "structure", hash: "a", files: { "x.ts": ["load", "keep"] } },
        { kind: "structure", hash: "b", files: { "x.ts": ["loadRevision", "keep"] } },
      ),
    ).toEqual(["x.ts: exports loadRevision, no longer exports load"]);
  });

  it("seals new facts by default and keeps changed ones flagged until named", () => {
    const first = sealSum(sealStatuses(sealedAt(repo()), undefined), {});
    expect(first.sealed).toHaveLength(6);
    const changed = repo({ "services/api/new.ts": "export const fresh = 1;\n" });
    const statuses = sealStatuses(sealedAt(changed), first.sum);
    const plain = sealSum(statuses, {});
    expect(plain.sealed).toEqual([]);
    expect(plain.sum.seals["element:api"]).toEqual(first.sum.seals["element:api"]);
    // An element's ID seals every fact of that element; who checked is recorded.
    const named = sealSum(statuses, { keys: ["api"], by: "agent:test" });
    expect(named.sealed).toEqual([
      "contract:api#proto/charges.proto",
      "element:api",
      "element:api#services/api/refunds.ts:approve",
    ]);
    expect(named.sum.seals["element:api"]?.by).toBe("agent:test");
    expect(sealSum(statuses, { keys: ["nope"] }).unknown).toEqual(["nope"]);
  });

  it("writes and reads archdoc.sum", () => {
    const { sum } = sealSum(sealStatuses(sealedAt(repo()), undefined), { all: true });
    const text = formatSum(sum);
    expect(text.startsWith("# Written by archdoc seal.")).toBe(true);
    expect(parseSum(text).sum).toEqual(sum);
    expect(parseSum("sealVersion: 2\nseals: {}").error).toMatch(/sealVersion/);
  });

  it("normalizes text before fingerprinting", () => {
    expect(normalizeForSeal("a  \r\n\n// note\n  # comment\nb\n")).toBe("a\nb");
    expect(normalizeForSeal("#!/usr/bin/env node\nx")).toBe("#!/usr/bin/env node\nx");
  });
});

describe("sealing named facts", () => {
  it("seals only the facts named, not new ones", () => {
    const facts = sealableFacts(m);
    const statuses = facts.map((fact) => ({
      fact,
      state: "unsealed" as const,
      current: { kind: fact.kind, hash: "h" },
      changes: [],
      problems: [],
    }));
    const { sealed, sum } = sealSum(statuses, { keys: ["logic:approval"] });
    expect(sealed).toEqual(["logic:approval"]);
    expect(Object.keys(sum.seals)).toEqual(["logic:approval"]);
  });
});
