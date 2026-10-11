import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArchdocServer } from "../src/index.js";

let dir: string;
let client: Client;

const model = `
archdoc: "2.0"
namespace: payments
actors:
  clerk: { kind: role, uses: { charges: Refunds } }
elements:
  charges: { kind: container, uses: { ledger: Posts } }
  ledger:
    kind: datastore
    stores: { refunds: { entity: Refund } }
data:
  RefundRequest:
    kind: message
    fields:
      amount_cents: { type: int }
      email: { type: string, classification: pii }
  Charge: { kind: entity, fields: { amount_cents: { type: int } } }
  Refund: { kind: entity, fields: { amount_cents: { type: int } } }
logic:
  approval:
    input: { request: RefundRequest, charge: Charge }
    rules:
      - when: "request.amount_cents <= charge.amount_cents / 2"
        then: auto
      - else: manual
mappings:
  to-refund:
    from: { request: RefundRequest }
    to: ledger.refunds
    fields: { amount_cents: request.amount_cents }
journeys:
  refund:
    actor: clerk
    goal: Refund
    steps:
      - { from: clerk, to: charges, sends: RefundRequest, decides: approval }
      - { from: charges, to: ledger, via: to-refund, when: auto }
`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "archdoc-mcp-data-"));
  await writeFile(join(dir, "archdoc.yaml"), model);
  const server = createArchdocServer({ cwd: dir, model: "archdoc.yaml" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text: string }[];
  return { text: content[0]?.text ?? "", isError: r.isError === true };
}

describe("data tools", () => {
  it("list data entries with their classified fields, and show one", async () => {
    expect((await call("archdoc_data")).text).toBe(
      "RefundRequest (message) · email: pii\nCharge (entity)\nRefund (entity)",
    );
    const r = await call("archdoc_data", { id: "Refund" });
    expect(r.text).toContain("Stored in: ledger (refunds)");
    expect((await call("archdoc_data", { id: "Nope" })).isError).toBe(true);
  });

  it("follow a field's lineage", async () => {
    const r = await call("archdoc_lineage", { field: "RefundRequest.amount_cents" });
    expect(r.text).toContain(
      "payments.Refund.amount_cents = request.amount_cents  (payments.to-refund, copied) · written to payments.ledger (refunds)",
    );
  });

  it("simulate a journey for a sample request", async () => {
    const r = await call("archdoc_simulate", {
      journey: "refund",
      sample: { RefundRequest: { amount_cents: 300 }, Charge: { amount_cents: 1000 } },
    });
    expect(r.text).toContain("decides payments.approval → auto (rule 1:");
    expect(r.text).toContain(
      "+ creates payments.Refund { amount_cents: 300 } via payments.to-refund",
    );
    const manual = await call("archdoc_simulate", {
      journey: "refund",
      sample: { RefundRequest: { amount_cents: 900 }, Charge: { amount_cents: 1000 } },
    });
    expect(manual.text).toContain("skipped: runs only when auto; the decision was manual");
  });
});
