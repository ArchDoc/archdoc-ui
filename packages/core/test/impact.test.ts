import { describe, expect, it } from "vitest";
import { formatImpact, impact, impactToJSON } from "../src/index.js";
import { model, root } from "./helpers.js";

const m = model({
  "archdoc.yaml": root(`
    actors:
      passenger: { kind: person, uses: { app: Books } }
      support: { kind: team, uses: { console: Refunds } }
    elements:
      app: { kind: container, code: apps/mobile/**, uses: { gateway: Calls } }
      console: { kind: container, uses: { platform: Admin } }
      gateway: { kind: container, code: services/gateway/**, uses: { platform.trips: Trips, payments.charges: Pays } }
      platform:
        kind: system
        owners: [support]
        elements:
          trips: { kind: container, code: services/trips/**, uses: { db: Writes } }
          db: { kind: datastore }
    journeys:
      refund:
        actor: support
        goal: Refund a fare
        steps: [{ from: support, to: console }, { from: console, to: platform }]
      book:
        actor: passenger
        goal: Get a ride
        importance: critical
        steps:
          - { from: passenger, to: app }
          - { from: app, to: gateway }
          - { from: gateway, to: trips }
    rules:
      - id: trips-boundary
        description: Only the gateway calls trips.
        allow-only: { to: trips, from: [gateway] }
  `),
});

function ok(target: string) {
  const r = impact(m, target);
  if (!r.ok) throw new Error(r.reason);
  return r.impact;
}

describe("impact", () => {
  it("has a clean fixture", () => {
    expect(m.diagnostics).toEqual([]);
  });

  it("walks consumers: direct, through a parent, and transitive", () => {
    const i = ok("trips");
    const summary = i.consumers.map(
      (c) => `${c.relationship.from.id}:${c.depth}${c.viaParent ? "p" : ""}`,
    );
    expect(summary).toEqual(["console:1p", "gateway:1", "support:2", "app:2", "passenger:3"]);
    expect(i.dependencies.map((d) => (d.to.type === "external" ? d.to.ref : d.to.id))).toEqual([
      "platform.db",
    ]);
  });

  it("names affected actors and why", () => {
    expect(ok("trips").actors).toEqual([
      { id: "support", kind: "team", via: "uses console" },
      { id: "passenger", kind: "person", via: "uses app" },
    ]);
  });

  it("ranks affected journeys by importance and lists the steps", () => {
    const i = ok("trips");
    expect(i.journeys.map((j) => [j.journey.id, j.steps])).toEqual([
      ["book", [3]],
      ["refund", [2]],
    ]);
  });

  it("inherits owners and finds rules that mention the target", () => {
    const i = ok("trips");
    expect(i.owners).toEqual(["support"]);
    expect(i.rules.map((r) => r.id)).toEqual(["trips-boundary"]);
  });

  it("accepts a file path, even one that doesn't exist yet", () => {
    const i = ok("services/trips/src/new-handler.ts");
    expect(i.element?.id).toBe("platform.trips");
    expect(i.path).toBe("services/trips/src/new-handler.ts");
  });

  it("explains unmapped paths and unknown targets", () => {
    expect(impact(m, "docs/readme.md")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("No element maps"),
    });
    expect(impact(m, "nothing")).toMatchObject({ ok: false });
  });

  it("works for actors", () => {
    const i = ok("support");
    expect(i.target).toEqual({ type: "actor", id: "support" });
    expect(i.journeys.map((j) => j.journey.id)).toEqual(["refund"]);
    expect(i.dependencies.map((d) => (d.to.type === "external" ? "" : d.to.id))).toEqual([
      "console",
    ]);
  });

  it("formats a readable report and plain JSON", () => {
    const i = ok("gateway");
    const text = formatImpact(m, i);
    expect(text).toContain("Impact of gateway (container)");
    expect(text).toContain(
      "Journeys affected (1)\n  book (critical) · actor passenger · steps 2, 3",
    );
    expect(text).toContain("Depends on: platform.trips, payments.charges");
    const json = impactToJSON(i);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(json.journeys[0]).toMatchObject({ id: "book", importance: "critical", steps: [2, 3] });
  });
});
