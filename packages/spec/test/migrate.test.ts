import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { isV1Model, ModelFileSchema, migrateV1 } from "../src/index.js";

const example = (name: string) =>
  parse(readFileSync(new URL(`../../../examples/v1/${name}.yaml`, import.meta.url), "utf8"));

describe("isV1Model", () => {
  it("detects v1 documents and leaves v2 alone", () => {
    expect(isV1Model(example("blog"))).toBe(true);
    expect(isV1Model({ archdoc: "0.1.0", services: {} })).toBe(true);
    expect(isV1Model({ archdoc: "2.0", elements: {} })).toBe(false);
    expect(isV1Model(null)).toBe(false);
  });
});

describe("migrateV1", () => {
  it("turns users into person actors and components into elements", () => {
    const { model } = migrateV1(example("blog"), { namespace: "blog" });
    expect(model.archdoc).toBe("2.0");
    expect(model.namespace).toBe("blog");
    expect(model.actors?.editor).toMatchObject({
      kind: "person",
      uses: { ui: "Posts blog articles" },
    });
    expect(model.elements?.ui).toMatchObject({
      kind: "container",
      links: [{ url: "https://github.com/example/myblogui", title: "Repository" }],
      uses: { db: "Queries and saves database records" },
    });
  });

  it("guesses datastores from tags", () => {
    const { model } = migrateV1(example("blog"), { namespace: "blog" });
    expect(model.elements?.db?.kind).toBe("datastore");
  });

  it("migrates pre-0.2.0 services like components", () => {
    const { model, notes } = migrateV1(
      { archdoc: "0.1.0", users: { u: { dependencies: { s: "Uses" } } }, services: { s: {} } },
      { namespace: "old" },
    );
    expect(model.elements?.s?.kind).toBe("container");
    expect(notes.join(" ")).toContain("services");
  });

  it("handles users with no dependencies (a v0 crash case)", () => {
    const { model } = migrateV1(
      { archdoc: "0.1.0", users: { lurker: { description: "Reads only" } }, components: {} },
      { namespace: "x" },
    );
    expect(model.actors?.lurker).toEqual({ kind: "person", description: "Reads only" });
  });

  it.each(["blog", "mealplanner", "ridesharing"])("produces a valid v2 file for %s", (name) => {
    const { model } = migrateV1(example(name), { namespace: name });
    expect(ModelFileSchema.safeParse(model).success).toBe(true);
  });
});
