import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { archdocJsonSchema, TraceFileSchema } from "../src/index.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("TraceFileSchema", () => {
  it("accepts the traces in this repo and the demo org", () => {
    for (const path of [
      "../../../.archdoc/traces/report-false-data-changes.yaml",
      "../../../examples/org/rides/.archdoc/traces/small-refund-waits-for-finance.yaml",
    ]) {
      const result = TraceFileSchema.safeParse(parse(read(path)));
      expect(result.error?.issues ?? []).toEqual([]);
    }
  });

  it("takes journey step syntax, plus what went wrong", () => {
    const result = TraceFileSchema.safeParse({
      trace: "slow-refund",
      title: "Refunds hang",
      symptom: "timeout after 30s",
      expands: "payments.refund#2",
      steps: [
        {
          from: "api",
          to: "payments.charges",
          sends: "RefundRequest",
          code: [{ path: "src/a.ts", lines: "10-20" }, "src/b.ts:3"],
          role: "cause",
          evidence: "reproduced",
          observed: { "Refund.status": null },
          expected: { "Refund.status": "approved" },
          missing: { to: "ledger", call: "post" },
        },
      ],
      "works-in": { element: "web", code: "web/x.ts:4", note: "retries" },
      provenance: { source: "suggested", by: "agent:claude-code" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown roles and evidence, a bad expands, and unknown fields", () => {
    const result = TraceFileSchema.safeParse({
      trace: "t",
      title: "x",
      symptom: "x",
      expands: "book-a-ride",
      steps: [{ from: "a", to: "b", role: "culprit", evidence: "guessed", colour: "red" }],
    });
    expect(result.error?.issues.map((i) => i.path.join("/")).sort()).toEqual([
      "expands",
      "steps/0",
      "steps/0/evidence",
      "steps/0/role",
    ]);
    expect(
      TraceFileSchema.safeParse({ trace: "t", title: "x", symptom: "x", steps: [] }).success,
    ).toBe(false);
  });

  it("is in the JSON Schema, so editors check trace files too", () => {
    const schema = archdocJsonSchema() as { anyOf: { required?: string[] }[] };
    expect(schema.anyOf.some((s) => s.required?.includes("trace"))).toBe(true);
  });
});
