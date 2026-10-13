import type { Lock } from "@archdoc/spec";
import { describe, expect, it } from "vitest";
import {
  buildModel,
  check,
  createBundle,
  dataFlows,
  diffModels,
  federate,
  fieldReferences,
  formatDiff,
  integrityOf,
  parseStates,
  prReport,
  resolveData,
  serializeBundle,
} from "../src/index.js";
import { dedent } from "./helpers.js";

const paymentsText = dedent(`
  archdoc: "2.0"
  namespace: payments
  elements:
    charges:
      kind: container
      provides:
        - { api: proto/charges.proto, accepts: RefundRequest, returns: Refund }
        - { topic: refund.issued, carries: RefundIssued }
      uses:
        ledger: { description: Posts entries, sends: LedgerEntry }
    ledger:
      kind: datastore
      stores:
        ledger_entries: { entity: LedgerEntry, key: id }
        charges: { entity: Charge }
  data:
    RefundRequest:
      kind: message
      fields:
        trip_id: { type: uuid }
        amount_cents: { type: int }
        rider_email: { type: string, classification: pii }
    Refund: { kind: entity, fields: { id: { type: uuid }, amount_cents: { type: int } } }
    RefundIssued: { kind: event, fields: { refund_id: { type: uuid } } }
    LedgerEntry: { kind: entity, fields: { amount_cents: { type: int } } }
    Charge:
      kind: entity
      fields:
        card_last4: { type: string, classification: pci }
        status: { type: enum, values: [authorized, captured, partially_refunded, refunded] }
      states:
        - authorized -> captured
        - captured -> partially_refunded | refunded
`);

/** Payments, plus another model file with more actors, elements, journeys, or rules. */
const payments = (extra = "") =>
  buildModel(
    [
      { path: "archdoc.yaml", text: paymentsText },
      ...(extra ? [{ path: "extra.yaml", text: dedent(extra) }] : []),
    ],
    { root: "archdoc.yaml" },
  );

const codes = (m: { diagnostics: { code: string; severity: string }[] }) =>
  m.diagnostics.filter((d) => d.severity !== "info").map((d) => d.code);
const messages = (m: { diagnostics: { code: string; message: string }[] }, code: string) =>
  m.diagnostics.filter((d) => d.code === code).map((d) => d.message);

describe("data entries", () => {
  it("point fields at other entries, written or by type, and warn about ones that don't resolve", () => {
    const m = payments(`
      data:
        RefundLine:
          kind: entity
          fields:
            refund: { type: Refund }
            entry: { type: uuid, references: LedgerEntry.amount_cents }
            ledger: { type: uuid, references: payments.LedgerEntry }
            bad: { type: uuid, references: Nope.id }
            worse: { type: uuid, references: Refund.nope }
    `);
    expect(messages(m, "data/unknown-reference")).toEqual([
      'RefundLine.bad references "Nope.id", which isn\'t a data entry or Entry.field.',
      "RefundLine.worse references Refund.nope, but Refund has no field nope.",
    ]);
    const refs = fieldReferences(m).map(
      (r) => `${r.entry}.${r.field} -> ${r.to.entry}.${r.to.field} (${r.how})`,
    );
    expect(refs).toEqual([
      "payments.RefundLine.refund -> payments.Refund.id (type)",
      "payments.RefundLine.entry -> payments.LedgerEntry.amount_cents (references)",
      // An entry alone points at the key its datastore stores it by.
      "payments.RefundLine.ledger -> payments.LedgerEntry.id (references)",
    ]);
  });

  it("resolve locally, qualified with the model's namespace, or not at all", () => {
    const m = payments();
    expect(codes(m)).toEqual([]);
    expect(resolveData(m, "Charge")).toMatchObject({ status: "found", ref: "payments.Charge" });
    expect(resolveData(m, "payments.Charge")).toMatchObject({ status: "found", local: true });
    expect(resolveData(m, "charge")).toMatchObject({
      status: "missing",
      hint: "Did you mean Charge?",
    });
    expect(resolveData(m, "trips.Trip")).toMatchObject({ status: "missing" });
  });

  it("read lifecycles, including chains and alternatives", () => {
    const life = parseStates(["a -> b | c", "c -> d -> e", "broken ->"]);
    expect([...life.states]).toEqual(["a", "b", "c", "d", "e"]);
    expect([...(life.next.get("a") ?? [])]).toEqual(["b", "c"]);
    expect([...(life.next.get("d") ?? [])]).toEqual(["e"]);
    expect(life.invalid).toEqual(["broken ->"]);
  });

  it("report references to data that isn't defined, wherever they're written", () => {
    const m = payments(`
      journeys:
        refund:
          actor: clerk
          goal: Refund
          steps:
            - { from: clerk, to: charges, sends: RefundRequset }
      actors:
        clerk: { kind: role, uses: { charges: Refunds } }
    `);
    const bad = buildModel([
      {
        path: "archdoc.yaml",
        text: paymentsText.replace("entity: LedgerEntry, key: id", "entity: LedgerEntri"),
      },
    ]);
    expect(messages(m, "ref/unresolved-data")).toEqual([
      'Journey "refund", step 1 sends "RefundRequset", which is not defined under data. Did you mean RefundRequest?',
    ]);
    expect(messages(bad, "ref/unresolved-data")).toEqual([
      'ledger stores ledger_entries as "LedgerEntri", which is not defined under data. Did you mean LedgerEntry?',
    ]);
  });

  it("check what journey steps change and create against fields, values, and states", () => {
    const m = payments(`
      actors:
        clerk: { kind: role, uses: { charges: Refunds } }
      journeys:
        refund:
          actor: clerk
          goal: Refund a charge
          steps:
            - from: clerk
              to: charges
              sends: RefundRequest
              creates: { Refund: { amount_cents: 5 }, Charge: { colour: red } }
              changes:
                Charge.status: captured -> refunded
                Charge.colour: red -> blue
            - from: charges
              to: ledger
              changes:
                Charge.status: refunded -> captured
                payments.Charge.status: captured -> refundd
    `);
    expect(messages(m, "data/unknown-field")).toEqual([
      'Journey "refund", step 1 creates Charge: Charge has no field "colour".',
      'Journey "refund", step 1 changes Charge.colour: Charge has no field "colour".',
    ]);
    expect(messages(m, "data/invalid-transition")).toEqual([
      "Journey \"refund\", step 2 changes Charge.status from refunded to captured, which Charge's states don't allow. refunded is a final state.",
    ]);
    expect(messages(m, "data/invalid-value")).toEqual([
      'Journey "refund", step 2 changes payments.Charge.status: "refundd" isn\'t one of status\'s values: authorized, captured, partially_refunded, refunded.',
    ]);
  });

  it("report data an element doesn't accept, on relationships and journey steps", () => {
    const m = payments(`
      actors:
        clerk: { kind: role, uses: { app: Refunds } }
      elements:
        app:
          kind: container
          uses:
            charges: { via: proto/charges.proto, sends: LedgerEntry }
        subscriber:
          kind: container
          uses:
            charges: { via: refund.issued }
      journeys:
        refund:
          actor: clerk
          goal: Refund
          steps:
            - { from: clerk, to: app }
            - { from: app, to: charges, sends: RefundRequest }
            - { from: app, to: charges, sends: Charge }
            - { from: charges, to: app, sends: Refund }
            - { from: charges, to: subscriber, sends: RefundIssued }
    `);
    expect(messages(m, "data/not-accepted")).toEqual([
      'Journey "refund", step 3: app → charges sends Charge, which charges doesn\'t accept. It accepts: RefundRequest.',
      "app → charges sends LedgerEntry, which charges doesn't accept through proto/charges.proto. It accepts: RefundRequest.",
    ]);
  });

  it("flow along relationships, through the contracts they use, and through journey steps", () => {
    const m = payments(`
      elements:
        app:
          kind: container
          uses:
            charges: { via: proto/charges.proto }
        subscriber:
          kind: container
          uses:
            charges: { via: refund.issued }
    `);
    const flows = dataFlows(m).map(
      (f) =>
        `${f.how}: ${f.from.type === "external" ? f.from.ref : f.from.id} → ${f.to.type === "external" ? f.to.ref : f.to.id} ${f.data}`,
    );
    expect(flows).toEqual([
      "sends: charges → ledger LedgerEntry",
      "accepts: app → charges RefundRequest",
      "returns: charges → app Refund",
      "carries: charges → subscriber RefundIssued",
    ]);
  });
});

describe("data rules", () => {
  it("flag classified data stored outside where it may be, and sent where it may not go", () => {
    const m = payments(`
      elements:
        warehouse:
          kind: datastore
          stores: { charge_copies: { entity: Charge } }
        analytics:
          kind: external
        app:
          kind: container
          uses:
            charges: { via: proto/charges.proto }
            analytics: { sends: RefundRequest }
            warehouse: Copies charges
      rules:
        - id: pci-in-ledger
          description: Card data only lives in the ledger.
          data: { classification: pci, stored-in: ledger }
        - id: no-pii-out
          data: { classification: [pii, phi], not-sent-to: { kind: external } }
    `);
    expect(codes(m)).toEqual([]);
    const findings = check(m).findings.filter((f) => f.code === "rule/violation");
    expect(findings.map((f) => f.message)).toEqual([
      'The model says warehouse stores Charge (card_last4 (pci)) in charge_copies, which breaks rule "pci-in-ledger": Card data only lives in the ledger.',
      'The model says app sends RefundRequest (rider_email (pii)) to analytics, which breaks rule "no-pii-out".',
    ]);
    expect(findings.map((f) => f.rule)).toEqual(["pci-in-ledger", "no-pii-out"]);
  });

  it("reject a data rule that says neither where data may be stored nor where it may not go", () => {
    const m = payments(`
      rules:
        - id: empty
          data: { classification: pii }
    `);
    expect(codes(m)).toContain("schema/invalid");
  });
});

describe("data in other repos", () => {
  const bundle = (() => {
    const { bundle } = createBundle(
      [{ path: "archdoc.yaml", text: paymentsText }],
      "archdoc.yaml",
      {
        version: "5.0.0",
      },
    );
    if (!bundle) throw new Error("payments doesn't build");
    return serializeBundle(bundle);
  })();
  const lock: Lock = {
    lockfileVersion: 1,
    imports: {
      payments: {
        source: "github:acme/payments",
        requested: "^5",
        version: "5.0.0",
        bundle: "vendor/payments.json",
        integrity: integrityOf(bundle),
      },
    },
  };
  const rides = (extra: string) => {
    const m = buildModel(
      [
        {
          path: "archdoc.yaml",
          text: dedent(`
            archdoc: "2.0"
            namespace: rides
            imports:
              payments: { github: acme/payments, version: ^5 }
            elements:
              gateway:
                kind: container
                uses:
                  payments.charges: { via: proto/charges.proto, sends: payments.Charge }
              tracker: { kind: external }
          `),
        },
        { path: "extra.yaml", text: dedent(extra) },
      ],
      { root: "archdoc.yaml" },
    );
    const before = codes(m);
    federate(m, {
      lockPath: ".archdoc/archdoc.lock",
      lock,
      bundles: new Map([
        [
          "payments",
          { path: ".archdoc/vendor/payments.json", text: bundle, integrity: integrityOf(bundle) },
        ],
      ]),
    });
    return { m, before };
  };

  it("are checked once the import is synced, and not before", () => {
    const { m, before } = rides(`
      journeys:
        refund:
          actor: gateway
          goal: Refund
          steps:
            - { from: gateway, to: payments.charges, sends: payments.RefundReqest, changes: { payments.Charge.status: refunded -> authorized } }
    `);
    expect(before).not.toContain("data/not-accepted");
    expect(messages(m, "ref/unknown-in-import")).toEqual([
      'Journey "refund", step 1 sends payments.RefundReqest, which payments@5.0.0 doesn\'t have. Did you mean payments.RefundRequest?',
    ]);
    expect(messages(m, "data/not-accepted")).toEqual([
      "gateway → payments.charges sends payments.Charge, which payments.charges doesn't accept through proto/charges.proto. It accepts: payments.RefundRequest.",
    ]);
    expect(messages(m, "data/invalid-transition")).toHaveLength(1);
  });

  it("are pointed at by references once synced", () => {
    const { m, before } = rides(`
      data:
        Receipt:
          kind: entity
          fields:
            charge: { type: uuid, references: payments.Charge }
            refund: { type: uuid, references: payments.Refund.nope }
    `);
    expect(before).not.toContain("data/unknown-reference");
    expect(messages(m, "data/unknown-reference")).toEqual([
      "Receipt.refund references payments.Refund.nope, but payments.Refund has no field nope.",
    ]);
    expect(fieldReferences(m).filter((r) => r.entry === "rides.Receipt")).toEqual([
      {
        entry: "rides.Receipt",
        field: "charge",
        to: { entry: "payments.Charge", field: "id" },
        how: "references",
      },
    ]);
  });

  it("bring their classifications into this repo's data rules", () => {
    const { m } = rides(`
      actors:
        rider: { kind: person, uses: { gateway: Asks } }
      journeys:
        refund:
          actor: rider
          goal: Refund
          steps:
            - { from: rider, to: gateway }
            - { from: gateway, to: tracker, sends: payments.RefundRequest }
      rules:
        - id: no-pii-out
          data: { classification: pii, not-sent-to: { kind: external } }
    `);
    const findings = check(m).findings.filter((f) => f.code === "rule/violation");
    expect(findings.map((f) => f.message)).toEqual([
      'The model says Journey "refund", step 2: gateway sends payments.RefundRequest (rider_email (pii)) to tracker, which breaks rule "no-pii-out".',
    ]);
  });
});

describe("data in diffs and the PR report", () => {
  const base = payments(`
    elements:
      analytics: { kind: external }
      app:
        kind: container
        uses:
          charges: { via: proto/charges.proto }
          analytics: { sends: Refund }
  `);
  const head = buildModel(
    [
      {
        path: "archdoc.yaml",
        text: paymentsText
          .replace(
            "rider_email: { type: string, classification: pii }",
            "rider_email: { type: string, classification: pii }\n      phone: { type: string, classification: pii }",
          )
          .replace(
            "Refund: { kind: entity, fields: { id: { type: uuid }, amount_cents: { type: int } } }",
            "Refund: { kind: entity, fields: { id: { type: uuid }, amount_cents: { type: int }, card_last4: { type: string, classification: pci } } }",
          ),
      },
      {
        path: "extra.yaml",
        text: dedent(`
          elements:
            analytics: { kind: external }
            app:
              kind: container
              uses:
                charges: { via: proto/charges.proto }
                analytics: { sends: [Refund, RefundRequest] }
        `),
      },
    ],
    { root: "archdoc.yaml" },
  );

  it("describe field, sends, and store changes", () => {
    const text = formatDiff(diffModels(base, head), "text");
    expect(text).toContain("~ RefundRequest (message): fields +phone (pii)");
    expect(text).toContain("~ Refund (entity): fields +card_last4 (pci)");
    expect(text).toContain("~ app → analytics (sends +RefundRequest)");
  });

  it("call out sensitive data that goes somewhere new, external first", () => {
    const r = prReport({
      model: head,
      base,
      changedFiles: [],
      diff: diffModels(base, head),
      findings: [],
    });
    const name = (t: { type: string; id?: string; ref?: string }) => t.id ?? t.ref;
    expect(
      r.data.flows.map(
        (f) =>
          `${f.flow.how} ${name(f.flow.from)} → ${name(f.flow.to)} ${f.flow.data}: ${f.fields.map((x) => x.field).join(", ")}${f.external ? " (external)" : ""}`,
      ),
    ).toEqual([
      "sends app → analytics Refund: card_last4 (external)",
      "sends app → analytics RefundRequest: rider_email, phone (external)",
      "accepts app → charges RefundRequest: phone",
      "returns charges → app Refund: card_last4",
    ]);
    expect(r.markdown).toContain("### Data");
    expect(r.markdown).toContain(
      "> [!CAUTION]\n> This change sends sensitive data to an external element",
    );
    expect(r.markdown).toContain(
      "| `RefundRequest` | rider_email (pii), phone (pii) | `app` → `analytics` (external) | sends |",
    );
    expect(r.markdown).toContain("- RefundRequest (message): fields +phone (pii)");
  });
});
