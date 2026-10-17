import { buildModel, type Model } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { compareModels } from "../src/model/compare.js";

const load = (text: string): Model => buildModel([{ path: "archdoc.yaml", text }]);

const base = load(`
archdoc: "2.0"
namespace: shop
actors:
  buyer: { kind: person, uses: { web: Shops } }
elements:
  web: { kind: container, uses: { api: Calls } }
  api: { kind: container, uses: { fraud: Scores } }
  fraud: { kind: container }
journeys:
  checkout:
    actor: buyer
    goal: Buy something
    importance: critical
    steps: [{ from: buyer, to: web }, { from: web, to: api }, { from: api, to: fraud }]
data:
  Order: { kind: message, fields: { total_cents: { type: int } } }
rules:
  - id: web-never-scores
    deny: { from: web, to: fraud }
`);

const head = load(`
archdoc: "2.0"
namespace: shop
actors:
  buyer: { kind: person, uses: { web: Shops } }
elements:
  web: { kind: container, uses: { api: Calls, fraud: Scores early } }
  api: { kind: container, uses: { fraud: Scores } }
  fraud: { kind: container }
  receipts:
    kind: container
    provenance: { source: suggested, by: "agent:claude" }
journeys:
  checkout:
    actor: buyer
    goal: Buy something
    importance: critical
    steps: [{ from: buyer, to: web }, { from: web, to: api }, { from: api, to: fraud }]
data:
  Order: { kind: message, fields: { total_cents: { type: int }, email: { type: string } } }
rules:
  - id: web-never-scores
    deny: { from: web, to: fraud }
`);

describe("compareModels", () => {
  const c = compareModels("main", base, "feature", head);

  it("groups what changed by what to look at first", () => {
    expect(c.groups.breaks.map((i) => i.hint)).toEqual(["rule web-never-scores", "orphan-element"]);
    expect(c.groups.breaks[0]).toMatchObject({ kind: "error", key: "element:web" });
    expect(c.groups.elements.map((i) => `${i.kind} ${i.label}`)).toEqual(
      expect.arrayContaining(["added receipts", "added web → fraud"]),
    );
    expect(c.groups.data).toEqual([
      expect.objectContaining({ key: "data:shop.Order", kind: "changed", label: "Order" }),
    ]);
    expect(c.groups.suggested).toEqual([
      expect.objectContaining({ key: "element:receipts", detail: "by agent:claude" }),
    ]);
    expect(c.journeys.has("checkout")).toBe(true);
    expect(c.count).toBe(
      c.groups.breaks.length + c.groups.journeys.length + c.groups.elements.length + 1,
    );
  });

  it("shows nothing for a model compared with itself", () => {
    const same = compareModels("main", base, undefined, base);
    expect(same.count).toBe(0);
    expect(same.groups.suggested).toEqual([]);
  });
});
