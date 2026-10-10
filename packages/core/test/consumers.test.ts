import { describe, expect, it } from "vitest";
import {
  buildModel,
  consumersElsewhere,
  createBundle,
  diffModels,
  federate,
  formatDiff,
  formatElement,
  formatImpact,
  impact,
  integrityOf,
  type Model,
  prReport,
  serializeBundle,
} from "../src/index.js";
import { dedent } from "./helpers.js";

// payments, as other repos see it through the landscape "acme".
const paymentsYaml = (contract: string) =>
  dedent(`
    archdoc: "2.0"
    namespace: payments
    landscape: { github: acme/architecture, version: ^1 }
    elements:
      charges:
        kind: container
        provides: [{ api: ${contract} }, { topic: refund.issued }]
        uses: { ledger: Records }
        elements:
          refunds: { kind: component }
      ledger: { kind: datastore }
      reports: { kind: container, uses: { ledger: Reads } }
  `);

const bundle = (path: string, text: string, version: string) => {
  const b = createBundle([{ path, text: dedent(text) }], path, { version }).bundle;
  if (!b) throw new Error(`${path} doesn't build`);
  return b;
};

const rides = bundle(
  "archdoc.yaml",
  `
    archdoc: "2.0"
    namespace: rides
    imports: { payments: { github: acme/payments, version: ^5 } }
    actors:
      rider: { kind: person, uses: { gateway: Asks } }
    elements:
      gateway:
        kind: container
        uses:
          payments.charges: { description: Refunds, via: proto/charges.proto }
          payments.ledger: Reads balances
    journeys:
      refund:
        actor: rider
        goal: Get money back
        importance: critical
        steps:
          - { from: rider, to: gateway }
          - { from: gateway, to: payments.charges }
  `,
  "1.2.0",
);
const trips = bundle(
  "archdoc.yaml",
  `
    archdoc: "2.0"
    namespace: trips
    imports: { payments: { github: acme/payments, version: ^5 } }
    elements:
      api: { kind: container, uses: { payments.charges.refunds: { description: Listens, via: refund.issued } } }
  `,
  "3.0.0",
);
const landscape = (() => {
  const b = createBundle(
    [
      {
        path: "archdoc.yaml",
        text: dedent(`
          archdoc: "2.0"
          namespace: acme
          imports:
            payments: { github: acme/payments, version: ^5 }
            rides: { github: acme/rides, version: ^1 }
          actors:
            agent: { kind: role, uses: { rides.gateway: Refunds } }
          journeys:
            goodwill:
              actor: agent
              goal: Make it right
              steps:
                - { from: agent, to: rides.gateway }
                - { from: rides.gateway, to: payments.charges }
        `),
      },
    ],
    "archdoc.yaml",
    { version: "1.0.0", includes: [rides, trips] },
  ).bundle;
  return serializeBundle(b as NonNullable<typeof b>);
})();

const payments = (contract = "proto/charges.proto"): Model =>
  federate(buildModel([{ path: "archdoc.yaml", text: paymentsYaml(contract) }]), {
    lockPath: "archdoc.lock",
    lock: {
      lockfileVersion: 1,
      imports: {},
      landscape: {
        namespace: "acme",
        source: "github:acme/architecture",
        requested: "^1",
        version: "1.0.0",
        bundle: "vendor/acme@1.0.0.landscape.json",
        integrity: integrityOf(landscape),
      },
    },
    bundles: new Map([
      ["(landscape)", { path: "x", text: landscape, integrity: integrityOf(landscape) }],
    ]),
  });

describe("consumersElsewhere", () => {
  it("finds relationships and journey steps in other repos, by how they reach the change", () => {
    const m = payments();
    expect(m.diagnostics).toEqual([]);
    expect([...(m.landscape?.members.keys() ?? [])]).toEqual(["rides", "trips"]);
    const r = consumersElsewhere(m, new Set(["charges", "charges.refunds"]), new Set(["reports"]));
    expect(r.consumers.map((c) => [c.from, c.target, c.reach])).toEqual([
      ["rides.gateway", "charges", "direct"],
      ["trips.api", "charges.refunds", "direct"],
    ]);
    expect(r.journeys.map((j) => [`${j.namespace}.${j.journey.id}`, j.steps])).toEqual([
      ["rides.refund", [2]],
      ["acme.goodwill", [2]],
    ]);
    // A part reaches its parent's consumers; a consumer of something that uses it is indirect.
    const parts = consumersElsewhere(m, new Set(["charges.refunds"]));
    expect(parts.consumers.map((c) => [c.from, c.reach])).toEqual([
      ["trips.api", "direct"],
      ["rides.gateway", "parent"],
    ]);
    const ledger = consumersElsewhere(m, new Set(["ledger"]), new Set(["charges"]));
    expect(ledger.consumers.map((c) => [c.from, c.target, c.reach])).toEqual([
      ["rides.gateway", "ledger", "direct"],
      ["rides.gateway", "charges", "indirect"],
    ]);
  });

  it("feeds impact and show", () => {
    const m = payments();
    const r = impact(m, "charges");
    if (!r.ok) throw new Error(r.reason);
    const text = formatImpact(m, r.impact);
    expect(text).toContain("Used from other repos (2)");
    expect(text).toContain(
      "rides.gateway (rides@1.2.0) uses payments.charges via proto/charges.proto: Refunds",
    );
    expect(text).toContain(
      "Journeys in other repos (2)\n  rides.refund (critical) · actor rider · steps 2",
    );
    expect(formatElement(m, "charges")).toContain(
      "Used from other repos: rides.gateway, trips.api",
    );
    expect(formatElement(m, "charges")).toContain(
      "Provides: proto/charges.proto (api), refund.issued (topic)",
    );
    expect(formatElement(m, "rides.gateway")).toMatch(
      /^rides\.gateway \(container\) · in rides@1\.2\.0, another repo\nUses: payments\.charges, payments\.ledger/,
    );
  });
});

describe("prReport across repos", () => {
  const before = payments();
  const after = payments("proto/charges.v2.proto");
  const r = prReport({
    model: after,
    changedFiles: [],
    diff: diffModels(before, after),
    findings: [],
  });

  it("marks the consumers a removed contract breaks", () => {
    expect(r.elsewhere.map((e) => [e.from, e.effect, e.why])).toEqual([
      ["rides.gateway", "breaks", "proto/charges.proto is removed"],
      ["trips.api", "affected", undefined],
    ]);
    expect(r.markdown).toContain(
      "> [!WARNING]\n> This change breaks 1 consumer in another repo (rides).",
    );
    expect(r.markdown).toContain(
      "| `rides.gateway` (rides@1.2.0) | `charges` via `proto/charges.proto`: Refunds | **breaks**: proto/charges.proto is removed |",
    );
    expect(r.markdown).toContain(
      "<sub>From the landscape acme@1.0.0, as synced in archdoc.lock.</sub>",
    );
  });

  it("lists journeys and actors in other repos, with diagrams", () => {
    expect(r.journeys.map((j) => [j.namespace, j.id, j.steps])).toEqual([
      ["rides", "refund", [2]],
      ["acme", "goodwill", [2]],
    ]);
    expect(r.actors).toEqual([
      { id: "rides.rider", kind: "person" },
      { id: "acme.agent", kind: "role" },
    ]);
    expect(r.markdown).toContain(
      "| rides.refund (another repo): Get money back | **critical** | rides.rider | 2 |",
    );
    expect(r.markdown).toContain(
      "<details open><summary><b>rides.refund</b> (critical, another repo): step 2 goes through this change</summary>",
    );
    expect(r.markdown).toMatch(/subgraph g\d\["rides · another repo"\]/);
    expect(r.markdown).toMatch(/-->\|"breaks: proto\/charges\.proto is removed"\|/);
  });

  it("names the contracts that changed in the model diff", () => {
    expect(formatDiff(diffModels(before, after), "text")).toContain(
      "~ charges (container): provides -proto/charges.proto +proto/charges.v2.proto",
    );
  });

  it("marks deprecations, and removed elements, too", () => {
    const deprecated = federate(
      buildModel([
        {
          path: "archdoc.yaml",
          text: paymentsYaml("proto/charges.proto, status: deprecated").replace(
            "ledger: { kind: datastore }",
            "ledger: { kind: datastore, status: deprecated }",
          ),
        },
      ]),
      { lockPath: "l", bundles: new Map() },
    );
    deprecated.landscape = before.landscape;
    const d = prReport({
      model: deprecated,
      changedFiles: [],
      diff: diffModels(before, deprecated),
      findings: [],
    });
    expect(
      d.elsewhere.filter((e) => e.effect === "deprecated").map((e) => [e.from, e.why]),
    ).toEqual([
      ["rides.gateway", "proto/charges.proto is deprecated"],
      ["rides.gateway", "payments.ledger is deprecated"],
    ]);

    const gone = federate(
      buildModel([
        {
          path: "archdoc.yaml",
          text: dedent(`
            archdoc: "2.0"
            namespace: payments
            elements:
              charges:
                kind: container
                provides: [{ api: proto/charges.proto }, { topic: refund.issued }]
                elements:
                  refunds: { kind: component }
          `),
        },
      ]),
      { lockPath: "l", bundles: new Map() },
    );
    gone.landscape = before.landscape;
    const g = prReport({
      model: gone,
      changedFiles: [],
      diff: diffModels(before, gone),
      findings: [],
    });
    expect(g.elsewhere.find((e) => e.target === "ledger")).toMatchObject({
      effect: "breaks",
      why: "payments.ledger is removed",
    });
  });
});
