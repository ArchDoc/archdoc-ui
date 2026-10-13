import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildModel,
  check,
  dataFlows,
  fieldReferences,
  type Model,
  simulate,
  stepMessage,
} from "../src/index.js";

// Hypothetical systems from different industries, each a single model file
// that uses the whole spec: journeys whose every step carries a message,
// data with classifications, foreign keys and lifecycles, logic, mappings,
// and relationship and data rules.
const dir = new URL("../../../examples/industries/", import.meta.url);
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => f.replace(/\.yaml$/, ""));

const load = (name: string, edit: (text: string) => string = (t) => t): Model =>
  buildModel([
    { path: `${name}.yaml`, text: edit(readFileSync(new URL(`${name}.yaml`, dir), "utf8")) },
  ]);

describe("industry examples", () => {
  it("cover healthcare, banking, e-commerce, logistics, insurance, and energy", () => {
    expect(names.sort()).toEqual([
      "banking",
      "ecommerce",
      "energy",
      "healthcare",
      "insurance",
      "logistics",
    ]);
  });

  describe.each(names)("%s", (name) => {
    const m = load(name);

    it("is valid, with no warnings", () => {
      expect(m.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    });

    it("keeps its own rules", () => {
      expect(check(m).findings).toEqual([]);
    });

    it("says what every journey step carries", () => {
      const flows = dataFlows(m);
      const missing = [...m.journeys.values()].flatMap((j) =>
        j.steps.filter((s) => !stepMessage(m, s, flows)).map((s) => `${j.id}#${s.index + 1}`),
      );
      expect(missing).toEqual([]);
    });

    it("links its tables with foreign keys", () => {
      expect(fieldReferences(m).length).toBeGreaterThan(2);
    });

    it("models data, logic or mappings, and rules", () => {
      expect(m.data.size).toBeGreaterThan(5);
      expect(m.logic.size + m.mappings.size).toBeGreaterThan(1);
      expect(m.rules.length).toBeGreaterThan(1);
    });
  });
});

/** The outcome each sample's decision takes, and the records the journey leaves. */
function run(m: Model, journey: string, sample: Record<string, unknown>) {
  const sim = simulate(m, journey, sample);
  if (!sim) throw new Error(`no journey ${journey}`);
  const problems = sim.steps.flatMap((s) => s.problems);
  if (problems.length) throw new Error(problems.join("\n"));
  return sim;
}

describe("industry decisions", () => {
  it("healthcare: urgent requests go to the on-call clinician", () => {
    const m = load("healthcare");
    const visit = (urgency: string) =>
      run(m, "book-a-visit", {
        VisitRequest: { patient_id: "p-1", reason: "rash", urgency },
      });
    expect(visit("urgent").outcomes).toEqual(["on-call"]);
    expect(visit("routine").outcomes).toEqual(["book"]);
    expect(visit("routine").records["clinic.Appointment"]).toMatchObject({
      id: "appt-p-1",
      status: "booked",
    });
  });

  it("banking: frozen cards, short balances, and risky purchases aren't approved", () => {
    const m = load("banking");
    const authorize = (over: { frozen?: boolean; available?: number; risk?: number }) =>
      run(m, "authorize-purchase", {
        AuthRequest: { pan: "4111", amount_cents: 5000, merchant_category: "5411", country: "GB" },
        Card: {
          token: "tok-1",
          pan: "4111",
          expiry: "12/30",
          account_id: "a-1",
          frozen: !!over.frozen,
        },
        Account: { id: "a-1", holder_name: "Ana", available_cents: over.available ?? 100000 },
        Score: { risk: over.risk ?? 0.1 },
      }).outcomes;
    expect(authorize({})).toEqual(["approved"]);
    expect(authorize({ frozen: true })).toEqual(["declined-frozen"]);
    expect(authorize({ available: 100 })).toEqual(["declined-funds"]);
    expect(authorize({ risk: 0.95 })).toEqual(["held-for-review"]);
  });

  it("e-commerce: the order is the cart at checkout, and paying marks it paid", () => {
    const m = load("ecommerce");
    const sim = run(m, "check-out", {
      Cart: { id: "c-1", customer_id: "u-1", total_cents: 4200, items: [] },
      CheckoutRequest: { cart_id: "c-1", shipping_address: "1 Main St", payment_method: "pm_1" },
    });
    expect(sim.records["shop.Order"]).toMatchObject({
      id: "order-c-1",
      total_cents: 4200,
      status: "paid",
    });
    expect(sim.records["shop.PaymentIntent"]).toEqual({
      amount_cents: 4200,
      payment_method: "pm_1",
    });
  });

  it("logistics: a refused or third failed attempt goes back to the sender", () => {
    const m = load("logistics");
    const scan = (code: string, attempts: number) =>
      run(m, "doorstep-scan", {
        Scan: { tracking_number: "T1", hub: "LDN", code, at: "2026-01-01T10:00:00Z" },
        Shipment: {
          tracking_number: "T1",
          recipient_phone: "+44",
          address: "1 Main St",
          hub: "LDN",
          attempts,
          status: code === "refused" || attempts >= 2 ? "exception" : "out_for_delivery",
        },
      });
    expect(scan("delivered", 0).outcomes).toEqual(["delivered"]);
    expect(scan("no_access", 0).outcomes).toEqual(["retry-tomorrow"]);
    expect(scan("no_access", 2).outcomes).toEqual(["return-to-sender"]);
    expect(scan("delivered", 0).steps.filter((s) => s.ran)).toHaveLength(7);
    expect(scan("no_access", 0).steps.filter((s) => s.ran)).toHaveLength(5);
  });

  it("insurance: small clean claims pay out at once, less the excess", () => {
    const m = load("insurance");
    const claim = (estimate: number, fraud: number) =>
      run(m, "report-a-claim", {
        LossReport: {
          policy_number: "P1",
          happened_at: "2026-01-01T00:00:00Z",
          description: "Rear-ended",
          bank_account: "12-34-56 12345678",
        },
        Claim: { estimate_cents: estimate, fraud_score: fraud },
        Policy: {
          number: "P1",
          holder_name: "Ana",
          vehicle_reg: "AB12",
          excess_cents: 25000,
          active: true,
        },
      });
    const small = claim(120000, 0.1);
    expect(small.outcomes).toEqual(["straight-through"]);
    expect(small.records["claims.Payout"]).toMatchObject({ amount_cents: 95000 });
    expect(small.records["claims.Claim"]).toMatchObject({ status: "paid" });
    expect(claim(900000, 0.1).outcomes).toEqual(["adjuster-review"]);
    expect(claim(900000, 0.1).next).toBe("adjuster-review");
    expect(claim(120000, 0.8).outcomes).toEqual(["fraud-review"]);
  });

  it("energy: a feeder going quiet together is an outage, and bills add the standing charge", () => {
    const m = load("energy");
    const gap = (silent: number, minutes: number) =>
      run(m, "reading-to-outage", {
        RawReading: { meter_id: "m-1", register_wh: 1500, at: "2026-01-01T00:15:00Z" },
        Gap: { meters_silent: silent, meters_on_feeder: 100, minutes_silent: minutes },
      });
    expect(gap(40, 30).outcomes).toEqual(["outage"]);
    expect(gap(2, 50).outcomes).toEqual(["estimate"]);
    expect(gap(2, 10).outcomes).toEqual(["wait"]);
    expect(gap(2, 10).records["grid.MeterReading"]).toMatchObject({ meter_id: "m-1", kwh: 1.5 });

    const bill = run(m, "monthly-bill", {
      Account: {
        id: "a-1",
        holder_name: "Ana",
        address: "1 Main St",
        tariff_pence_per_kwh: 24.5,
        standing_charge_pence: 1500,
      },
      MonthlyTotal: { account_id: "a-1", kwh: 300 },
    });
    expect(bill.records["grid.Bill"]).toMatchObject({ amount_pence: 8850, status: "issued" });
  });
});

describe("industry rules", () => {
  it("banking: sending card numbers to the fraud model breaks a rule", () => {
    const m = load("banking", (t) =>
      t.replace(
        "fraud-model: { description: Scores the purchase, sends: FraudFeatures }",
        "fraud-model: { description: Scores the purchase, sends: [FraudFeatures, CardLookup] }",
      ),
    );
    expect(check(m).findings.map((f) => f.message)).toEqual([
      expect.stringContaining('breaks rule "no-card-numbers-to-models"'),
    ]);
  });

  it("healthcare: storing health information outside a HIPAA store breaks a rule", () => {
    const m = load("healthcare", (t) => t.replace("        tags: [hipaa]\n", ""));
    expect(check(m).findings.map((f) => f.message)).toEqual([
      expect.stringContaining('breaks rule "phi-stays-in-hipaa-stores"'),
      expect.stringContaining('breaks rule "phi-stays-in-hipaa-stores"'),
      expect.stringContaining('breaks rule "phi-stays-in-hipaa-stores"'),
    ]);
  });

  it("e-commerce: a second service paying directly breaks a rule", () => {
    const m = load("ecommerce", (t) =>
      t.replace(
        "      shop-db: { description: Decrements stock, sends: StockLevel }\n",
        "      shop-db: { description: Decrements stock, sends: StockLevel }\n      payment-provider: Refunds\n",
      ),
    );
    expect(check(m).findings.map((f) => f.message)).toEqual([
      expect.stringContaining('breaks rule "only-checkout-pays"'),
    ]);
  });
});
