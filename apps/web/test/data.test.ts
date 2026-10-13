import { buildModel, type Model, simulate } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import {
  dataFocus,
  hasData,
  lineageGraph,
  sampleSkeleton,
  sensitivity,
} from "../src/graph/data.js";
import { defaultExpanded } from "../src/graph/graph.js";

const text = `
archdoc: "2.0"
namespace: payments
actors:
  clerk: { kind: role, uses: { app: Refunds } }
elements:
  app: { kind: container, uses: { charges: { description: Asks, sends: RefundRequest } } }
  core:
    kind: system
    elements:
      charges: { kind: container, uses: { ledger: Posts } }
      ledger:
        kind: datastore
        stores: { refunds: { entity: Refund } }
data:
  RefundRequest:
    kind: message
    fields:
      amount_cents: { type: int }
      email: { type: string, classification: pii }
      note: { type: string, classification: internal }
  Charge: { kind: entity, fields: { amount_cents: { type: int }, status: { type: enum, values: [captured, refunded] } } }
  Refund: { kind: entity, fields: { amount_cents: { type: int } } }
logic:
  approval:
    input: { request: RefundRequest, charge: Charge }
    rules:
      - when: "request.amount_cents <= charge.amount_cents / 2"
        then: auto
      - else: manual
mappings:
  to-refund:
    from: { request: RefundRequest }
    to: core.ledger.refunds
    fields: { amount_cents: request.amount_cents }
journeys:
  refund:
    actor: clerk
    goal: Refund
    steps:
      - { from: clerk, to: app }
      - { from: app, to: core.charges, sends: RefundRequest, decides: approval, branches: { auto: { changes: { Charge.status: captured -> refunded } } } }
      - { from: core.charges, to: core.ledger, via: to-refund, when: auto }
  plain:
    actor: clerk
    goal: Nothing about data
    steps:
      - { from: clerk, to: app }
`;

const model = (): Model => {
  const m = buildModel([{ path: "archdoc.yaml", text }]);
  const problems = m.diagnostics.filter((d) => d.severity !== "info");
  if (problems.length) throw new Error(JSON.stringify(problems));
  return m;
};

describe("explorer data helpers", () => {
  const m = model();

  it("name an entry's sensitive classifications, not the routine ones", () => {
    expect(sensitivity(m.data.get("RefundRequest") as never)).toEqual(["pii"]);
    expect(sensitivity(m.data.get("Refund") as never)).toEqual([]);
  });

  it("light up where an entry is stored and the boxes it travels between, lifted to what's visible", () => {
    const open = dataFocus(m, { expanded: defaultExpanded(m) }, "payments.Refund");
    expect([...open.stores]).toEqual(["element:core.ledger"]);
    const closed = dataFocus(m, { expanded: new Set() }, "payments.RefundRequest");
    expect([...closed.nodes].sort()).toEqual(["element:app", "element:core"]);
    expect(closed.edges.has("element:app->element:core")).toBe(true);
  });

  it("draw a field's lineage as entries holding fields, joined by expressions", () => {
    const l = lineageGraph(m, "RefundRequest.amount_cents");
    expect(l?.graph.nodes.map((n) => `${n.id}${n.parentId ? ` in ${n.parentId}` : ""}`)).toEqual([
      "entry:payments.RefundRequest",
      "field:payments.RefundRequest.amount_cents in entry:payments.RefundRequest",
      "entry:payments.Refund",
      "field:payments.Refund.amount_cents in entry:payments.Refund",
    ]);
    expect(l?.nodes.get("entry:payments.Refund")?.detail).toBe("core.ledger (refunds)");
    expect([...(l?.edges.values() ?? [])]).toEqual([
      { expression: "request.amount_cents", mapping: "payments.to-refund", copy: true },
    ]);
  });

  it("start a sample with every record the journey reads, ready to run", () => {
    const journey = m.journeys.get("refund");
    if (!journey) throw new Error("no journey");
    expect(hasData(journey)).toBe(true);
    expect(hasData(m.journeys.get("plain") as never)).toBe(false);
    const sample = sampleSkeleton(m, journey);
    expect(sample).toEqual({
      RefundRequest: { amount_cents: 0, email: "", note: "" },
      Charge: { amount_cents: 0, status: "captured" },
    });
    // The skeleton runs: 0 <= 0 / 2 approves automatically.
    expect(simulate(m, "refund", sample)?.outcomes).toEqual(["auto"]);
  });
});
