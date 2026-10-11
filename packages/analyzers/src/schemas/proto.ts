import type { ImportedField, SchemaImporter } from "./api.js";
import { block, readSource, stripComments } from "./api.js";

const SCALARS: Record<string, string> = {
  double: "number",
  float: "number",
  string: "string",
  bool: "bool",
  bytes: "bytes",
  "google.protobuf.Timestamp": "timestamp",
  "google.protobuf.Struct": "json",
};

/**
 * Protocol Buffers: `proto: proto/charges.proto#RefundRequest` reads message
 * RefundRequest (Outer.Inner for a nested one), including oneof fields. Enum
 * values are read the way models usually write them: REASON_NO_SHOW in enum
 * Reason is no_show, and the *_UNSPECIFIED zero value is left out.
 */
export const proto: SchemaImporter = {
  kind: "proto",
  async read(ctx, ref) {
    if (!ref.name) throw new Error("name the message, such as proto/charges.proto#RefundRequest");
    const text = stripComments(await readSource(ctx, ref.path));
    const enums = new Map<string, string[]>();
    for (const m of text.matchAll(/\benum\s+(\w+)\s*\{/g)) {
      const body = block(text, (m.index ?? 0) + m[0].length - 1).body;
      enums.set(m[1] as string, enumValues(m[1] as string, body));
    }
    let body = text;
    for (const part of ref.name.split(".")) {
      const found = findBlock(body, "message", part);
      if (found === undefined) throw new Error(`${ref.path} has no message ${ref.name}`);
      body = found;
    }
    const fields: Record<string, ImportedField> = {};
    for (const m of ownLevel(body).matchAll(
      /(?:^|;|\{|\})\s*(repeated|optional|required)?\s*(map\s*<[^>]+>|[\w.]+)\s+(\w+)\s*=\s*\d+/g,
    )) {
      const [, label, type = "", name = ""] = m;
      let field: ImportedField;
      if (type.startsWith("map")) field = { type: "json" };
      else if (/^(s?fixed|u?int|sint)(32|64)$/.test(type)) field = { type: "int" };
      else if (SCALARS[type]) field = { type: SCALARS[type] };
      else {
        const values = enums.get(type.split(".").pop() ?? type);
        field = values ? { type: "enum", values } : { type: type.split(".").pop() ?? type };
      }
      if (label === "repeated") field.type = `${field.type}[]`;
      field.required = label === "required";
      fields[name] = field;
    }
    return { fields, files: [ref.path] };
  },
};

/** The body of `message Name { ... }` at this level of nesting. */
function findBlock(text: string, keyword: string, name: string): string | undefined {
  const re = new RegExp(`\\b${keyword}\\s+${name}\\s*\\{`, "g");
  for (const m of text.matchAll(re)) {
    return block(text, (m.index ?? 0) + m[0].length - 1).body;
  }
  return undefined;
}

/** A message body without its nested messages and enums (oneof stays, its fields belong here). */
function ownLevel(body: string): string {
  let out = body;
  for (;;) {
    const m = /\b(message|enum)\s+\w+\s*\{/.exec(out);
    if (!m) return out;
    const { end } = block(out, m.index + m[0].length - 1);
    out = out.slice(0, m.index) + out.slice(end + 1);
  }
}

function enumValues(name: string, body: string): string[] {
  const prefix = `${name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_`;
  return [...body.matchAll(/(\w+)\s*=\s*\d+/g)]
    .map((m) => m[1] as string)
    .filter((v) => !/_UNSPECIFIED$/.test(v) && v !== "option")
    .map((v) => (v.startsWith(prefix) ? v.slice(prefix.length) : v).toLowerCase());
}
