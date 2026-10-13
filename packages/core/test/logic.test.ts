import { describe, expect, it } from "vitest";
import { buildModel, compileCel, evaluateCel, lineage, simulate } from "../src/index.js";
import { dedent } from "./helpers.js";

const base = dedent(`
  archdoc: "2.0"
  namespace: payments
  actors:
    clerk: { kind: role, uses: { charges: { description: Refunds, sends: RefundRequest } } }
  elements:
    charges:
      kind: container
      uses: { ledger: { description: Posts entries, sends: LedgerEntry } }
    ledger:
      kind: datastore
      stores:
        refunds: { entity: Refund }
        ledger_entries: { entity: LedgerEntry }
        charges: { entity: Charge }
  data:
    RefundRequest:
      kind: message
      fields:
        charge_id: { type: uuid }
        amount_cents: { type: int }
        reason: { type: enum, values: [overcharge, no_show, safety] }
    Charge:
      kind: entity
      fields:
        id: { type: uuid }
        amount_cents: { type: int }
        status: { type: enum, values: [captured, partially_refunded, refunded] }
      states: [captured -> partially_refunded | refunded]
    Refund:
      kind: entity
      fields:
        id: { type: uuid }
        charge_id: { type: uuid }
        amount_cents: { type: int }
        status: { type: enum, values: [pending_approval, approved] }
    LedgerEntry:
      kind: entity
      fields:
        account: { type: string }
        amount_cents: { type: int }
        source_ref: { type: uuid }
        posted_at: { type: timestamp }
  logic:
    refund-approval:
      runs-in: charges
      input: { request: RefundRequest, charge: Charge }
      rules:
        - when: "request.reason == 'safety'"
          then: escalate
        - when: "request.amount_cents <= charge.amount_cents / 2"
          then: auto-approve
        - else: needs-approval
  mappings:
    request-to-refund:
      from: { request: RefundRequest }
      to: Refund
      fields:
        id: "'r-' + request.charge_id"
        charge_id: request.charge_id
        amount_cents: request.amount_cents
    refund-to-ledger:
      from: { refund: Refund }
      to: ledger.ledger_entries
      fields:
        account: "'charge:' + refund.charge_id"
        amount_cents: -refund.amount_cents
        source_ref: refund.id
        posted_at: now()
  journeys:
    refund:
      actor: clerk
      goal: Refund a charge
      steps:
        - from: clerk
          to: charges
          sends: RefundRequest
          via: request-to-refund
          decides: refund-approval
          branches:
            auto-approve:
              creates: { Refund: { status: approved } }
              changes: { Charge.status: captured -> partially_refunded }
            needs-approval:
              creates: { Refund: { status: pending_approval } }
              next: approve-refund
        - { from: charges, to: ledger, via: refund-to-ledger, when: auto-approve }
    approve-refund:
      actor: clerk
      goal: Approve a refund by hand
      steps:
        - { from: clerk, to: charges }
`);

const model = (text = base) => buildModel([{ path: "archdoc.yaml", text }]);
const messages = (m: { diagnostics: { code: string; message: string }[] }, prefix: string) =>
  m.diagnostics.filter((d) => d.code.startsWith(prefix)).map((d) => `${d.code}: ${d.message}`);

describe("cel", () => {
  it("lists the fields an expression reads, and evaluates ints as ints", () => {
    expect(
      compileCel("a.x + b.y * 2 + items.exists(i, i.v > a.z)", new Set(["a", "b", "items"])),
    ).toEqual({
      ok: true,
      refs: [
        { input: "a", field: "x" },
        { input: "b", field: "y" },
        { input: "a", field: "z" },
      ],
      unknownInputs: [],
    });
    expect(compileCel("a.x + c.y", new Set(["a"]))).toMatchObject({ unknownInputs: ["c"] });
    expect(compileCel("a +", new Set(["a"]))).toMatchObject({ ok: false });
    expect(evaluateCel("x.a / 2", { x: { a: 5 } })).toEqual({ ok: true, value: 2 });
    expect(evaluateCel("now()", {})).toEqual({ ok: true, value: "2026-01-01T00:00:00.000Z" });
  });
});

describe("mappings and logic", () => {
  it("are valid as written", () => {
    expect(model().diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  });

  it("report inputs, targets, fields, and expressions that don't hold", () => {
    const m = model(
      base
        .replace("from: { refund: Refund }", "from: { refund: Refunds }")
        .replace("source_ref: refund.id", "source_ref: refund.id\n      memo: refund.note")
        .replace("posted_at: now()", "posted_at: now(")
        .replace("to: Refund\n", "to: ledger.nope\n")
        .replace("then: escalate", "then: escalate\n      - else: oops")
        .replace(
          "request.amount_cents <= charge.amount_cents / 2",
          "req.amount_cents <= charge.total",
        ),
    );
    expect(messages(m, "ref/unresolved-data")).toEqual([
      'ref/unresolved-data: Mapping "refund-to-ledger" reads refund as "Refunds", which is not defined under data. Did you mean Refund?',
    ]);
    expect(messages(m, "logic/")).toEqual([
      'logic/unknown-target: Mapping "request-to-refund" writes to "ledger.nope", which is neither a data entry nor a datastore table (element.table) that stores one.',
      'logic/invalid-expression: Mapping "refund-to-ledger", field posted_at: "now(" isn\'t valid CEL: Unexpected token: EOF',
      'logic/unreachable: Logic "refund-approval": rule 3 comes after "else", so it never runs. Move else last.',
      'logic/unknown-input: Logic "refund-approval", rule 3: "req.amount_cents <= charge.total" reads req, which isn\'t an input. Its inputs are request, charge.',
    ]);
    expect(messages(m, "data/unknown-field")).toEqual([
      'data/unknown-field: Mapping "refund-to-ledger" writes memo, but LedgerEntry has no field "memo".',
      'data/unknown-field: Logic "refund-approval", rule 3: "req.amount_cents <= charge.total" reads charge.total, but Charge has no field "total".',
    ]);
  });

  it("check what journeys decide, the branches they take, and the mappings they write through", () => {
    const m = model(
      base
        .replace(
          "          needs-approval:",
          "          maybe:\n            next: approve-refund\n          needs-approval:",
        )
        .replace("when: auto-approve", "when: approved")
        .replace("via: refund-to-ledger", "via: refund-to-ledgr"),
    );
    expect(messages(m, "journey/")).toEqual([
      'journey/unknown-branch: Journey "refund", step 1 has a branch "maybe", which refund-approval never decides. Its outcomes: escalate, auto-approve, needs-approval.',
      'journey/unknown-outcome: Journey "refund", step 2 runs when "approved", but no earlier step decides it. Earlier outcomes: escalate, auto-approve, needs-approval.',
      'journey/unknown-mapping: Journey "refund", step 2 writes via "refund-to-ledgr", which isn\'t a mapping.',
    ]);
  });
});

describe("lineage", () => {
  it("follows a field through every mapping, both ways, with the tables it lands in", () => {
    const l = lineage(model(), "RefundRequest.amount_cents");
    expect(
      l?.downstream.map(
        (e) =>
          `${e.mapping}: ${e.from.map((f) => `${f.entry}.${f.field}`).join(", ")} → ${e.to.entry}.${e.to.field} = ${e.expression}`,
      ),
    ).toEqual([
      "payments.request-to-refund: payments.RefundRequest.amount_cents → payments.Refund.amount_cents = request.amount_cents",
      "payments.refund-to-ledger: payments.Refund.amount_cents → payments.LedgerEntry.amount_cents = -refund.amount_cents",
    ]);
    expect(l?.downstream.map((e) => e.copy)).toEqual([true, false]);
    expect(l?.stored.get("payments.LedgerEntry")).toEqual([
      { namespace: "payments", element: "ledger", table: "ledger_entries" },
    ]);
    const up = lineage(model(), "LedgerEntry.amount_cents");
    expect(up?.upstream.map((e) => e.mapping)).toEqual([
      "payments.refund-to-ledger",
      "payments.request-to-refund",
    ]);
  });
});

describe("simulate", () => {
  const sample = {
    RefundRequest: { charge_id: "c1", amount_cents: 400, reason: "overcharge" },
    Charge: { id: "c1", amount_cents: 1000, status: "captured" },
  };

  it("takes the branch the logic picks, and writes what it creates, changes, and maps", () => {
    const sim = simulate(model(), "refund", sample);
    expect(sim?.outcomes).toEqual(["auto-approve"]);
    const [first, second] = sim?.steps ?? [];
    expect(first?.decision).toEqual({
      logic: "payments.refund-approval",
      outcome: "auto-approve",
      rule: 2,
      when: "request.amount_cents <= charge.amount_cents / 2",
    });
    expect(
      first?.events.map((e) => `${e.kind} ${e.entry} ${e.tables.map((t) => t.table).join(",")}`),
    ).toEqual([
      "created payments.Refund refunds",
      "sent payments.RefundRequest ",
      "changed payments.Charge charges",
    ]);
    expect(first?.events[2]?.fields).toEqual([
      { field: "status", from: "captured", to: "partially_refunded" },
    ]);
    expect(second?.ran).toBe(true);
    expect(second?.events[0]).toMatchObject({
      kind: "created",
      entry: "payments.LedgerEntry",
      via: "payments.refund-to-ledger",
      tables: [{ element: "ledger", table: "ledger_entries" }],
    });
    expect(second?.problems).toEqual([]);
    expect(sim?.records["payments.LedgerEntry"]).toEqual({
      account: "charge:c1",
      amount_cents: -400,
      source_ref: "r-c1",
      posted_at: "2026-01-01T00:00:00.000Z",
    });
    expect(sim?.records["payments.Refund"]).toEqual({
      id: "r-c1",
      charge_id: "c1",
      amount_cents: 400,
      status: "approved",
    });
  });

  it("stops where a branch continues as another journey", () => {
    const sim = simulate(model(), "refund", {
      ...sample,
      RefundRequest: { ...sample.RefundRequest, amount_cents: 900 },
    });
    expect(sim?.outcomes).toEqual(["needs-approval"]);
    expect(sim?.next).toBe("approve-refund");
    expect(sim?.steps[1]).toMatchObject({
      ran: false,
      skipped: "the journey continues as approve-refund",
    });
    expect(sim?.records["payments.Refund"]).toMatchObject({
      amount_cents: 900,
      status: "pending_approval",
    });
  });
});
