import { readFileSync } from "node:fs";
import { buildModel, simulate } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { journeyInvolvement, journeyRows } from "../src/graph/data.js";
import {
  buildGraph,
  defaultExpanded,
  ROWS_BADGE,
  reorderRows,
  rowColumnWidths,
  rowTableSize,
} from "../src/graph/graph.js";
import { layoutGraph } from "../src/graph/layout.js";
import { countCrossings } from "../src/graph/route.js";

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
/** How much longer a route is than the shortest orthogonal path between its ends. */
const detour = (r: { x: number; y: number }[]) => {
  let length = 0;
  for (let i = 1; i < r.length; i++) {
    const [a, b] = [r[i - 1], r[i]] as [{ x: number; y: number }, { x: number; y: number }];
    length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  }
  const [first, last] = [r[0], r[r.length - 1]] as [
    { x: number; y: number },
    { x: number; y: number },
  ];
  return length - Math.abs(last.x - first.x) - Math.abs(last.y - first.y);
};
const ids = (rows: Map<string, { id?: string | undefined }[]>, entry: string) =>
  rows.get(`erp.${entry}`)?.map((r) => r.id);

describe("journey rows", () => {
  it("start with the sample's rows, and add what each step creates", () => {
    const start = journeyRows(model, journey, 0, sim);
    expect(ids(start, "Customer")).toEqual(["cust-1", "cust-2", "cust-3"]);
    expect(ids(start, "Order")).toEqual(["so-0950"]);
    expect(start.get("erp.Order")?.[0]?.origin).toBe("existing");

    // Placing the order writes nothing; saving it, the next step, does.
    expect(ids(journeyRows(model, journey, 1, sim), "Order")).toEqual(["so-0950"]);
    const placed = journeyRows(model, journey, 2, sim);
    expect(ids(placed, "Order")).toEqual(["so-0950", "so-1001"]);
    const order = placed.get("erp.Order")?.[1];
    expect(order).toMatchObject({ origin: "created", step: 2, isNew: true });
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
    // Every step that writes runs only for an outcome of the credit check.
    expect(journeyRows(model, journey, last).size).toBe(0);
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

  it("shows each table's name until it's opened, then every field", () => {
    const graph = buildGraph(model, { expanded: defaultExpanded(model), tables: db });
    const tables = graph.nodes.filter((n) => n.kind === "table");
    expect(tables).toHaveLength(24);
    expect(tables.every((t) => t.table?.open === false)).toBe(true);
    // Closed, every table is the same small box; the foreign keys still join them.
    expect(new Set(tables.map((t) => t.size?.height)).size).toBe(1);
    expect(graph.edges.filter((e) => e.reference).length).toBeGreaterThan(25);

    const opened = buildGraph(model, {
      expanded: defaultExpanded(model),
      tables: db,
      openFields: new Set(["erp.Order"]),
    });
    const order = opened.nodes.find((n) => n.table?.entry === "erp.Order");
    expect(order?.table?.open).toBe(true);
    expect(order?.table?.fields.map((f) => f.name)).toEqual([
      "id",
      "customer_id",
      "ship_to",
      "price_list_id",
      "sales_rep_id",
      "total_cents",
      "status",
    ]);
    expect(order?.size?.height).toBeGreaterThan(tables[0]?.size?.height ?? 0);
  });

  it("shows the journey's rows instead, a small table each, with a line from each row to the row it names", () => {
    const rows = journeyRows(model, journey, last, sim);
    const graph = buildGraph(model, {
      expanded: defaultExpanded(model),
      tables: db,
      rows: { stores: db, data: rows },
    });
    expect(graph.nodes.filter((n) => n.kind === "table")).toEqual([]);
    // No boxes in boxes: one node per table, its rows inside it.
    const tables = graph.nodes.filter((n) => n.kind === "rowtable");
    expect(tables.every((t) => t.parentId === "element:erp-db" && !t.isGroup)).toBe(true);
    // Only tables with rows: the sample's two messages aren't stored.
    expect(rows.size).toBe(24);
    expect(tables.length).toBe(22);
    const orders = tables.find((t) => t.table?.entry === "erp.Order");
    expect(orders?.rows?.map((r) => r.id)).toEqual(["so-0950", "so-1001"]);
    expect(orders?.columns).toEqual([
      "id",
      "customer_id",
      "ship_to",
      "price_list_id",
      "sales_rep_id",
      "status",
    ]);
    // A port on each side of each line, for the lines between rows.
    expect(orders?.ports).toHaveLength(4);

    const label = (id: string, i: number) => {
      const r = graph.nodes.find((n) => n.id === id)?.rows?.[i];
      return `${r?.entry.slice(4)}:${r?.id}`;
    };
    const links = graph.edges
      .filter((e) => e.rows)
      .map(
        (e) =>
          `${label(e.source, e.rows?.from ?? -1)}.${e.reference?.field} -> ${label(e.target, e.rows?.to ?? -1)}`,
      );
    expect(links).toEqual(
      expect.arrayContaining([
        "Allocation:al-1.payment_id -> Payment:pay-1001",
        "Allocation:al-1.invoice_id -> Invoice:inv-so-1001",
        "ShipmentLine:sl-2.order_line_id -> OrderLine:ol-2",
        "OrderLine:ol-2.sku -> Variant:GAD-BLU",
        "Variant:GAD-BLU.product_id -> Product:prod-gadget",
        "Order:so-0950.customer_id -> Customer:cust-2",
      ]),
    );
    // A category's parent is in the same table: its value shows it, without a line.
    expect(links.some((l) => l.startsWith("Category:"))).toBe(false);
    expect(links.length).toBeGreaterThan(40);
  });

  it("lays out both, every node placed and every line routed", async () => {
    const rows = journeyRows(model, journey, last, sim);
    for (const view of [
      { expanded: defaultExpanded(model), tables: db },
      { expanded: defaultExpanded(model), tables: db, rows: { stores: db, data: rows } },
    ]) {
      // The graph as laid out: untangling may have put a table's rows in a new order.
      const { boxes, routes, graph } = await layoutGraph(buildGraph(model, view));
      expect(boxes.size).toBe(graph.nodes.length);
      for (const e of graph.edges) expect(routes.get(e.id), e.id).toBeDefined();
      // A line between rows starts and ends at the height of its rows.
      const top = (id: string): number => {
        const n = graph.nodes.find((x) => x.id === id);
        return (boxes.get(id)?.y ?? 0) + (n?.parentId ? top(n.parentId) : 0);
      };
      for (const e of graph.edges.filter((x) => x.rows)) {
        const route = routes.get(e.id) ?? [];
        const from = graph.nodes
          .find((n) => n.id === e.source)
          ?.ports?.find((p) => p.id === e.sourcePort);
        const to = graph.nodes
          .find((n) => n.id === e.target)
          ?.ports?.find((p) => p.id === e.targetPort);
        expect(route[0]?.y, e.id).toBeCloseTo(top(e.source) + (from?.y ?? 0), 0);
        expect(route[route.length - 1]?.y, e.id).toBeCloseTo(top(e.target) + (to?.y ?? 0), 0);
      }
    }
  });
});

describe("a big database during a journey", () => {
  const db = new Set(["erp-db"]);
  const base = { expanded: defaultExpanded(model), tables: db };
  const rows = journeyRows(model, journey, last, sim);

  it("folds the tables the journey doesn't use into one box", () => {
    const involved = journeyInvolvement(model, journey);
    expect([...involved.entries].sort()).toEqual([
      "erp.Allocation",
      "erp.BankTransaction",
      "erp.Customer",
      "erp.Invoice",
      "erp.InvoiceLine",
      "erp.Order",
      "erp.OrderLine",
      "erp.OrderRequest",
      "erp.Payment",
      "erp.PickList",
      "erp.Shipment",
      "erp.ShipmentLine",
      "erp.Stock",
    ]);
    const graph = buildGraph(model, { ...base, involved });
    // Ten of the 24 are stored tables it writes or reads; the order request and
    // bank transaction are messages.
    expect(graph.nodes.filter((n) => n.kind === "table")).toHaveLength(10);
    const others = graph.nodes.find((n) => n.kind === "others");
    expect(others?.folded?.map((f) => f.table)).toEqual([
      "currencies",
      "tax_rates",
      "territories",
      "sales_reps",
      "addresses",
      "contacts",
      "categories",
      "products",
      "variants",
      "price_lists",
      "price_items",
      "warehouses",
      "returns",
      "credit_notes",
    ]);
    // Brought back one at a time, or all at once.
    const one = buildGraph(model, { ...base, involved, extra: new Set(["erp.Variant"]) });
    expect(one.nodes.filter((n) => n.kind === "table")).toHaveLength(11);
    const all = buildGraph(model, { ...base, involved, showAll: db });
    expect(all.nodes.filter((n) => n.kind === "table")).toHaveLength(24);
    expect(all.nodes.some((n) => n.kind === "others")).toBe(false);
  });

  it("shows the rows it wrote and read, and the rows those point at, hiding the rest", () => {
    const involved = journeyInvolvement(model, journey, rows);
    const graph = buildGraph(model, {
      ...base,
      rows: { stores: db, data: rows },
      involved,
    });
    const table = (entry: string) => graph.nodes.find((n) => n.table?.entry === `erp.${entry}`);
    // The new order, and the past one credit control reads.
    expect(table("Order")?.rows?.map((r) => r.id)).toEqual(["so-0950", "so-1001"]);
    // The orders' customers, not the third.
    expect(table("Customer")?.rows?.map((r) => r.id)).toEqual(["cust-1", "cust-2"]);
    expect(table("Customer")?.hiddenRows).toBe(1);
    expect(table("Stock")?.rows?.map((r) => r.id)).toEqual(["st-1"]);
    expect(table("Stock")?.hiddenRows).toBe(2);
    // The lines' variants, one hop out; their products are two, so folded.
    expect(table("Variant")?.rows?.map((r) => r.id)).toEqual(["WID-RED", "GAD-BLU"]);
    expect(table("Product")).toBeUndefined();
    expect(graph.nodes.find((n) => n.kind === "others")?.folded?.map((f) => f.table)).toEqual([
      "contacts",
      "categories",
      "products",
      "price_items",
    ]);
    // A table brought back shows all its rows.
    const shown = buildGraph(model, {
      ...base,
      rows: { stores: db, data: rows },
      involved,
      extra: new Set(["erp.Customer"]),
    });
    const customers = shown.nodes.find((n) => n.table?.entry === "erp.Customer");
    expect(customers?.rows).toHaveLength(3);
    expect(customers?.hiddenRows ?? 0).toBe(0);
  });

  it("reorders a table's rows with the lines that link them", () => {
    const graph = buildGraph(model, {
      ...base,
      rows: { stores: db, data: rows },
      involved: journeyInvolvement(model, journey, rows),
    });
    const lines = graph.nodes.find((n) => n.table?.entry === "erp.OrderLine");
    if (!lines?.rows) throw new Error("no order lines");
    const reordered = reorderRows(graph, new Map([[lines.id, [1, 0]]]));
    const after = reordered.nodes.find((n) => n.id === lines.id);
    expect(after?.rows?.map((r) => r.id)).toEqual(["ol-2", "ol-1"]);
    // Each edge still joins the same two rows, from its new place.
    const rowOf = (g: typeof graph, node: string, i: number) =>
      g.nodes.find((n) => n.id === node)?.rows?.[i]?.id;
    const ends = (g: typeof graph) =>
      g.edges
        .filter((e) => e.rows && (e.source === lines.id || e.target === lines.id))
        .map((e) => [
          rowOf(g, e.source, e.rows?.from ?? -1),
          rowOf(g, e.target, e.rows?.to ?? -1),
          e.sourcePort?.endsWith(`#${e.rows?.from}:out`),
          e.targetPort?.endsWith(`#${e.rows?.to}:in`),
        ]);
    expect(ends(reordered)).toEqual(ends(graph));
    expect(ends(graph).length).toBeGreaterThan(0);
  });

  it("untangles: no crossings in the folded schema, and far fewer between rows", async () => {
    const erd = await layoutGraph(
      buildGraph(model, { ...base, involved: journeyInvolvement(model, journey) }),
    );
    expect(countCrossings(erd.routes.values())).toBe(0);

    const tangled = await layoutGraph(
      buildGraph(model, { ...base, rows: { stores: db, data: rows } }),
      {},
      0,
    );
    const graph = buildGraph(model, {
      ...base,
      rows: { stores: db, data: rows },
      involved: journeyInvolvement(model, journey, rows),
    });
    const once = await layoutGraph(graph, {}, 0);
    const untangled = await layoutGraph(graph);
    const [before, folded, after] = [tangled, once, untangled].map((l) =>
      countCrossings(l.routes.values()),
    );
    expect(before).toBeGreaterThan(100);
    expect(after).toBeLessThanOrEqual(folded as number);
    expect(after).toBeLessThanOrEqual(12);
    // No line between rows loops far out of its way, even with every table shown.
    const all = await layoutGraph(
      buildGraph(model, { ...base, rows: { stores: db, data: rows }, showAll: db }),
    );
    for (const l of [untangled, all]) {
      const detours = [...l.routes]
        .filter(([id]) => id.startsWith("rowref:"))
        .map(([, r]) => detour(r));
      expect(Math.max(...detours)).toBeLessThan(300);
    }
  });
});

describe("a table of rows' size", () => {
  const row = (record: Record<string, unknown>) =>
    ({ entry: "erp.Shipment", record, changed: new Set<string>(), origin: "existing" }) as never;
  it("fits each column's header and longest value, and the title", () => {
    const widths = rowColumnWidths(
      ["id", "warehouse_id", "notes"],
      [row({ id: "sh-1", warehouse_id: "wh-north", notes: "x".repeat(80) })],
      new Set(["warehouse_id"]),
    );
    const [id, warehouse, notes] = widths as [number, number, number];
    // A short column stays narrow; one that points at a row fits its header and arrow.
    expect(id).toBeLessThan(warehouse);
    expect(warehouse).toBeGreaterThanOrEqual("warehouse_id".length * 6.4 + 12);
    // A long value is cut off at a limit, rather than widening the table without end.
    expect(notes).toBe(170);
    const size = rowTableSize(widths, 1);
    expect(size.width).toBeGreaterThanOrEqual(ROWS_BADGE + id + warehouse + notes);
    // A narrow table is still wide enough for its title.
    const titled = rowTableSize([44], 2, false, {
      label: "Warehouse",
      table: "warehouses",
      rows: 2,
    });
    expect(titled.width).toBeGreaterThan(rowTableSize([44], 2).width);
  });
});
