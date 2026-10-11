import { parse } from "yaml";
import type { ImportedField, SchemaImporter } from "./api.js";
import { readSource } from "./api.js";

type Schema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  allOf?: Schema[];
};

/**
 * OpenAPI documents: `openapi: openapi/trips.yaml#Trip` reads
 * components.schemas.Trip (or definitions.Trip, for Swagger 2).
 */
export const openapi: SchemaImporter = {
  kind: "openapi",
  async read(ctx, ref) {
    if (!ref.name) throw new Error("name the schema, such as openapi/trips.yaml#Trip");
    const doc = await load(ctx, ref.path);
    const schema = doc.components?.schemas?.[ref.name] ?? doc.definitions?.[ref.name];
    if (!schema) throw new Error(`${ref.path} has no schema ${ref.name} under components.schemas`);
    return { fields: fieldsOf(doc, schema), files: [ref.path] };
  },
};

/**
 * JSON Schema files: `jsonschema: schemas/trip.json` reads the root schema;
 * `#Trip` reads $defs.Trip (or definitions.Trip); `#/a/b` is a JSON pointer.
 */
export const jsonschema: SchemaImporter = {
  kind: "jsonschema",
  async read(ctx, ref) {
    const doc = await load(ctx, ref.path);
    const schema = !ref.name
      ? (doc as Schema)
      : ref.name.startsWith("/")
        ? pointer(doc, ref.name)
        : (doc.$defs?.[ref.name] ?? doc.definitions?.[ref.name]);
    if (!schema) throw new Error(`${ref.path} has no schema ${ref.name}`);
    return { fields: fieldsOf(doc, schema), files: [ref.path] };
  },
};

type Doc = {
  components?: { schemas?: Record<string, Schema> };
  definitions?: Record<string, Schema>;
  $defs?: Record<string, Schema>;
};

async function load(ctx: Parameters<SchemaImporter["read"]>[0], path: string): Promise<Doc> {
  const text = await readSource(ctx, path);
  try {
    return (parse(text) ?? {}) as Doc;
  } catch (err) {
    throw new Error(
      `${path} isn't valid YAML or JSON (${err instanceof Error ? err.message.split("\n")[0] : err})`,
    );
  }
}

function pointer(doc: unknown, path: string): Schema | undefined {
  let cur: unknown = doc;
  for (const part of path.split("/").slice(1)) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined;
  }
  return cur as Schema | undefined;
}

/** Follows local $refs, and merges allOf. */
function resolve(doc: Doc, s: Schema, seen = new Set<string>()): Schema {
  if (s.$ref?.startsWith("#") && !seen.has(s.$ref)) {
    seen.add(s.$ref);
    const target = pointer(doc, s.$ref.slice(1));
    return target ? resolve(doc, target, seen) : s;
  }
  if (s.allOf) {
    const parts = s.allOf.map((p) => resolve(doc, p, seen));
    return {
      ...s,
      properties: Object.assign({}, ...parts.map((p) => p.properties ?? {}), s.properties ?? {}),
      required: [...parts.flatMap((p) => p.required ?? []), ...(s.required ?? [])],
    };
  }
  return s;
}

function fieldsOf(doc: Doc, schema: Schema): Record<string, ImportedField> {
  const s = resolve(doc, schema);
  const required = new Set(s.required ?? []);
  return Object.fromEntries(
    Object.entries(s.properties ?? {}).map(([name, p]) => [
      name,
      { ...typeOf(doc, p), required: required.has(name) },
    ]),
  );
}

function typeOf(doc: Doc, p: Schema): ImportedField {
  const named = p.$ref?.split("/").pop();
  const s = resolve(doc, p);
  if (s.enum) return { type: "enum", values: s.enum.map(String) };
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  if (type === "array") {
    const item = s.items ? typeOf(doc, s.items) : { type: "json" };
    return { type: `${item.type}[]` };
  }
  if (named && (type === "object" || s.properties)) return { type: named };
  if (type === "string") {
    const format = {
      uuid: "uuid",
      "date-time": "timestamp",
      date: "date",
      byte: "bytes",
      binary: "bytes",
    }[s.format ?? ""];
    return { type: format ?? "string" };
  }
  if (type === "integer") return { type: "int" };
  if (type === "number") return { type: "number" };
  if (type === "boolean") return { type: "bool" };
  return { type: "json" };
}
