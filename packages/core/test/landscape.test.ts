import type { Bundle, IncludedBundle } from "@archdoc/spec";
import { describe, expect, it } from "vitest";
import {
  buildModel,
  check,
  composeLandscape,
  createBundle,
  federate,
  integrityOf,
  type Model,
  serializeBundle,
} from "../src/index.js";
import { dedent } from "./helpers.js";

const bundleOf = (text: string, version: string, includes?: IncludedBundle[]): Bundle => {
  const b = createBundle([{ path: "archdoc.yaml", text: dedent(text) }], "archdoc.yaml", {
    version,
    includes,
  }).bundle;
  if (!b) throw new Error("doesn't build");
  return b;
};

const payments = bundleOf(
  `
    archdoc: "2.0"
    namespace: payments
    name: Payments
    actors:
      payments-team: { kind: team }
      clerk: { kind: role, uses: { charges: Refunds } }
    elements:
      charges:
        kind: container
        owners: [payments-team]
        code: services/charges/**
        uses: { ledger: Records }
      ledger: { kind: datastore }
    journeys:
      refund:
        actor: clerk
        goal: Refund
        steps: [{ from: clerk, to: charges }, { from: charges, to: ledger }]
  `,
  "5.0.0",
);
const rides = bundleOf(
  `
    archdoc: "2.0"
    namespace: rides
    imports:
      payments: { github: acme/payments, version: ^5 }
      zendesk: { file: stubs/zendesk.yaml }
    actors:
      clerk: { kind: role, uses: { app: Helps } }
      rider: { kind: person, uses: { app: Books } }
    elements:
      app: { kind: container, tags: [app], owners: [rides-team], uses: { api: Calls, payments.ledger: Peeks } }
      api: { kind: container, uses: { payments.charges: Charges, zendesk.tickets: Files } }
    journeys:
      refund:
        actor: rider
        goal: Get money back
        steps: [{ from: rider, to: app }, { from: app, to: api }, { from: api, to: payments.charges }]
  `,
  "1.0.0",
);

const landscapeText = `
  archdoc: "2.0"
  namespace: acme
  name: Acme
  imports:
    payments: { github: acme/payments, version: ^5 }
    rides: { github: acme/rides, version: ^1 }
  actors:
    payments-team: { kind: team, members: ["@acme/payments"] }
    rides-team: { kind: team }
    agent: { kind: role, uses: { rides.api: Refunds } }
  journeys:
    goodwill:
      actor: agent
      goal: Make it right
      importance: critical
      steps:
        - { from: agent, to: rides.api }
        - { from: rides.api, to: payments.charges }
        - { from: payments.charges, to: payments.ledger }
  domains:
    money: { name: Money, owners: [payments-team], namespaces: [payments], elements: [rides.api] }
    nowhere: { namespaces: [billing], elements: [rides.nope] }
  rules:
    - id: apps-never-touch-datastores
      scope: org
      deny: { from: { tag: app }, to: { kind: datastore } }
    - id: only-rides-calls-charges
      allow-only: { to: payments.charges, from: [rides.api] }
`;

/** A model federated with these bundles, as the loader would after a sync. */
function federated(text: string, imports: Record<string, string>, landscape?: string): Model {
  const m = buildModel([{ path: "archdoc.yaml", text: dedent(text) }]);
  const lockEntry = (ns: string, t: string) => ({
    source: `github:acme/${ns}`,
    requested: "^5",
    version: JSON.parse(t).version,
    bundle: `vendor/${ns}.json`,
    integrity: integrityOf(t),
  });
  const imported = Object.entries(imports);
  return federate(m, {
    lockPath: "archdoc.lock",
    lock: {
      lockfileVersion: 1,
      imports: Object.fromEntries(
        imported.map(([ns, t]) => [
          ns,
          { ...lockEntry(ns, t), requested: ns === "rides" ? "^1" : "^5" },
        ]),
      ),
      ...(landscape
        ? {
            landscape: {
              ...lockEntry("architecture", landscape),
              requested: "^1",
              namespace: "acme",
            },
          }
        : {}),
    },
    bundles: new Map([
      ...imported.map(([ns, t]) => [ns, { path: ns, text: t, integrity: integrityOf(t) }] as const),
      ...(landscape
        ? ([
            ["(landscape)", { path: "l", text: landscape, integrity: integrityOf(landscape) }],
          ] as const)
        : []),
    ]),
  });
}

const landscape = federated(landscapeText, {
  payments: serializeBundle(payments),
  rides: serializeBundle(rides),
});

describe("composeLandscape", () => {
  const c = composeLandscape(landscape);
  const m = c.model;

  it("nests each repo under its namespace, keeping element IDs", () => {
    expect([...m.elements.keys()]).toEqual([
      "payments",
      "payments.charges",
      "payments.ledger",
      "rides",
      "rides.app",
      "rides.api",
    ]);
    expect(m.elements.get("payments")?.spec).toMatchObject({
      kind: "system",
      name: "Payments",
      tags: ["repo"],
      documentation: "From payments@5.0.0 (github:acme/payments).",
    });
    // Code paths belong to another repo, so they're left out.
    expect(m.elements.get("payments.charges")?.code).toEqual([]);
    expect(c.repos.map((r) => `${r.namespace}@${r.version}`)).toEqual([
      "payments@5.0.0",
      "rides@1.0.0",
    ]);
  });

  it("merges repo copies of landscape teams, and prefixes actors two repos share", () => {
    expect([...m.actors.keys()].sort()).toEqual([
      "agent",
      "payments-clerk",
      "payments-team",
      "rider",
      "rides-clerk",
      "rides-team",
    ]);
    expect(m.actors.get("payments-team")?.spec.members).toEqual(["@acme/payments"]);
    expect(m.actors.get("rides-clerk")?.spec).toMatchObject({
      name: "clerk (rides)",
      tags: ["repo:rides"],
    });
    expect(m.elements.get("payments.charges")?.spec.owners).toEqual(["payments-team"]);
  });

  it("connects relationships and journeys across repos, and checks them as a whole", () => {
    const rel = (from: string, to: string) =>
      m.relationships.some((r) => r.from.id === from && r.to.type === "element" && r.to.id === to);
    expect(rel("rides.api", "payments.charges")).toBe(true);
    expect(rel("agent", "rides.api")).toBe(true);
    expect([...m.journeys.keys()].sort()).toEqual(["goodwill", "payments-refund", "rides-refund"]);
    expect(m.journeys.get("rides-refund")?.spec.steps.at(-1)).toMatchObject({
      from: "rides.api",
      to: "payments.charges",
    });
    const errors = m.diagnostics.filter((d) => d.severity !== "info").map((d) => d.code);
    expect(errors).toEqual(["landscape/outside-reference"]);
    expect(m.diagnostics.find((d) => d.code === "landscape/outside-reference")?.message).toBe(
      "rides.api → zendesk.tickets points outside the landscape. Import that namespace in the landscape to include it.",
    );
  });

  it("runs the landscape's rules across repos", () => {
    const rules = check(m).findings.filter((f) => f.code === "rule/violation");
    expect(rules.map((f) => f.message)).toEqual([
      'The model declares rides.app → payments.ledger, which breaks rule "apps-never-touch-datastores".',
      // allow-only sees every caller in every repo, including payments' own.
      'The model declares payments-clerk → payments.charges, which breaks rule "only-rides-calls-charges".',
    ]);
  });

  it("makes owners that resolve to no actor errors, and maps domains to IDs", () => {
    const noTeam = federated(landscapeText.replace("    rides-team: { kind: team }\n", ""), {
      payments: serializeBundle(payments),
      rides: serializeBundle(rides),
    });
    expect(
      composeLandscape(noTeam)
        .model.diagnostics.filter((d) => d.code === "ref/unresolved-owner")
        .map((d) => d.severity),
    ).toEqual(["error"]);
    expect(c.domains).toEqual([
      {
        id: "money",
        name: "Money",
        description: undefined,
        owners: ["payments-team"],
        members: ["payments", "rides.api"],
      },
      { id: "nowhere", name: undefined, description: undefined, owners: [], members: [] },
    ]);
    expect(
      landscape.diagnostics
        .filter((d) => d.code === "ref/unknown-domain-member")
        .map((d) => d.message),
    ).toEqual([
      'Domain "nowhere" lists namespace "billing", which isn\'t imported. Add it to imports.',
      'Domain "nowhere" lists "rides.nope", which isn\'t an element here or in an imported namespace.',
    ]);
  });
});

describe("org definitions in a team's repo", () => {
  const landscapeBundle = serializeBundle(bundleOf(landscapeText, "1.0.0", [payments, rides]));
  const team = (extra = "") =>
    federated(
      `
        archdoc: "2.0"
        namespace: web
        landscape: { github: acme/architecture, version: ^1 }
        elements:
          shop: { kind: container, tags: [app], owners: [payments-team, ghosts], uses: { db: Reads } }
          db: { kind: datastore }
        ${extra}
      `.replace(/\n {2}(?=\S)/g, "\n  "),
      {},
      landscapeBundle,
    );

  it("resolves owners against the landscape's teams", () => {
    const owners = team().diagnostics.filter((d) => d.code === "ref/unresolved-owner");
    expect(owners.map((d) => d.message)).toEqual([
      'Owner "ghosts" is not an actor in this model. Add it under actors (usually kind: team), or import a landscape that defines it.',
    ]);
  });

  it("runs org rules, and only those, quietly skipping selectors for other repos", () => {
    const findings = check(team()).findings;
    expect(
      findings.filter((f) => f.code === "rule/violation").map((f) => [f.rule, f.message]),
    ).toEqual([
      [
        "acme/apps-never-touch-datastores",
        'The model declares shop → db, which breaks rule "acme/apps-never-touch-datastores".',
      ],
    ]);
    expect(findings.filter((f) => f.code === "rule/unknown-selector")).toEqual([]);
  });
});
