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
    });
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

  it("marks a collapsed box that hides changes, and lifts edges onto it", () => {
    const d = buildDiffGraph(head, base, diff, { expanded: new Set() });
    expect([...d.containsChanges]).toEqual(["element:api"]);
    expect(d.ghosts.has("element:api.old")).toBe(false);
    // web → api still exists (web uses api), so it isn't marked.
    expect(d.edges.has("element:web->element:api")).toBe(false);
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
