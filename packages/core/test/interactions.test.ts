import { describe, expect, it } from "vitest";
import { buildModel, stepStores } from "../src/index.js";

// A shop whose journey writes the order from three places: the api it's sent
// to, the api again on a call to the card processor, and a step to the database.
export const shop = buildModel([
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

describe("a step that writes where it doesn't go", () => {
  const steps = shop.journeys.get("buy")?.steps ?? [];

  it("names the datastore, and who stores it there", () => {
    // The api it's sent to stores it.
    expect(stepStores(shop, steps[1] as never)).toEqual([
      {
        store: "db",
        writer: { type: "element", id: "api" },
        external: false,
        entries: ["shop.Order"],
      },
    ]);
    // The card processor can't reach the database: the api that called it records the result.
    expect(stepStores(shop, steps[2] as never)).toMatchObject([
      { store: "db", writer: { type: "element", id: "api" } },
    ]);
    // A step to the datastore is the storing itself.
    expect(stepStores(shop, steps[3] as never)).toEqual([]);
  });

  it("is a warning: storing it is a step of its own", () => {
    expect(
      shop.diagnostics
        .filter((d) => d.code === "journey/step-writes-elsewhere")
        .map((d) => d.message),
    ).toEqual([
      'Journey "buy", step 2 (app → api) also writes Order into db. Make storing it a step of its own, from api to db, and move what it creates and changes there.',
      'Journey "buy", step 3 (api → psp) also writes Order into db. Make storing it a step of its own, from api to db, and move what it creates and changes there.',
    ]);
  });
});
