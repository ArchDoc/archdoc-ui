import { applySchemas, buildModel, check } from "@archdoc/core";
import { describe, expect, it } from "vitest";
import {
  type AnalyzerContext,
  importSchemas,
  jsonschema,
  openapi,
  prisma,
  proto,
  sql,
} from "../src/index.js";

const ctx = (files: Record<string, string>): AnalyzerContext => ({
  baseDir: "/repo",
  files: Object.keys(files),
  read: async (p) => files[p] ?? "",
});

describe("prisma", () => {
  const schema = `
    // Payments
    model Charge {
      id         String   @id @default(uuid()) @db.Uuid
      tripId     String   @map("trip_id")
      amount     Int
      cardLast4  String?
      status     ChargeStatus
      tags       String[]
      refunds    Refund[]
      createdAt  DateTime @default(now())
      @@map("charges")
    }
    model Refund {
      id     String @id
      charge Charge @relation(fields: [chargeId], references: [id])
      chargeId String
    }
    enum ChargeStatus {
      authorized
      captured
      refunded
    }
  `;
  const files = ctx({ "prisma/schema.prisma": schema });

  it("reads a model's columns, with enums and without relations", async () => {
    const t = await prisma.read(files, { path: "prisma/schema.prisma", name: "Charge" });
    expect(t.fields).toEqual({
      id: { type: "uuid", required: true },
      tripId: { type: "string", required: true },
      amount: { type: "int", required: true },
      cardLast4: { type: "string", required: false },
      status: { type: "enum", values: ["authorized", "captured", "refunded"], required: true },
      tags: { type: "string[]", required: false },
      createdAt: { type: "timestamp", required: true },
    });
  });

  it("reads the foreign keys a relation names", async () => {
    const t = await prisma.read(files, { path: "prisma/schema.prisma", name: "Refund" });
    expect(t.fields).toEqual({
      id: { type: "string", required: true },
      chargeId: { type: "string", required: true, references: { name: "Charge", field: "id" } },
    });
  });

  it("finds a model by the table it maps to, and explains what's missing", async () => {
    const t = await prisma.read(files, { path: "prisma/schema.prisma", name: "charges" });
    expect(Object.keys(t.fields)).toContain("cardLast4");
    await expect(
      prisma.read(files, { path: "prisma/schema.prisma", name: "Nope" }),
    ).rejects.toThrow("prisma/schema.prisma has no model Nope");
    await expect(prisma.read(files, { path: "nope.prisma", name: "X" })).rejects.toThrow(
      "nope.prisma isn't in the repository",
    );
  });
});

describe("sql migrations", () => {
  const files = ctx({
    "db/migrations/001_init.sql": `
      CREATE TYPE charge_status AS ENUM ('authorized', 'captured');
      CREATE TABLE public.charges (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        amount_cents integer NOT NULL,
        card_last4 varchar(4),
        status charge_status NOT NULL,
        note text, -- a comment
        price numeric(10, 2),
        CONSTRAINT positive CHECK (amount_cents > 0)
      );
      CREATE TABLE old_table (x int);
    `,
    "db/migrations/002_more.sql": `
      ALTER TABLE charges ADD COLUMN captured_at timestamptz, DROP COLUMN note;
      ALTER TABLE charges RENAME COLUMN card_last4 TO last4;
      ALTER TABLE charges ALTER COLUMN price TYPE bigint;
      DROP TABLE old_table;
    `,
    "db/migrations/010_rename.sql": "ALTER TABLE charges RENAME TO payments_charges;",
  });

  it("replays migrations in order and reads the table as they leave it", async () => {
    const t = await sql.read(files, { path: "db/migrations", name: "payments_charges" });
    expect(t.fields).toEqual({
      id: { type: "uuid", required: true },
      amount_cents: { type: "int", required: true },
      last4: { type: "string" },
      status: { type: "enum", values: ["authorized", "captured"], required: true },
      price: { type: "int" },
      captured_at: { type: "timestamp" },
    });
    expect(t.files).toEqual([
      "db/migrations/001_init.sql",
      "db/migrations/002_more.sql",
      "db/migrations/010_rename.sql",
    ]);
    await expect(sql.read(files, { path: "db/migrations", name: "old_table" })).rejects.toThrow(
      "no migration under db/migrations leaves a table old_table",
    );
  });
});

describe("sql foreign keys", () => {
  const files = ctx({
    "migrations/001.sql": `
      CREATE TABLE charges (id uuid PRIMARY KEY);
      CREATE TABLE refunds (
        id uuid PRIMARY KEY,
        charge_id uuid NOT NULL REFERENCES charges(id),
        trip_id uuid REFERENCES trips,
        account text,
        CONSTRAINT refunds_account FOREIGN KEY (account) REFERENCES public.accounts (code)
      );
    `,
    "migrations/002.sql": `
      ALTER TABLE refunds ADD COLUMN ledger_id uuid,
        ADD CONSTRAINT refunds_ledger FOREIGN KEY (ledger_id) REFERENCES ledger_entries(id);
    `,
  });

  it("reads inline references, table constraints, and ones added later", async () => {
    const t = await sql.read(files, { path: "migrations", name: "refunds" });
    expect(t.fields).toEqual({
      id: { type: "uuid", required: true },
      charge_id: { type: "uuid", required: true, references: { name: "charges", field: "id" } },
      trip_id: { type: "uuid", references: { name: "trips", field: undefined } },
      account: { type: "string", references: { name: "accounts", field: "code" } },
      ledger_id: { type: "uuid", references: { name: "ledger_entries", field: "id" } },
    });
  });
});

describe("openapi and json schema", () => {
  const files = ctx({
    "openapi/trips.yaml": `
openapi: 3.1.0
components:
  schemas:
    Base:
      type: object
      required: [id]
      properties:
        id: { type: string, format: uuid }
    Trip:
      allOf:
        - $ref: "#/components/schemas/Base"
        - type: object
          required: [fare_cents]
          properties:
            fare_cents: { type: integer }
            status: { $ref: "#/components/schemas/Status" }
            stops: { type: array, items: { $ref: "#/components/schemas/Stop" } }
            ended_at: { type: [string, "null"], format: date-time }
    Status: { type: string, enum: [requested, completed] }
    Stop: { type: object, properties: { lat: { type: number } } }
`,
    "schemas/rider.json": JSON.stringify({
      type: "object",
      required: ["email"],
      properties: { email: { type: "string" }, vip: { type: "boolean" } },
      $defs: { Address: { properties: { city: { type: "string" } } } },
    }),
  });

  it("read components, following $ref and allOf", async () => {
    const t = await openapi.read(files, { path: "openapi/trips.yaml", name: "Trip" });
    expect(t.fields).toEqual({
      id: { type: "uuid", required: true },
      fare_cents: { type: "int", required: true },
      status: { type: "enum", values: ["requested", "completed"], required: false },
      stops: { type: "Stop[]", required: false },
      ended_at: { type: "timestamp", required: false },
    });
  });

  it("read a JSON Schema's root, a $def, or a pointer", async () => {
    const root = await jsonschema.read(files, { path: "schemas/rider.json" });
    expect(root.fields).toEqual({
      email: { type: "string", required: true },
      vip: { type: "bool", required: false },
    });
    const def = await jsonschema.read(files, { path: "schemas/rider.json", name: "Address" });
    expect(Object.keys(def.fields)).toEqual(["city"]);
    const ptr = await jsonschema.read(files, {
      path: "schemas/rider.json",
      name: "/$defs/Address",
    });
    expect(Object.keys(ptr.fields)).toEqual(["city"]);
  });
});

describe("protobuf", () => {
  const files = ctx({
    "proto/charges.proto": `
      syntax = "proto3";
      import "google/protobuf/timestamp.proto";
      enum Reason {
        REASON_UNSPECIFIED = 0;
        REASON_OVERCHARGE = 1;
        REASON_NO_SHOW = 2;
      }
      message RefundRequest {
        string trip_id = 1; // the trip
        int64 amount_cents = 2;
        Reason reason = 3;
        repeated string notes = 4;
        map<string, string> labels = 5;
        google.protobuf.Timestamp requested_at = 6;
        message Meta { string source = 1; }
        Meta meta = 7;
        oneof contact {
          string email = 8;
          string phone = 9;
        }
      }
    `,
  });

  it("reads a message's fields, with enums the way models write them", async () => {
    const t = await proto.read(files, { path: "proto/charges.proto", name: "RefundRequest" });
    expect(t.fields).toEqual({
      trip_id: { type: "string", required: false },
      amount_cents: { type: "int", required: false },
      reason: { type: "enum", values: ["overcharge", "no_show"], required: false },
      notes: { type: "string[]", required: false },
      labels: { type: "json", required: false },
      requested_at: { type: "timestamp", required: false },
      meta: { type: "Meta", required: false },
      email: { type: "string", required: false },
      phone: { type: "string", required: false },
    });
    const meta = await proto.read(files, {
      path: "proto/charges.proto",
      name: "RefundRequest.Meta",
    });
    expect(Object.keys(meta.fields)).toEqual(["source"]);
  });
});

describe("schema drift", () => {
  const model = buildModel([
    {
      path: "archdoc.yaml",
      text: `
archdoc: "2.0"
namespace: payments
elements:
  ledger:
    kind: datastore
    stores: { charges: { entity: Charge } }
data:
  Charge:
    kind: entity
    source: { sql: db/migrations#charges }
    fields:
      id: {}
      amount_cents: { type: string }
      card_last4: { classification: pci }
      status: { values: [authorized, captured, refunded] }
  Gone:
    kind: entity
    source: { prisma: prisma/schema.prisma#Gone, avro: x.avsc }
`,
    },
  ]);
  const files = ctx({
    "db/migrations/001.sql": `
      CREATE TYPE s AS ENUM ('authorized', 'captured');
      CREATE TABLE charges (id uuid, amount_cents int, last4 text, status s, created_at timestamp);
    `,
  });

  it("reports renamed classified fields, unmodeled fields, mismatches, and unreadable sources", async () => {
    expect(model.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    const schemas = await importSchemas(files, model);
    const findings = check(model, { schemas }).findings.filter((f) =>
      f.code.startsWith("drift/schema"),
    );
    expect(findings.map((f) => `${f.severity} ${f.code}: ${f.message}`)).toEqual([
      "error drift/schema-field-missing: The model has Charge.card_last4 (pci), but db/migrations#charges doesn't. If it was renamed, move its classification to the new name.",
      "error drift/schema-missing: Gone's prisma source prisma/schema.prisma#Gone can't be read: prisma/schema.prisma isn't in the repository. Fix the source, or remove it.",
      "error drift/schema-missing: Gone's avro source x.avsc can't be read: no importer reads \"avro\" (known: sql, prisma, openapi, jsonschema, proto). Fix the source, or remove it.",
      "warning drift/schema-field-unmodeled: db/migrations#charges has fields Charge doesn't model: last4, created_at. Add them, and classify any that hold sensitive data.",
      "warning drift/schema-mismatch: Charge.amount_cents: the model says string, the source says int in db/migrations#charges.",
      "warning drift/schema-mismatch: Charge.status: the model allows refunded, which the source doesn't in db/migrations#charges.",
    ]);
    expect(findings[0]?.files).toEqual(["db/migrations/001.sql", "archdoc.yaml"]);
  });
});

describe("references from schemas", () => {
  it("point a field at the entry its source or a datastore table names", async () => {
    const model = buildModel([
      {
        path: "archdoc.yaml",
        text: `
archdoc: "2.0"
namespace: payments
elements:
  ledger:
    kind: datastore
    stores: { charges: { entity: Charge, key: id }, refunds: { entity: Refund, key: id } }
data:
  Charge: { kind: entity, source: { prisma: prisma/schema.prisma#Charge }, fields: { id: {} } }
  Refund:
    kind: entity
    source: { prisma: prisma/schema.prisma#Refund }
    fields: { id: {}, chargeId: {} }
  Line:
    kind: entity
    source: { sql: migrations#lines }
    fields: { id: {}, refund_id: {}, note: { references: Refund.id } }
`,
      },
    ]);
    const files = ctx({
      "prisma/schema.prisma": `
        model Charge { id String @id }
        model Refund {
          id String @id
          chargeId String
          charge Charge @relation(fields: [chargeId], references: [id])
        }`,
      "migrations/001.sql":
        "CREATE TABLE lines (id uuid, refund_id uuid REFERENCES refunds(id), note text REFERENCES charges(id));",
    });
    applySchemas(model, await importSchemas(files, model));
    const fields = (id: string) => model.data.get(id)?.spec.fields;
    expect(fields("Refund")?.chargeId?.references).toBe("Charge.id");
    // By the datastore's table name; a reference the model writes stays.
    expect(fields("Line")?.refund_id?.references).toBe("Refund.id");
    expect(fields("Line")?.note?.references).toBe("Refund.id");
  });
});
