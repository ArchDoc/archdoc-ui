import { describe, expect, it } from "vitest";
import { codes, model, root } from "./helpers.js";

const base = root(`
  actors:
    passenger: { kind: person, uses: { app: Books } }
    support: { kind: team }
  elements:
    app: { kind: container, uses: { platform: Calls, payments.charges: Pays } }
    platform:
      kind: system
      elements:
        api: { kind: container, uses: { db: Writes } }
        db: { kind: datastore }
`);

const journey = (steps: string) => ({
  "archdoc.yaml": base,
  "journeys/j.yaml": `
    journey: j
    actor: passenger
    goal: Test
    steps:
${steps}
  `,
});

describe("journey validation", () => {
  it("accepts steps that follow declared relationships", () => {
    const m = model(
      journey(`
      - { from: passenger, to: app }
      - { from: app, to: platform }
      - { from: app, to: payments.charges }
      - { from: app, to: passenger }
      `),
    );
    expect(m.diagnostics).toEqual([]);
    expect(m.journeys.get("j")?.steps[2]?.to).toMatchObject({ type: "external" });
  });

  it("accepts a coarse step backed by a finer relationship", () => {
    const m = model(journey("      - { from: platform, to: db }"));
    expect(m.diagnostics).toEqual([]);
  });

  it("rejects a step without a relationship, with its location", () => {
    const m = model(
      journey(`
      - { from: passenger, to: app }
      - { from: db, to: app }
      `),
    );
    expect(m.diagnostics).toMatchObject([
      {
        code: "journey/broken-step",
        message: expect.stringContaining("step 2: platform.db → app"),
        location: { file: "journeys/j.yaml", line: 7 },
      },
    ]);
  });

  it("rejects actor-to-actor steps and unknown endpoints", () => {
    const m = model(
      journey(`
      - { from: passenger, to: support }
      - { from: app, to: nowhere }
      `),
    );
    expect(codes(m)).toEqual(["journey/broken-step", "journey/unknown-endpoint"]);
  });

  it("rejects an unknown journey actor", () => {
    const m = model({
      "archdoc.yaml": base,
      "j.yaml": "journey: j\nactor: ghost\ngoal: x\nsteps: [{ from: passenger, to: app }]\n",
    });
    expect(codes(m)).toEqual(["journey/unknown-actor"]);
  });

  it("reports steps that start in another repo as unverified", () => {
    const m = model(journey("      - { from: payments.charges, to: app }"));
    expect(m.diagnostics).toMatchObject([{ severity: "info", code: "journey/unverified-step" }]);
  });
});
