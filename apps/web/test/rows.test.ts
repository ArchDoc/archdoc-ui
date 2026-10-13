import { readFileSync } from "node:fs";
import { buildModel, simulate } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { journeyRows } from "../src/graph/data.js";
import { buildGraph, COMPACT_OVER, defaultExpanded } from "../src/graph/graph.js";
import { layoutGraph } from "../src/graph/layout.js";

// The ERP example: one database with 24 tables, and an order-to-cash journey
// whose sample seeds several rows per table.
const dir = new URL("../../../examples/industries/", import.meta.url);
const model = buildModel([
  { path: "erp.yaml", text: readFileSync(new URL("erp.yaml", dir), "utf8") },
]);
const sample = JSON.parse(readFileSync(new URL("samples/order-to-cash.json", dir), "utf8"));
const journey = model.journeys.get("order-to-cash");
if (!journey) throw new Error("no journey");
const sim = simulate(model, "order-to-cash", sample);
const last = journey.steps.length - 1;
const ids = (rows: Map<string, { id?: string | undefined }[]>, entry: string) =>
  rows.get(`erp.${entry}`)?.map((r) => r.id);

describe("journey rows", () => {
  it("start with the sample's rows, and add what each step creates", () => {
    const start = journeyRows(model, journey, 0, sim);
    expect(ids(start, "Customer")).toEqual(["cust-1", "cust-2", "cust-3"]);
    expect(ids(start, "Order")).toEqual(["so-0950"]);
    expect(start.get("erp.Order")?.[0]?.origin).toBe("existing");

    const placed = journeyRows(model, journey, 1, sim);
    expect(ids(placed, "Order")).toEqual(["so-0950", "so-1001"]);
    const order = placed.get("erp.Order")?.[1];
    expect(order).toMatchObject({ origin: "created", step: 1, isNew: true });
    expect(order?.record.status).toBe("confirmed");
    expect(ids(placed, "OrderLine")).toEqual(["ol-0950-1", "ol-1"]);

    const end = journeyRows(model, journey, last, sim);
    expect(ids(end, "OrderLine")).toEqual(["ol-0950-1", "ol-1", "ol-2"]);
    expect(ids(end, "Allocation")).toEqual(["al-1"]);
    // A change updates the row it's about, and says which fields changed.
    const paid = end.get("erp.Order")?.find((r) => r.id === "so-1001");
    expect(paid).toMatchObject({ isNew: false, step: last });
    expect(paid?.record.status).toBe("paid");
    expect([...(paid?.changed ?? [])]).toEqual(["status"]);
    expect(end.get("erp.Order")?.[0]?.record.status).toBe("invoiced");
  });

  it("without a simulation, show what the steps that always run declare", () => {
    // The order the mapping declares; every step after the credit check runs only when it confirms.
    const declared = journeyRows(model, journey, last);
    expect([...declared.keys()]).toEqual(["erp.Order"]);
    expect(declared.get("erp.Order")?.[0]?.record).toMatchObject({ id: "= 'so-' + request.ref" });
    const rides = buildModel([
      {
        path: "a.yaml",
        text: `
archdoc: "2.0"
namespace: shop
actors: { buyer: { kind: person, uses: { api: { description: Buys, sends: Order } } } }
elements:
  api: { kind: container, uses: { db: { description: Saves, sends: Order } } }
  db: { kind: datastore, stores: { orders: { entity: Order, key: id } } }
data:
  Order: { kind: entity, fields: { id: { type: string }, status: { type: enum, values: [new, paid] } } }
journeys:
  buy:
    actor: buyer
    goal: Buy
    steps:
      - { from: buyer, to: api }
      - { from: api, to: db, creates: { Order: { id: o-1, status: new } } }
      - { from: api, to: db, changes: { Order.status: new -> paid } }
`,
      },
    ]);
    const j = rides.journeys.get("buy");
    if (!j) throw new Error("no journey");
    const rows = journeyRows(rides, j, 2);
    expect(rows.get("shop.Order")).toEqual([
      expect.objectContaining({
        id: "o-1",
        record: { id: "o-1", status: "new → paid" },
        declared: true,
        changed: new Set(["status"]),
      }),
    ]);
  });
});

describe("the ERP database on the canvas", () => {
  const db = new Set(["erp-db"]);

  it("shows compact tables: keys, foreign keys, and sensitive fields, with the rest counted", () => {
    expect(24).toBeGreaterThan(COMPACT_OVER);
    const graph = buildGraph(model, { expanded: defaultExpanded(model), tables: db });
    const tables = graph.nodes.filter((n) => n.kind === "table");
    expect(tables).toHaveLength(24);
    const order = tables.find((n) => n.table?.entry === "erp.Order")?.table;
    expect(order?.fields.map((f) => f.name)).toEqual([
      "id",
      "customer_id",
      "ship_to",
      "price_list_id",
      "sales_rep_id",
    ]);
    expect(order?.hidden).toBe(2);
    expect(graph.edges.filter((e) => e.reference).length).toBeGreaterThan(25);
  });

  it("shows the journey's rows instead, grouped by table, with a line from each row to the row it names", () => {
    const rows = journeyRows(model, journey, last, sim);
    const graph = buildGraph(model, {
      expanded: defaultExpanded(model),
      tables: db,
      rows: { stores: db, data: rows },
    });
    expect(graph.nodes.filter((n) => n.kind === "table")).toEqual([]);
    const groups = graph.nodes.filter((n) => n.kind === "rowgroup");
    // Only tables with rows: the sample's two messages aren't stored.
    expect(rows.size).toBe(24);
    expect(groups.length).toBe(22);
    const label = (id: string) => {
      const r = graph.nodes.find((n) => n.id === id)?.row;
      return `${r?.entry.slice(4)}:${r?.id}`;
    };
    const links = graph.edges
      .filter((e) => e.id.startsWith("rowref:"))
      .map((e) => `${label(e.source)}.${e.reference?.field} -> ${label(e.target)}`);
    expect(links).toEqual(
      expect.arrayContaining([
        "Allocation:al-1.payment_id -> Payment:pay-1001",
        "Allocation:al-1.invoice_id -> Invoice:inv-so-1001",
        "ShipmentLine:sl-2.order_line_id -> OrderLine:ol-2",
        "OrderLine:ol-2.sku -> Variant:GAD-BLU",
        "Variant:GAD-BLU.product_id -> Product:prod-gadget",
        "Category:cat-gadgets.parent_id -> Category:cat-home",
        "Order:so-0950.customer_id -> Customer:cust-2",
      ]),
    );
    expect(links.length).toBeGreaterThan(40);
  });

  it("lays out both, every node placed and every line routed", async () => {
    const rows = journeyRows(model, journey, last, sim);
    for (const view of [
      { expanded: defaultExpanded(model), tables: db },
      { expanded: defaultExpanded(model), tables: db, rows: { stores: db, data: rows } },
    ]) {
      const graph = buildGraph(model, view);
      const { boxes, routes } = await layoutGraph(graph);
      expect(boxes.size).toBe(graph.nodes.length);
      for (const e of graph.edges) expect(routes.get(e.id), e.id).toBeDefined();
    }
  });
});
