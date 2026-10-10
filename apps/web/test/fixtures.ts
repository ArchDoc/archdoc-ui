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
