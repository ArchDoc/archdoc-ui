import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  archdocJsonSchema,
  JourneyFileSchema,
  ModelFileSchema,
  SPEC_VERSION,
} from "../src/index.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ModelFileSchema", () => {
  it("declares spec version 2.0", () => {
    expect(SPEC_VERSION).toBe("2.0");
  });

  it("accepts the dogfood example from the relaunch plan", () => {
    const doc = parse(read("../../../docs/revival/archdoc.v2.example.yaml"));
    expect(ModelFileSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts nested elements, code shorthands, and every uses form", () => {
    const result = ModelFileSchema.safeParse({
      archdoc: "2.0",
      namespace: "rides",
      elements: {
        app: {
          kind: "system",
          elements: {
            api: {
              kind: "container",
              code: "services/api/**",
              uses: {
                db: "Reads trips",
                "payments.charges": { description: "Charges riders", technology: "gRPC" },
                cache: null,
              },
            },
            db: { kind: "datastore", code: [{ path: "db/**" }, "migrations/**"] },
            cache: { kind: "datastore" },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields, bad kinds, and dotted IDs, with paths", () => {
    const result = ModelFileSchema.safeParse({
      archdoc: "2.0",
      elements: {
        "a.b": { kind: "container" },
        c: { kind: "box", elements: { d: { kind: "component", colour: "red" } } },
      },
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join("/"));
    expect(paths).toEqual(["elements/a.b", "elements/c/kind", "elements/c/elements/d"]);
  });

  it("rejects v1 version strings with a pointer to migrate", () => {
    const result = ModelFileSchema.safeParse({ archdoc: "0.1.0" });
    expect(result.error?.issues[0]?.message).toContain("archdoc migrate");
  });

  it("requires actors to have a kind from the fixed list", () => {
    expect(ModelFileSchema.safeParse({ actors: { bob: { kind: "robot" } } }).success).toBe(false);
    for (const kind of ["person", "role", "team", "organization", "agent"]) {
      expect(ModelFileSchema.safeParse({ actors: { bob: { kind } } }).success).toBe(true);
    }
  });
});

describe("JourneyFileSchema", () => {
  it("accepts a single-journey file and requires at least one step", () => {
    const base = { journey: "book", actor: "passenger", goal: "Get a ride" };
    expect(
      JourneyFileSchema.safeParse({ ...base, steps: [{ from: "passenger", to: "app" }] }).success,
    ).toBe(true);
    expect(JourneyFileSchema.safeParse({ ...base, steps: [] }).success).toBe(false);
  });
});

describe("archdocJsonSchema", () => {
  it("matches the committed schema file (run `pnpm -F @archdoc/spec gen:schema` after a build)", () => {
    const committed = JSON.parse(read("../schema/archdoc.v2.schema.json"));
    expect(committed).toEqual(archdocJsonSchema());
  });

  it("describes both file forms", () => {
    const schema = archdocJsonSchema();
    expect(schema.$id).toMatch(/archdoc\.v2\.schema\.json$/);
    expect(schema.anyOf).toHaveLength(2);
  });
});
