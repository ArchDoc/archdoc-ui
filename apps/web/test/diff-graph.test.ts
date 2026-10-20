import { buildModel, diffModels, type Model } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { buildDiffGraph } from "../src/graph/diff.js";

const load = (text: string): Model => {
  const m = buildModel([{ path: "archdoc.yaml", text }]);
  if (m.diagnostics.length) throw new Error(JSON.stringify(m.diagnostics));
  return m;
};

const base = load(`
archdoc: "2.0"
namespace: shop
actors:
  buyer: { kind: person, uses: { web: Shops } }
  clerk: { kind: role, uses: { admin: Manages } }
elements:
  web: { kind: container, uses: { api: Calls, legacy: Reads } }
  admin: { kind: container }
  legacy: { kind: container }
  api:
    kind: system
    elements:
      routes: { kind: component, uses: { store: Writes } }
      store: { kind: datastore }
      old: { kind: component }
`);

const head = load(`
archdoc: "2.0"
namespace: shop
actors:
  buyer: { kind: person, uses: { web: Shops a lot } }
  admin-team: { kind: team }
elements:
  web: { kind: container, uses: { api: Calls, search: { description: Finds, provenance: { source: suggested, by: agent:t } } } }
  admin: { kind: container }
  search: { kind: container }
  api:
    kind: system
    elements:
      routes: { kind: component, description: Now documented, uses: { store: Writes, cache: Reads } }
      store: { kind: datastore }
      cache: { kind: datastore }
`);

const diff = diffModels(base, head);

describe("buildDiffGraph", () => {
  it("marks added and changed nodes, and ghosts what was removed", () => {
    const d = buildDiffGraph(head, base, diff, { expanded: new Set(["api"]) });
    expect(Object.fromEntries(d.nodes)).toEqual({
      "element:search": "added",
      "element:api.routes": "changed",
      "element:api.cache": "added",
      "actor:admin-team": "added",
      "element:legacy": "removed",
      "element:api.old": "removed",
      "actor:clerk": "removed",
      // What changed inside api changed api: a component added, changed, and removed, and an arrow.
      "element:api": "changed",
    });
    expect(d.inside.get("element:api")).toBe(4);
    expect([...d.ghosts].sort()).toEqual(["actor:clerk", "element:api.old", "element:legacy"]);
    expect(d.graph.nodes.find((n) => n.id === "element:api.old")?.parentId).toBe("element:api");
  });

  it("marks edges added, changed, and removed", () => {
    const d = buildDiffGraph(head, base, diff, { expanded: new Set(["api"]) });
    expect(Object.fromEntries(d.edges)).toEqual({
      "actor:buyer->element:web": "changed",
      "element:web->element:search": "added",
      "element:api.routes->element:api.cache": "added",
      "element:web->element:legacy": "removed",
      "actor:clerk->element:admin": "removed",
    });
  });

  it("marks a box with changes inside it changed, open or not, and lifts edges onto it", () => {
    const d = buildDiffGraph(head, base, diff, { expanded: new Set() });
    expect(d.nodes.get("element:api")).toBe("changed");
    expect(d.inside.get("element:api")).toBeGreaterThan(0);
    const open = buildDiffGraph(head, base, diff, { expanded: new Set(["api"]) });
    expect(open.nodes.get("element:api")).toBe("changed");
    expect(d.ghosts.has("element:api.old")).toBe(false);
    // web → api still exists (web uses api), so it isn't marked.
    expect(d.edges.has("element:web->element:api")).toBe(false);
  });

  it("finds a subscription's arrow, drawn from the publisher to the subscriber", () => {
    const subBase = load(`
archdoc: "2.0"
namespace: x
elements:
  charges: { kind: container, provides: [{ event: RefundIssued }] }
`);
    const subHead = load(`
archdoc: "2.0"
namespace: x
elements:
  charges: { kind: container, provides: [{ event: RefundIssued }] }
  receipts: { kind: container, uses: { charges: { description: Hears about refunds, via: RefundIssued } } }
`);
    const d = buildDiffGraph(subHead, subBase, diffModels(subBase, subHead), {
      expanded: new Set(),
    });
    expect(d.graph.edges.map((e) => e.id)).toEqual(["element:charges->element:receipts"]);
    expect(Object.fromEntries(d.edges)).toEqual({ "element:charges->element:receipts": "added" });
  });

  it("calls a lifted edge changed when only some of its relationships are new", () => {
    const mixedBase = load(`
archdoc: "2.0"
namespace: x
elements:
  a: { kind: container, uses: { b.one: Uses } }
  b: { kind: system, elements: { one: { kind: component }, two: { kind: component } } }
`);
    const mixedHead = load(`
archdoc: "2.0"
namespace: x
elements:
  a: { kind: container, uses: { b.one: Uses, b.two: Uses too } }
  b: { kind: system, elements: { one: { kind: component }, two: { kind: component } } }
`);
    const d = buildDiffGraph(mixedHead, mixedBase, diffModels(mixedBase, mixedHead), {
      expanded: new Set(),
    });
    expect(d.edges.get("element:a->element:b")).toBe("changed");
  });
});
