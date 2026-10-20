import { buildModel } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { journeyInteractions } from "../src/graph/data.js";
import {
  journeyCards,
  journeyFacts,
  journeyLanes,
  journeyPath,
  ownership,
} from "../src/model/stories.js";
import { hashOf, readHash } from "../src/model/useCompare.js";

const model = buildModel([
  {
    path: "archdoc.yaml",
    text: `
archdoc: "2.0"
namespace: shop
name: Shop
actors:
  buyer: { kind: person, name: Buyer, uses: { web: Shops } }
  shop-team: { kind: team }
elements:
  web: { kind: container, name: Storefront, owners: [shop-team], uses: { api: { description: Calls, sends: Request } } }
  api: { kind: container, owners: [shop-team], uses: { db: { description: Saves, sends: Refund }, mail: Emails, psp: Pays } }
  db: { kind: datastore, stores: { refunds: { entity: Refund } } }
  mail: { kind: external }
  psp: { kind: external }
data:
  Request: { kind: message, fields: { amount: { type: int }, email: { type: string, classification: pii } } }
  Refund: { kind: entity, fields: { id: { type: string }, amount: { type: int } } }
logic:
  approval:
    runs-in: api
    input: { request: Request }
    rules:
      - { when: "request.amount <= 100", then: approve }
      - { else: review }
journeys:
  browse:
    actor: buyer
    goal: Look around
    steps:
      - { from: buyer, to: web, sends: Request }
  refund:
    actor: buyer
    goal: Get money back
    importance: critical
    steps:
      - { from: buyer, to: web, action: Asks, sends: Request }
      - { from: web, to: api, action: Forwards, sends: Request, decides: approval }
      - { from: api, to: db, action: Saves it, sends: Refund, when: approve }
      - { from: api, to: mail, action: Tells finance, sends: Request, when: review }
      - { from: api, to: psp, action: Pays out, sends: Request, when: approve }
`,
  },
]);
const refund = model.journeys.get("refund");
if (!refund) throw new Error("no journey");

describe("journey cards", () => {
  it("lists journeys most important first, with their path and facts", () => {
    const cards = journeyCards(model);
    expect(cards.map((c) => c.id)).toEqual(["refund", "browse"]);
    expect(cards[0]).toMatchObject({ title: "Get money back", steps: 5, decisions: 1, repos: 1 });
    expect(journeyFacts(cards[0] as (typeof cards)[number])).toBe("5 steps · 1 decision");
    expect(journeyFacts({ steps: 10, repos: 3, decisions: 0 })).toBe("10 steps · 3 repos");
  });

  it("names a long path by its first three and its last", () => {
    expect(journeyPath(model, refund)).toEqual(["Buyer", "Storefront", "api", "…", "psp"]);
    expect(journeyPath(model, refund, 10)).toEqual([
      "Buyer",
      "Storefront",
      "api",
      "db",
      "mail",
      "psp",
    ]);
  });

  it("counts what each owner owns", () => {
    expect(ownership(model)).toEqual([{ id: "shop-team", name: "shop-team", elements: 2 }]);
  });
});

describe("journeyLanes", () => {
  const lanes = journeyLanes(model, refund, journeyInteractions(model, refund));

  it("has a lane per participant, in the order they take part", () => {
    expect(lanes.lanes.map((l) => l.label)).toEqual([
      "Buyer",
      "Storefront",
      "api",
      "db",
      "mail",
      "psp",
    ]);
    expect(lanes.lanes[0]).toMatchObject({ actor: true, sub: "person" });
    expect(lanes.lanes[1]?.sub).toBe("Shop");
  });

  it("marks the decision, then groups steps by outcome in the order of its rules", () => {
    const kinds = lanes.rows.map((r) => r.kind);
    expect(kinds).toEqual(["step", "step", "decision", "branches"]);
    const block = lanes.rows[3];
    if (block?.kind !== "branches") throw new Error("expected branches");
    expect(block.decidedAt).toBe(1);
    expect(
      block.branches.map((b) => [b.outcome, b.condition, b.rows.map((r) => r.label), b.ends]),
    ).toEqual([
      ["approve", "request.amount <= 100", ["3", "5"], true],
      ["review", "otherwise", ["4"], true],
    ]);
  });

  it("puts the data a step sends on its arrow, with what's sensitive", () => {
    const first = lanes.rows[0];
    if (first?.kind !== "step") throw new Error("expected a step");
    expect(first.data).toEqual([{ entry: "shop.Request", label: "Request", marks: ["pii"] }]);
    expect([first.from, first.to]).toEqual([0, 1]);
  });
});

describe("the address", () => {
  it("opens a tab, a journey, an entry, or a comparison", () => {
    expect(readHash("#journeys=refund")).toEqual({ tab: "journeys", journey: "refund" });
    expect(readHash("#data=shop.Refund")).toEqual({ tab: "data", data: "data:shop.Refund" });
    expect(readHash("#data=shop.Refund.amount")).toEqual({
      tab: "data",
      data: "field:shop.Refund.amount",
    });
    expect(readHash("#changes=main...feature")).toEqual({
      tab: "changes",
      pair: { base: "main", head: "feature" },
    });
    expect(readHash("")).toEqual({});
  });

  it("writes what's open", () => {
    expect(hashOf({ tab: "overview" })).toBe("");
    expect(hashOf({ tab: "journeys", journey: "refund" })).toBe("#journeys=refund");
    expect(hashOf({ tab: "data", data: "field:shop.Refund.amount" })).toBe(
      "#data=shop.Refund.amount",
    );
    expect(hashOf({ tab: "changes", pair: { base: "main" } })).toBe("#changes=main");
  });
});
