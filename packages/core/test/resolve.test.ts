import { describe, expect, it } from "vitest";
import { Resolver } from "../src/index.js";
import { codes, model, root } from "./helpers.js";

const resolver = new Resolver(
  "rides",
  new Set(["payments"]),
  new Set(["web", "platform", "platform.api", "platform.db", "platform.api.db", "ops.db"]),
  new Set(["passenger"]),
);

describe("Resolver", () => {
  it("prefers siblings, then enclosing scopes", () => {
    expect(resolver.element("db", "platform.api")).toMatchObject({
      target: { id: "platform.api.db" },
    });
    expect(resolver.element("db", "platform")).toMatchObject({ target: { id: "platform.db" } });
    expect(resolver.element("web", "platform.api")).toMatchObject({ target: { id: "web" } });
  });

  it("falls back to a unique suffix match", () => {
    expect(resolver.element("api")).toMatchObject({ target: { id: "platform.api" } });
    expect(resolver.element("api.db")).toMatchObject({ target: { id: "platform.api.db" } });
    expect(resolver.element("db")).toMatchObject({ status: "ambiguous" });
  });

  it("treats the own namespace prefix as absolute", () => {
    expect(resolver.element("rides.platform.db", "platform.api")).toMatchObject({
      target: { id: "platform.db" },
    });
    expect(resolver.element("rides.api")).toMatchObject({ status: "unresolved" });
  });

  it("recognizes imported namespaces as external", () => {
    expect(resolver.element("payments.charges")).toEqual({
      status: "external",
      target: { type: "external", namespace: "payments", ref: "payments.charges" },
    });
    expect(resolver.element("billing.invoices")).toMatchObject({
      status: "unresolved",
      hint: expect.stringContaining("imports"),
    });
  });

  it("resolves journey endpoints to actors or elements", () => {
    expect(resolver.endpoint("passenger")).toMatchObject({ target: { type: "actor" } });
    expect(resolver.endpoint("web")).toMatchObject({ target: { type: "element" } });
  });
});

describe("reference diagnostics", () => {
  it("flags unresolved, ambiguous, and actor targets in uses", () => {
    const m = model({
      "archdoc.yaml": root(`
        actors:
          passenger: { kind: person }
        elements:
          a: { kind: container, elements: { db: { kind: datastore } } }
          b: { kind: container, elements: { db: { kind: datastore } } }
          web:
            kind: container
            uses:
              ghost: x
              db: y
              passenger: z
              payments.charges: ok
      `),
    });
    expect(codes(m, "error")).toEqual(["ref/unresolved", "ref/ambiguous", "ref/uses-actor"]);
    expect(m.relationships).toHaveLength(1);
    expect(m.relationships[0]?.to).toMatchObject({ type: "external", ref: "payments.charges" });
  });

  it("warns about owners that aren't actors", () => {
    const m = model({
      "archdoc.yaml": root(`
        actors: { core-team: { kind: team } }
        elements:
          a: { kind: container, owners: [core-team, payments.payments-team, nobody] }
      `),
    });
    expect(m.diagnostics).toMatchObject([
      { severity: "warning", code: "ref/unresolved-owner", path: "elements.a.owners.2" },
    ]);
  });

  it("warns when a relationship sends undefined data", () => {
    const m = model({
      "archdoc.yaml": root(`
        data: { Trip: { kind: entity } }
        elements:
          a: { kind: container, uses: { b: { sends: [Trip, Ghost, payments.Refund] } } }
          b: { kind: container }
      `),
    });
    expect(m.diagnostics.map((d) => d.message)).toEqual([
      'a → b sends "Ghost", which is not defined under data.',
    ]);
  });
});
