import { buildModel, type Model, simulate } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import {
  dataFocus,
  dataPlaces,
  exampleValue,
  hasData,
  journeyStores,
  lineageFocus,
  sampleSkeleton,
  sensitivity,
  stepData,
} from "../src/graph/data.js";
import { buildGraph, defaultExpanded } from "../src/graph/graph.js";

const text = `
archdoc: "2.0"
namespace: payments
actors:
  clerk: { kind: role, uses: { app: { description: Refunds, sends: RefundRequest } } }
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
    expect([...closed.nodes].sort()).toEqual(["actor:clerk", "element:app", "element:core"]);
    expect(closed.edges.has("element:app->element:core")).toBe(true);
  });

  it("light up a field's lineage on the canvas: the entries on the way, and their fields", () => {
    const l = lineageFocus(m, { expanded: defaultExpanded(m) }, "RefundRequest.amount_cents");
    expect(l?.entries).toEqual(["payments.RefundRequest", "payments.Refund"]);
    expect([...(l?.fields ?? [])]).toEqual([
      "payments.RefundRequest.amount_cents",
      "payments.Refund.amount_cents",
    ]);
    expect([...(l?.stores ?? [])]).toEqual(["element:core.ledger"]);
    expect(l?.edges.has("element:app->element:core.charges")).toBe(true);
  });

  it("find where to open the canvas for an entry: its stores, and the boxes it travels between", () => {
    expect(dataPlaces(m, "payments.Refund")).toEqual({ stores: ["core.ledger"], ends: [] });
    expect(dataPlaces(m, "payments.RefundRequest")).toEqual({
      stores: [],
      ends: ["app", "core.charges"],
    });
    // A message an API accepts lights up the API, even when nothing in this repo sends it.
    const api = buildModel([
      {
        path: "archdoc.yaml",
        text: `
archdoc: "2.0"
namespace: payments
elements:
  charges: { kind: container, provides: [{ api: charges.proto, accepts: Ask }] }
data:
  Ask: { kind: message, fields: { amount: { type: int } } }
`,
      },
    ]);
    expect(dataPlaces(api, "payments.Ask")).toEqual({ stores: [], ends: ["charges"] });
    expect([...dataFocus(api, { expanded: new Set() }, "payments.Ask").nodes]).toEqual([
      "element:charges",
    ]);
  });

  it("open a datastore into its tables, with a line for each foreign key between them", () => {
    const erd = buildModel([
      {
        path: "archdoc.yaml",
        text: `
archdoc: "2.0"
namespace: payments
elements:
  db:
    kind: datastore
    stores: { charges: { entity: Charge, key: id }, refunds: { entity: Refund, key: id } }
data:
  Charge: { kind: entity, fields: { id: { type: uuid }, card_last4: { type: string, classification: pci } } }
  Refund: { kind: entity, fields: { id: { type: uuid }, charge_id: { type: uuid, references: Charge }, charge: { type: Charge } } }
`,
      },
    ]);
    const closed = buildGraph(erd, { expanded: new Set() });
    expect(closed.nodes.map((n) => n.id)).toEqual(["element:db"]);
    const open = buildGraph(erd, { expanded: new Set(), tables: new Set(["db"]) });
    expect(open.nodes.map((n) => `${n.id}${n.parentId ? ` in ${n.parentId}` : ""}`)).toEqual([
      "element:db",
      "table:db:charges in element:db",
      "table:db:refunds in element:db",
    ]);
    expect(open.nodes[0]?.isGroup).toBe(true);
    expect(open.nodes[1]?.table).toEqual({
      element: "db",
      table: "charges",
      entry: "payments.Charge",
      key: "id",
      fields: [
        { name: "id", type: "uuid", classification: undefined },
        { name: "card_last4", type: "string", classification: "pci" },
      ],
      // Closed until it's opened: its name, and how many fields it has.
      open: false,
    });
    expect(open.edges.map((e) => `${e.source}.${e.reference?.field} -> ${e.target}`)).toEqual([
      "table:db:refunds.charge_id -> table:db:charges",
      "table:db:refunds.charge -> table:db:charges",
    ]);
  });

  it("say what each step carries, and what it writes, declared or simulated", () => {
    const journey = m.journeys.get("refund");
    if (!journey) throw new Error("no journey");
    const declared = stepData(m, journey, 1);
    expect(declared.message?.how).toBe("step");
    expect(declared.message?.entries.map((e) => [e.label, e.fields.map((f) => f.name)])).toEqual([
      ["RefundRequest", ["amount_cents", "email", "note"]],
    ]);
    // A branch's writes are declared with the outcome they need.
    expect(declared.writes).toEqual([
      {
        entry: "payments.Charge",
        created: false,
        values: new Map([["status", "captured → refunded"]]),
        when: "auto",
      },
    ]);
    // Writing through a mapping creates what it maps to; its values come from a simulation.
    expect(stepData(m, journey, 2).writes).toEqual([
      { entry: "payments.Refund", created: true, values: new Map() },
    ]);

    const sample = {
      RefundRequest: { amount_cents: 300, email: "a@b.c", note: "" },
      Charge: { amount_cents: 1000, status: "captured" },
    };
    const sim = simulate(m, "refund", sample);
    const run = stepData(m, journey, 1, sim);
    expect(run.message?.entries[0]?.fields[0]).toMatchObject({
      name: "amount_cents",
      value: "300",
    });
    expect(run.writes).toEqual([
      {
        entry: "payments.Charge",
        created: false,
        values: new Map([["status", "captured → refunded"]]),
      },
    ]);
    expect(journeyStores(m, journey)).toEqual(["core.ledger"]);

    // A step that maps into a record and changes it too updates the record.
    const both = buildModel([
      {
        path: "archdoc.yaml",
        text: text.replace(
          "{ from: core.charges, to: core.ledger, via: to-refund, when: auto }",
          "{ from: core.charges, to: core.ledger, via: to-refund, when: auto, changes: { Refund.amount_cents: 0 -> 1 } }",
        ),
      },
    ]);
    const j = both.journeys.get("refund");
    if (!j) throw new Error("no journey");
    expect(stepData(both, j, 2).writes).toEqual([
      {
        entry: "payments.Refund",
        created: false,
        values: new Map([["amount_cents", "0 → 1"]]),
      },
    ]);
  });

  it("start a sample with every record the journey reads, ready to run", () => {
    const journey = m.journeys.get("refund");
    if (!journey) throw new Error("no journey");
    expect(hasData(journey)).toBe(true);
    expect(hasData(m.journeys.get("plain") as never)).toBe(false);
    const sample = sampleSkeleton(m, journey);
    // Example values a reader would expect, by each field's name and type.
    expect(sample).toEqual({
      RefundRequest: { amount_cents: 1200, email: "ana@example.com", note: "An example" },
      Charge: { amount_cents: 1200, status: "captured" },
    });
    // The skeleton runs: 1200 is more than half of 1200, so it goes to a person.
    expect(simulate(m, "refund", sample)?.outcomes).toEqual(["manual"]);
  });

  it("give keys and the fields that name them the same example, so records link up", () => {
    expect(exampleValue("erp.Customer", "id", "string", undefined)).toBe("customer-1");
    expect(exampleValue("erp.Order", "customer_id", "string", undefined)).toBe("customer-1");
    expect(exampleValue("erp.SalesRep", "id", "string", undefined)).toBe("sales-rep-1");
    expect(exampleValue("erp.Order", "sales_rep_id", "string", undefined)).toBe("sales-rep-1");
    expect(exampleValue("x.Meter", "kwh", "number", undefined)).toBe(12.5);
    expect(exampleValue("x.Line", "quantity", "int", undefined)).toBe(2);
    expect(exampleValue("x.Order", "status", "enum", ["placed", "paid"])).toBe("placed");
  });
});
