import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildModel,
  check,
  dataFlows,
  diffModels,
  fieldReferences,
  isSnippet,
  type Model,
  simulate,
  stepMessage,
  subscriptionOf,
} from "../src/index.js";

// The examples: one flat folder of single-file models, each showing a part of
// the platform the others don't, plus variants of the quickstart that show
// what a change looks like to a reviewer.
const dir = new URL("../../../examples/", import.meta.url);
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => f.replace(/\.yaml$/, ""))
  .sort();
const variants = names.filter((n) => n.startsWith("quickstart."));
const models = names.filter((n) => !variants.includes(n));

const load = (name: string, edit: (text: string) => string = (t) => t): Model =>
  buildModel([
    { path: `${name}.yaml`, text: edit(readFileSync(new URL(`${name}.yaml`, dir), "utf8")) },
  ]);
const sample = (journey: string) =>
  JSON.parse(readFileSync(new URL(`${journey}.sample.json`, dir), "utf8")) as Record<
    string,
    unknown
  >;

/** The outcome a sample's decision takes, and the records the journey leaves. */
function run(m: Model, journey: string, s: Record<string, unknown>) {
  const sim = simulate(m, journey, s);
  if (!sim) throw new Error(`no journey ${journey}`);
  const problems = sim.steps.flatMap((x) => x.problems);
  if (problems.length) throw new Error(problems.join("\n"));
  return sim;
}

describe("the examples", () => {
  it("are one flat folder: a model per part of the platform, and the quickstart's variants", () => {
    expect(models).toEqual([
      "big-schema",
      "decisions",
      "event-driven",
      "modular-monolith",
      "quickstart",
      "sensitive-data",
    ]);
    expect(variants).toEqual([
      "quickstart.add-reviews",
      "quickstart.drop-payments",
      "quickstart.pii-to-analytics",
    ]);
  });

  describe.each(models)("%s", (name) => {
    const m = load(name);

    it("is valid, with no warnings, and keeps its own rules", () => {
      expect(m.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
      expect(check(m).findings).toEqual([]);
    });

    it("says what every journey step carries", () => {
      const flows = dataFlows(m);
      const missing = [...m.journeys.values()].flatMap((j) =>
        j.steps.filter((s) => !stepMessage(m, s, flows)).map((s) => `${j.id}#${s.index + 1}`),
      );
      expect(missing).toEqual([]);
    });

    it("models pub-sub as topics, not broker boxes", () => {
      expect([...m.elements.values()].filter((e) => e.spec.kind === "queue")).toEqual([]);
    });
  });
});

describe("each example shows its own part of the platform", () => {
  it("quickstart: the least a useful model needs", () => {
    const m = load("quickstart");
    expect(m.elements.size).toBeLessThanOrEqual(6);
    expect([m.actors.size, m.journeys.size, m.rules.length]).toEqual([1, 1, 1]);
    expect(m.logic.size + m.mappings.size).toBe(0);
  });

  it("modular-monolith: components in one container, pointing at their code and snippets", () => {
    const m = load("modular-monolith");
    const parts = [...m.elements.values()].filter((e) => e.parentId === "bookstore");
    expect(parts.filter((e) => e.spec.kind === "component").map((e) => e.key)).toEqual([
      "storefront",
      "catalog",
      "cart",
      "checkout",
      "notifications",
      "reports",
    ]);
    const snippets = parts.flatMap((e) => e.code.filter(isSnippet));
    expect(snippets.map((c) => c.symbol ?? c.lines)).toEqual([
      "CheckoutsController.create",
      "Catalog::Search.call",
      "Checkout::PlaceOrder.call",
      "1-20",
    ]);
    // Rules keep the parts apart; owners, status, and a suggested dependency are on them.
    expect(m.rules.map((r) => r.id)).toEqual(["pages-hold-no-data", "only-checkout-charges"]);
    expect(parts.map((e) => e.spec.status).filter(Boolean)).toEqual(["planned", "deprecated"]);
    expect(m.relationships.filter((r) => r.provenance?.source === "suggested")).toHaveLength(1);
    // Charging from anywhere but checkout breaks a rule.
    const broken = load("modular-monolith", (t) =>
      t.replace(
        "          cart: { description: Adds to the cart, sends: CartItem }",
        "          cart: { description: Adds to the cart, sends: CartItem }\n          payments: { description: Charges, sends: Payment }",
      ),
    );
    expect(check(broken).findings.map((f) => f.rule)).toEqual(["only-checkout-charges"]);
  });

  it("event-driven: topics on publishers, with their transport, fanning out to subscribers", () => {
    const m = load("event-driven");
    const subs = m.relationships.flatMap((r) => {
      const s = subscriptionOf(m, r);
      return s ? [`${r.from.id} ← ${s.channel} (${s.transport})`] : [];
    });
    expect(subs).toEqual([
      "mdm ← meter-readings (kafka)",
      "billing ← meter-readings (kafka)",
      "outage-board ← outage.detected (eventbridge)",
    ]);
    // A step written from the subscriber's side carries the topic's message the other way.
    const bill = m.journeys.get("monthly-bill")?.steps[0];
    expect(bill && stepMessage(m, bill)).toEqual({
      data: ["MeterReading"],
      how: "carries",
      against: true,
    });
  });

  it("decisions: a decision picks the path, and a held purchase continues as a review", () => {
    const m = load("decisions");
    const s = sample("authorize-purchase");
    const authorize = (over: Record<string, Record<string, unknown>>) =>
      run(m, "authorize-purchase", {
        ...s,
        ...Object.fromEntries(
          Object.entries(over).map(([k, v]) => [k, { ...(s[k] as object), ...v }]),
        ),
      });
    expect(authorize({}).outcomes).toEqual(["approved"]);
    expect(authorize({ Card: { frozen: true } }).outcomes).toEqual(["declined-frozen"]);
    expect(authorize({ Account: { available_cents: 100 } }).outcomes).toEqual(["declined-funds"]);
    const held = authorize({ Score: { risk: 0.95 } });
    expect(held.outcomes).toEqual(["held-for-review"]);
    expect(held.next).toBe("review-held-purchase");
    expect(authorize({}).records["issuer.Authorization"]).toMatchObject({
      id: "auth-tok-ana",
      amount_cents: 4200,
      outcome: "approved",
    });
  });

  it("big-schema: 24 tables in one database, and an order to cash that links its rows", () => {
    const m = load("big-schema");
    expect(Object.keys(m.elements.get("erp-db")?.spec.stores ?? {})).toHaveLength(24);
    expect(fieldReferences(m).length).toBeGreaterThan(30);
    const sim = run(m, "order-to-cash", sample("order-to-cash"));
    expect(sim.outcomes).toEqual(["confirm"]);
    // Every step runs but the one that saves an order on hold.
    expect(sim.steps.filter((s) => !s.ran).map((s) => s.step)).toEqual([4]);
    expect(sim.seed["erp.Customer"]?.map((c) => c.id)).toEqual(["cust-1", "cust-2", "cust-3"]);
    expect(sim.records["erp.Order"]).toMatchObject({ id: "so-1001", status: "paid" });
    const created = sim.steps.flatMap((s) =>
      s.events.filter((e) => e.kind === "created").map((e) => `${e.entry}:${e.record.id}`),
    );
    expect(created).toEqual([
      "erp.Order:so-1001",
      "erp.OrderLine:ol-1",
      "erp.OrderLine:ol-2",
      "erp.Shipment:sh-1",
      "erp.ShipmentLine:sl-1",
      "erp.ShipmentLine:sl-2",
      "erp.Invoice:inv-so-1001",
      "erp.InvoiceLine:il-1",
      "erp.InvoiceLine:il-2",
      "erp.Payment:pay-1001",
      "erp.Allocation:al-1",
    ]);
    // Customers over their limit, or on hold, have their orders held.
    const customers = sample("order-to-cash").Customer as Record<string, unknown>[];
    const as = (i: number) =>
      run(m, "order-to-cash", {
        ...sample("order-to-cash"),
        Customer: [customers[i], ...customers.filter((_, j) => j !== i)],
      }).outcomes;
    expect([as(1), as(2)]).toEqual([["credit-hold"], ["credit-hold"]]);
  });

  it("sensitive-data: classified fields, lifecycles, retention, and where they may go", () => {
    const m = load("sensitive-data");
    const classes = new Set(
      [...m.data.values()].flatMap((d) =>
        Object.values(d.spec.fields ?? {}).flatMap((f) =>
          f.classification ? [f.classification] : [],
        ),
      ),
    );
    expect([...classes].sort()).toEqual(["phi", "pii"]);
    expect([...m.data.values()].filter((d) => d.spec.states).length).toBeGreaterThan(0);
    expect(m.rules.filter((r) => "data" in r).map((r) => r.id)).toEqual([
      "phi-stays-in-hipaa-stores",
      "no-phi-to-reporting",
    ]);
    // Storing health information outside a HIPAA store breaks a rule.
    const broken = load("sensitive-data", (t) => t.replace("        tags: [hipaa]\n", ""));
    expect(new Set(check(broken).findings.map((f) => f.rule))).toEqual(
      new Set(["phi-stays-in-hipaa-stores"]),
    );
  });
});

describe("the quickstart's variants: what a reviewer sees", () => {
  const base = load("quickstart");

  it("add-reviews adds a service, its store, its data, and a journey", () => {
    const head = load("quickstart.add-reviews");
    const d = diffModels(base, head);
    expect(d.elements.map((c) => `${c.kind} ${c.id}`)).toEqual([
      "added shop.reviews",
      "added shop.reviews-db",
    ]);
    expect(d.journeys.map((c) => `${c.kind} ${c.id}`)).toEqual(["added review-a-purchase"]);
    expect(d.data.map((c) => `${c.kind} ${c.id}`)).toEqual(["added Review"]);
    expect(check(head).findings).toEqual([]);
  });

  it("pii-to-analytics sends shoppers' emails to an outside tool, which the shop's rule forbids", () => {
    const head = load("quickstart.pii-to-analytics");
    expect(check(head).findings.map((f) => `${f.code} ${f.rule}`)).toEqual([
      "rule/violation no-personal-data-out",
    ]);
  });

  it("drop-payments removes a relationship the critical journey still walks", () => {
    const head = load("quickstart.drop-payments");
    expect(diffModels(base, head).relationships.map((c) => `${c.kind} ${c.id}`)).toEqual([
      "removed element:shop.orders->element:payments",
    ]);
    expect(head.diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual([
      "journey/broken-step",
    ]);
  });
});
