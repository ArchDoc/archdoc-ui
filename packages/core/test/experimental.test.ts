import { describe, expect, it } from "vitest";
import { experimentalUses, formatExperimentalUses } from "../src/index.js";
import { dedent, model } from "./helpers.js";

/** A root file: the header, any imports, then the body. */
const file = (body: string, imports = "") =>
  `archdoc: "2.0"\nnamespace: rides\n${imports}${dedent(body)}`;

describe("experimentalUses", () => {
  it("is empty for a model that only uses the stable format", () => {
    const m = model({
      "archdoc.yaml": file(`
        actors:
          rider: { kind: person, uses: { app: Books } }
        elements:
          app: { kind: container, uses: { db: Saves } }
          db: { kind: datastore }
        journeys:
          book:
            actor: rider
            goal: Book a ride
            steps: [{ from: rider, to: app }, { from: app, to: db }]
        rules:
          - id: app-only
            allow-only: { to: db, from: [app] }
      `),
    });
    expect(experimentalUses(m)).toEqual([]);
  });

  it("lists imports, org rules, domains, mappings, logic, and steps that decide, with where", () => {
    const m = model({
      "archdoc.yaml": file(
        `
        actors:
          ops: { kind: team, uses: { api: Refunds } }
        elements:
          api: { kind: container, uses: { ledger: Writes } }
          ledger: { kind: datastore }
        data:
          Refund: { kind: message, fields: { amount: { type: int } } }
          Entry: { kind: entity, fields: { amount: { type: int } } }
        mappings:
          refund-to-entry:
            from: { refund: Refund }
            to: Entry
            fields: { amount: -refund.amount }
        logic:
          approve:
            runs-in: api
            input: { refund: Refund }
            rules:
              - { when: "refund.amount < 100", then: auto }
              - else: manual
        journeys:
          refund:
            actor: ops
            goal: Refund
            steps:
              - from: api
                to: ledger
                sends: Refund
                decides: approve
                branches: { auto: {}, manual: {} }
        domains:
          money: { namespaces: [payments] }
        rules:
          - id: org-wide
            scope: org
            deny: { from: api, to: ledger }
      `,
        "imports:\n  payments: { git: ../payments, version: ^1 }\n",
      ),
    });
    const uses = experimentalUses(m);
    expect(uses.map((u) => [u.feature, u.count])).toEqual([
      ["imports", 1],
      ["domains", 1],
      ["org rules", 1],
      ["mappings", 1],
      ["logic", 1],
      ["decisions", 1],
    ]);
    expect(uses.find((u) => u.feature === "mappings")?.location?.file).toBe("archdoc.yaml");
    expect(formatExperimentalUses(uses)).toBe(
      "imports (1) at archdoc.yaml:4, domains (1) at archdoc.yaml:36, org rules (1), mappings (1) at archdoc.yaml:14, logic (1) at archdoc.yaml:19, decisions (1) at archdoc.yaml:30",
    );
  });
});
