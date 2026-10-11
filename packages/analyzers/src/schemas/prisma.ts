import type { ImportedField, SchemaImporter } from "./api.js";
import { block, readSource, stripComments } from "./api.js";

const SCALARS: Record<string, string> = {
  Int: "int",
  BigInt: "int",
  Float: "number",
  Decimal: "number",
  String: "string",
  Boolean: "bool",
  DateTime: "timestamp",
  Json: "json",
  Bytes: "bytes",
};

/**
 * Prisma schemas: `prisma: prisma/schema.prisma#Charge` reads model Charge
 * (or the model mapped to the table charges). Relation fields aren't columns,
 * so they're left out; enums bring their values.
 */
export const prisma: SchemaImporter = {
  kind: "prisma",
  async read(ctx, ref) {
    if (!ref.name) throw new Error("name the model, such as prisma/schema.prisma#Charge");
    const text = stripComments(await readSource(ctx, ref.path));
    const blocks = new Map<string, { kind: string; body: string }>();
    for (const m of text.matchAll(/\b(model|enum|view|type)\s+(\w+)\s*\{/g)) {
      const name = m[2] as string;
      blocks.set(name, {
        kind: m[1] as string,
        body: block(text, (m.index ?? 0) + m[0].length - 1).body,
      });
    }
    const target =
      blocks.get(ref.name) ??
      [...blocks.values()].find((b) => new RegExp(`@@map\\(\\s*"${ref.name}"\\s*\\)`).test(b.body));
    if (!target || target.kind === "enum") throw new Error(`${ref.path} has no model ${ref.name}`);

    const fields: Record<string, ImportedField> = {};
    for (const line of target.body.split("\n")) {
      const m = /^\s*(\w+)\s+([\w.]+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!m || line.trim().startsWith("@@")) continue;
      const [, name, type, list, optional, attrs = ""] = m as unknown as string[];
      if (!name || !type) continue;
      const other = blocks.get(type);
      if (other && other.kind !== "enum") continue; // a relation
      let field: ImportedField;
      if (other?.kind === "enum") {
        field = { type: "enum", values: enumValues(other.body) };
      } else {
        const uuid = /@db\.Uuid|@default\(\s*uuid\(\)\s*\)|gen_random_uuid/.test(attrs);
        field = { type: uuid ? "uuid" : (SCALARS[type] ?? type) };
      }
      if (list) field.type = `${field.type}[]`;
      field.required = !optional && !list;
      fields[name] = field;
    }
    return { fields, files: [ref.path] };
  },
};

function enumValues(body: string): string[] {
  return body
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0] ?? "")
    .filter((v) => v && !v.startsWith("@"));
}
