import { describe, expect, it } from "vitest";
import { bundleSchemas, createBundle, modelFromBundle, parseBundle } from "../src/index.js";

// A repo that imports another can't read its schema files, so the bundle
// carries what they said, and field types survive the trip.
describe("schemas in bundles", () => {
  const source = {
    path: "archdoc.yaml",
    text: [
      'archdoc: "2.0"',
      "namespace: payments",
      "data:",
      "  RefundRequest:",
      "    kind: message",
      "    source: { proto: proto/charges.proto#RefundRequest }",
      "    fields:",
      "      amount_cents: {}",
      "      rider_email: { classification: pii }",
    ].join("\n"),
  };

  it("carries the schema fields and applies them to the imported model", () => {
    const schemas = bundleSchemas([
      {
        data: "RefundRequest",
        kind: "proto",
        ref: "proto/charges.proto#RefundRequest",
        files: ["proto/charges.proto"],
        fields: { amount_cents: { type: "int" }, rider_email: { type: "string" } },
      },
      { data: "Broken", kind: "proto", ref: "x.proto#Broken", files: [], error: "not found" },
    ]);
    expect(schemas).toHaveLength(1);
    const { bundle } = createBundle([source], "archdoc.yaml", { version: "1.0.0", schemas });
    const parsed = parseBundle(JSON.stringify(bundle));
    if ("error" in parsed) throw new Error(parsed.error);
    const fields = modelFromBundle(parsed.bundle).data.get("RefundRequest")?.spec.fields ?? {};
    expect(fields.amount_cents?.type).toBe("int");
    expect(fields.rider_email).toMatchObject({ type: "string", classification: "pii" });
  });

  it("leaves bundles without schemas as they were", () => {
    const { bundle } = createBundle([source], "archdoc.yaml");
    expect(bundle && "schemas" in bundle).toBe(false);
  });
});
