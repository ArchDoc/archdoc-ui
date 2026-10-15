import { readFileSync } from "node:fs";
import { buildModel, simulate } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import {
  interactionRows,
  journeyInteractions,
  journeyRows,
  sampleSkeleton,
  stepData,
} from "../src/graph/data.js";
import { journeyEdges } from "../src/graph/graph.js";

// The shop from core's tests: its journey's step 2 and step 3 also write the order into db.
const shop = buildModel([
  {
    path: "archdoc.yaml",
    text: `
archdoc: "2.0"
namespace: shop
actors:
  buyer: { kind: person, uses: { app: { description: Buys, sends: OrderRequest } } }
elements:
  app: { kind: container, uses: { api: { description: Places orders, sends: OrderRequest } } }
  api:
    kind: container
    uses:
      db: { description: Saves orders, sends: Order }
      psp: { description: Charges cards, sends: OrderRequest }
  psp: { kind: external }
  db: { kind: datastore, stores: { orders: { entity: Order, key: id } } }
data:
  OrderRequest: { kind: message, fields: { ref: { type: string } } }
  Order:
    kind: entity
    fields: { id: { type: string }, status: { type: enum, values: [new, paid] } }
journeys:
  buy:
    actor: buyer
    goal: Buy
    steps:
      - { from: buyer, to: app }
      - { from: app, to: api, action: Places it, creates: { Order: { id: o-1, status: new } } }
      - { from: api, to: psp, action: Charges the card, changes: { Order.status: new -> paid } }
      - { from: api, to: db, action: Saves the receipt, changes: { Order.status: paid -> paid } }
`,
  },
]);
const journey = shop.journeys.get("buy");
if (!journey) throw new Error("no journey");

describe("a journey's interactions", () => {
  const interactions = journeyInteractions(shop, journey);

  it("follow each step with its writer storing what it wrote elsewhere", () => {
    expect(
      interactions.map(
        (x) =>
          `${x.label} ${x.from.type === "external" ? x.from.ref : x.from.id} → ${x.to.type === "external" ? x.to.ref : x.to.id}: ${x.action ?? ""} [${x.writes.join(", ")}]`,
      ),
    ).toEqual([
      "1 buyer → app:  []",
      "2 app → api: Places it []",
      "2.1 api → db: Stores Order [shop.Order]",
      "3 api → psp: Charges the card []",
      "3.1 api → db: Stores Order [shop.Order]",
      "4 api → db: Saves the receipt [shop.Order]",
    ]);
    // Each is an arrow of its own on the canvas.
    expect(
      journeyEdges(shop, { expanded: new Set() }, journey.id, interactions).map(
        (e) => `${e.label} ${e.source}->${e.target}`,
      ),
    ).toEqual([
      "1 actor:buyer->element:app",
      "2 element:app->element:api",
      "2.1 element:api->element:db",
      "3 element:api->element:psp",
      "3.1 element:api->element:db",
      "4 element:api->element:db",
    ]);
  });

  it("write rows when the writer stores them, not when the step's message is sent", () => {
    const at = (label: string) => interactions.findIndex((x) => x.label === label);
    expect(interactionRows(shop, journey, interactions, at("2"), undefined).size).toBe(0);
    const stored = interactionRows(shop, journey, interactions, at("2.1"), undefined);
    expect(stored.get("shop.Order")).toEqual([
      expect.objectContaining({ id: "o-1", isNew: true, changed: new Set(["id", "status"]) }),
    ]);
    // Sending the charge leaves the order as it was, with nothing new.
    const charging = interactionRows(shop, journey, interactions, at("3"), undefined);
    expect(charging.get("shop.Order")).toEqual([
      expect.objectContaining({ id: "o-1", isNew: false, changed: new Set() }),
    ]);
    expect(
      interactionRows(shop, journey, interactions, at("3.1"), undefined).get("shop.Order")?.[0]
        ?.changed,
    ).toEqual(new Set(["status"]));
  });
});

describe("rows without a sample", () => {
  const dir = new URL("../../../examples/industries/", import.meta.url);
  const grid = buildModel([
    { path: "energy.yaml", text: readFileSync(new URL("energy.yaml", dir), "utf8") },
  ]);
  const j = grid.journeys.get("reading-to-outage");
  if (!j) throw new Error("no journey");

  it("show example data, never a mapping's expressions", () => {
    // Declared, a mapping's record is there without values.
    const stored = j.steps.findIndex((s) => s.spec.via === "raw-to-reading");
    expect(stepData(grid, j, stored).writes).toEqual([
      expect.objectContaining({ entry: "grid.MeterReading", values: new Map() }),
    ]);
    // Run on example data, the record has values a reader expects.
    const sim = simulate(grid, j.id, sampleSkeleton(grid, j));
    const reading = journeyRows(grid, j, stored, sim).get("grid.MeterReading")?.[0];
    expect(reading?.record).toMatchObject({ meter_id: "meter-1", quality: "actual" });
    const values = Object.values(reading?.record ?? {}).map(String);
    expect(values.some((v) => v.startsWith("="))).toBe(false);
  });
});
