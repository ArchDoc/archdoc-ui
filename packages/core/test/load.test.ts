import { describe, expect, it } from "vitest";
import { codes, model, root } from "./helpers.js";

describe("buildModel", () => {
  it("merges actors, elements, and journeys from several files", () => {
    const m = model({
      "archdoc.yaml": root(),
      "actors.yaml": `
        actors:
          passenger: { kind: person, uses: { app: Books rides } }
      `,
      "model/platform.yaml": `
        elements:
          platform:
            kind: system
            elements:
              app: { kind: container, uses: { api: Calls } }
              api: { kind: container }
      `,
      "journeys/book.yaml": `
        journey: book
        actor: passenger
        goal: Get a ride
        steps:
          - { from: passenger, to: app }
          - { from: app, to: api }
      `,
    });
    expect(m.diagnostics).toEqual([]);
    expect(m.namespace).toBe("rides");
    expect([...m.elements.keys()]).toEqual(["platform", "platform.app", "platform.api"]);
    expect(m.elements.get("platform.api")).toMatchObject({
      key: "api",
      parentId: "platform",
      depth: 1,
    });
    expect(m.elements.get("platform")?.childIds).toEqual(["platform.app", "platform.api"]);
    expect(
      m.relationships.map((r) => `${r.from.id}->${r.to.type === "external" ? r.to.ref : r.to.id}`),
    ).toEqual(["passenger->platform.app", "platform.app->platform.api"]);
    expect(m.journeys.get("book")?.steps).toHaveLength(2);
  });

  it("reports schema errors with file, line, and column", () => {
    const m = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: rides
        elements:
          api:
            kind: container
            colour: red
      `,
    });
    expect(m.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "schema/unknown-field",
      location: { file: "archdoc.yaml", line: 6, column: 5 },
      path: "elements.api.colour",
    });
    expect(codes(m)).toContain("model/incomplete");
  });

  it("explains invalid IDs and missing fields", () => {
    const m = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: rides
        elements:
          bad.id: { kind: container }
          nokind: { description: x }
      `,
    });
    const messages = m.diagnostics.map((d) => d.message);
    expect(messages[0]).toMatch(/^Invalid ID "bad.id": .*dots/);
    expect(messages).toContain('Missing required field "kind".');
  });

  it("reports YAML syntax errors", () => {
    const m = model({ "archdoc.yaml": 'archdoc: "2.0"\nelements: {a: [\n' });
    expect(new Set(codes(m, "error"))).toEqual(new Set(["yaml/syntax"]));
    expect(m.diagnostics[0]?.location?.file).toBe("archdoc.yaml");
  });

  it("points v1 files at archdoc migrate", () => {
    const m = model({ "archdoc.yaml": "archdoc: 0.1.0\nusers: {}\ncomponents: {}\n" });
    expect(codes(m, "error")).toEqual(["spec/v1-model"]);
  });

  it("requires archdoc and namespace in the root file only", () => {
    const m = model({
      "archdoc.yaml": "elements: {}\n",
      "more.yaml": "namespace: other\nelements: {}\n",
    });
    expect(codes(m, "error")).toEqual([
      "model/missing-root-field",
      "model/missing-root-field",
      "model/root-only-field",
    ]);
  });

  it("rejects duplicate definitions across files", () => {
    const m = model({
      "archdoc.yaml": root(`\nelements: { api: { kind: container } }\n`),
      "other.yaml": "elements: { api: { kind: container } }\n",
    });
    const dup = m.diagnostics.find((d) => d.code === "model/duplicate");
    expect(dup?.message).toContain("first defined at archdoc.yaml:6");
    expect(dup?.location?.file).toBe("other.yaml");
  });

  it("normalizes code mappings", () => {
    const m = model({
      "archdoc.yaml": root(`
        elements:
          a: { kind: container, code: src/a/** }
          b: { kind: container, code: [src/b/**, { path: lib/b, description: Helpers }] }
      `),
    });
    expect(m.elements.get("a")?.code).toEqual([{ path: "src/a/**" }]);
    expect(m.elements.get("b")?.code).toEqual([
      { path: "src/b/**" },
      { path: "lib/b", description: "Helpers" },
    ]);
  });
});
