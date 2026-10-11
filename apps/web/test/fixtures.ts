import { buildModel, type Model } from "@archdoc/core/browser";

const text = `
archdoc: "2.0"
namespace: rides
imports:
  payments: { github: acme/payments, version: ^5 }
actors:
  passenger: { kind: person, uses: { app: Books rides } }
  ops-team: { kind: team, uses: { console: Operates } }
  lurker: { kind: person, description: Uses nothing yet }
elements:
  app: { kind: container, uses: { api: Calls, payments.charges: Pays } }
  console: { kind: container, uses: { api: { description: Admin calls, status: planned } } }
  platform:
    kind: system
    owners: [ops-team]
    elements:
      api: { kind: container, uses: { db: Writes, cache: Reads } }
      db: { kind: datastore }
      cache: { kind: datastore }
  orphan: { kind: container, description: Nothing connects to it }
journeys:
  book:
    actor: passenger
    goal: Get a ride
    steps:
      - { from: passenger, to: app }
      - { from: app, to: api }
      - { from: api, to: db }
`;

export function ridesModel(): Model {
  const model = buildModel([{ path: "archdoc.yaml", text }]);
  if (model.diagnostics.length) throw new Error(JSON.stringify(model.diagnostics));
  return model;
}

// A composed landscape, as `archdoc landscape build` writes it: each repo is a system.
const landscapeText = `
archdoc: "2.0"
namespace: acme
actors:
  payments-team: { kind: team }
  rides-team: { kind: team }
  support-agent: { kind: role, uses: { rides.api-gateway: Issues refunds } }
  rider: { kind: person, tags: ["repo:rides"], uses: { rides.app: Requests refunds } }
elements:
  payments:
    kind: system
    tags: [repo]
    elements:
      charges:
        kind: container
        owners: [payments-team]
        uses: { payments.ledger: Records }
        elements:
          refunds: { kind: component }
      ledger: { kind: datastore, owners: [payments-team] }
  rides:
    kind: system
    tags: [repo]
    elements:
      app: { kind: container, owners: [rides-team], uses: { rides.api-gateway: Calls } }
      api-gateway: { kind: container, owners: [rides-team], uses: { payments.charges.refunds: Refunds } }
      scratch: { kind: container }
  status-page: { kind: container, description: The landscape's own element }
journeys:
  request-refund:
    actor: rider
    goal: Get money back
    steps:
      - { from: rider, to: rides.app }
      - { from: rides.app, to: rides.api-gateway }
      - { from: rides.api-gateway, to: payments.charges.refunds }
      - { from: payments.charges, to: payments.ledger }
`;

export function landscapeModel(): Model {
  const model = buildModel([{ path: "acme.landscape.json", text: landscapeText }]);
  if (model.diagnostics.length) throw new Error(JSON.stringify(model.diagnostics));
  return model;
}

export const landscapeInfo = {
  repos: [
    { namespace: "payments", name: "Payments", version: "5.0.0" },
    { namespace: "rides", version: "1.0.0" },
  ],
  domains: [
    { id: "money", name: "Money", owners: ["payments-team"], members: ["payments"] },
    { id: "riders", owners: [], members: ["rides.app", "rides.api-gateway"] },
  ],
};
