import { describe, expect, it } from "vitest";
import { buildModel, insertIntoMap, type ProposalEdit, planProposal } from "../src/index.js";

/** Asserts `after` is `before` with text inserted in one place, and returns the insertion. */
function inserted(before: string, after: string): string {
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && before.at(-1 - end) === after.at(-1 - end)) end++;
  expect(after.slice(0, start) + after.slice(after.length - end)).toBe(before);
  return after.slice(start, after.length - end);
}

const yaml = `# A comment that must survive
elements:
  api:
    kind: container   # trailing comment
    description: >
      A long folded description that a full re-serialization would
      unfold onto one line.
    uses:
      db: Writes
  db: { kind: datastore, tags: [sql] }
`;

describe("insertIntoMap", () => {
  it("adds to a block map without touching anything else", () => {
    const after = insertIntoMap(yaml, ["elements", "api", "uses"], "cache", {
      description: "Reads",
    });
    expect(inserted(yaml, after)).toMatch(/cache:\n {8}description: Reads\n/);
    expect(after).toContain(
      "    uses:\n      db: Writes\n      cache:\n        description: Reads\n",
    );
  });

  it("creates a missing map under its parent", () => {
    const after = insertIntoMap(yaml, ["elements", "db", "uses"], "api", "Notifies");
    expect(after).toContain("db: { kind: datastore, tags: [sql], uses: { api: Notifies } }");
    inserted(yaml, after);
  });

  it("adds to a flow map in flow style", () => {
    const after = insertIntoMap(yaml, ["elements", "db"], "owners", ["team"]);
    expect(after).toContain("db: { kind: datastore, tags: [sql], owners: [ team ] }");
  });

  it("adds a top-level key to a document", () => {
    const after = insertIntoMap(yaml, ["elements"], "queue", { kind: "queue" });
    expect(after).toContain("  db: { kind: datastore, tags: [sql] }\n  queue:\n    kind: queue\n");
  });

  it("refuses to overwrite or to write into a scalar", () => {
    expect(() => insertIntoMap(yaml, ["elements", "api", "uses"], "db", "x")).toThrow(
      /already exists/,
    );
    expect(() => insertIntoMap(yaml, ["elements", "api", "kind"], "x", "y")).toThrow(/not a map/);
    expect(() => insertIntoMap("a: [", ["a"], "b", 1)).toThrow(/YAML errors/);
  });
});

const sources = [
  {
    path: "archdoc.yaml",
    text: 'archdoc: "2.0"\nnamespace: shop\nimports:\n  pay: { github: acme/pay, version: ^1 }\nactors:\n  buyer:\n    kind: person\n    uses:\n      web: Shops\n',
  },
  {
    path: "model.yaml",
    text: "# Elements\nelements:\n  web:\n    kind: container\n    uses:\n      api: Calls\n  api:\n    kind: container\n    elements:\n      routes: { kind: component }\n",
  },
];
const model = buildModel(sources, { root: "archdoc.yaml" });
const plan = (edits: ProposalEdit[]) =>
  planProposal(model, sources, "archdoc.yaml", edits, "agent:test");

describe("planProposal", () => {
  it("adds relationships and elements as suggestions, in the right files", () => {
    const p = plan([
      { op: "add-relationship", from: "web", to: "pay.charges", description: "Charges" },
      {
        op: "add-element",
        id: "search",
        parent: "api",
        kind: "component",
        code: ["src/search/**"],
      },
      { op: "add-relationship", from: "buyer", to: "api.search", description: "Searches" },
      { op: "add-element", id: "queue", kind: "queue", description: "Jobs" },
    ]);
    expect(p.errors).toEqual([]);
    expect(p.ok).toBe(true);
    expect(p.applied).toEqual([
      "Added relationship web → pay.charges.",
      "Added element api.search (component) inside api.",
      "Added relationship buyer → api.search.",
      "Added element queue (queue).",
    ]);
    expect(p.changes.map((c) => c.path).sort()).toEqual(["archdoc.yaml", "model.yaml"]);
    const after = p.after;
    expect(after?.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(after?.elements.get("api.search")?.spec.provenance).toEqual({
      source: "suggested",
      by: "agent:test",
    });
    expect(
      after?.relationships.find(
        (r) => r.from.id === "buyer" && r.to.type === "element" && r.to.id === "api.search",
      )?.provenance?.source,
    ).toBe("suggested");
    // Every original line survives, in order: insertions only.
    for (const c of p.changes) {
      const lines = c.after.split("\n");
      let i = 0;
      for (const line of c.before.split("\n")) i = lines.indexOf(line, i) + 1 || Number.NaN;
      expect(i).not.toBeNaN();
    }
  });

  it("refuses to change what's there, to edit other repos, or to add bad IDs", () => {
    const p = plan([
      { op: "add-relationship", from: "web", to: "api", description: "again" },
      { op: "add-relationship", from: "pay.charges", to: "web", description: "x" },
      { op: "add-element", id: "bad.id", kind: "component" },
      { op: "add-element", id: "routes", parent: "api", kind: "component" },
      { op: "add-relationship", from: "nobody", to: "api", description: "x" },
    ]);
    expect(p.ok).toBe(false);
    expect(p.changes).toEqual([]);
    expect(p.errors).toEqual([
      "Edit 1 (add-relationship): web already uses api. Existing relationships aren't changed.",
      "Edit 2 (add-relationship): pay.charges is in another repo; propose it there.",
      'Edit 3 (add-element): "bad.id" isn\'t a valid ID.',
      'Edit 4 (add-element): Element "api.routes" already exists.',
      'Edit 5 (add-relationship): "nobody" isn\'t an element or actor in this model.',
    ]);
  });

  it("refuses a result that wouldn't validate", () => {
    const p = plan([{ op: "add-element", id: "x", kind: "box" as never }]);
    expect(p.ok).toBe(false);
    expect(p.errors[0]).toMatch(
      /^The model wouldn't validate: model\.yaml:\d+:\d+ error schema\/invalid/,
    );
  });
});
