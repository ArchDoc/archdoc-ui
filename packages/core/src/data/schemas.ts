import type { DataFieldSpec } from "@archdoc/spec";
import type { Finding } from "../check/check.js";
import type { Model } from "../model.js";
import { referenceFromSchema } from "./references.js";

/** A field as a schema source declares it. */
export interface ImportedField {
  /** Normalized: int, number, string, bool, uuid, timestamp, date, json, bytes, enum, or a type name. */
  type: string;
  required?: boolean | undefined;
  values?: string[] | undefined;
  /** A foreign key: the type or table it points to, as the source names it, and the column. */
  references?: { name: string; field?: string | undefined } | undefined;
}

/** What a schema importer read for one data entry's `source`. */
export interface ImportedSchema {
  /** The data entry's ID in this model. */
  data: string;
  /** The importer, such as prisma. */
  kind: string;
  /** The source as written, such as prisma/schema.prisma#Charge. */
  ref: string;
  /** Repository files it read. */
  files: string[];
  fields?: Record<string, ImportedField> | undefined;
  /** Why it couldn't be read: the file or the type isn't there, or no importer knows the kind. */
  error?: string | undefined;
}

const ALIASES: Record<string, string> = {
  integer: "int",
  bigint: "int",
  long: "int",
  float: "number",
  double: "number",
  decimal: "number",
  numeric: "number",
  boolean: "bool",
  text: "string",
  datetime: "timestamp",
  "date-time": "timestamp",
  timestamptz: "timestamp",
  object: "json",
  binary: "bytes",
};

/** A type name in the words the model uses, so int and integer compare equal. */
export function normalizeType(type: string): string {
  const t = type.trim();
  const lower = t.toLowerCase();
  return ALIASES[lower] ?? (KNOWN.has(lower) ? lower : t);
}

const KNOWN = new Set([
  "int",
  "number",
  "string",
  "bool",
  "uuid",
  "timestamp",
  "date",
  "json",
  "bytes",
  "enum",
]);

/**
 * Compares data entries with the schemas they come from: a modeled field the
 * schema doesn't have (an error when it's classified, since a rename loses the
 * classification), fields the schema has that the model doesn't, and types or
 * enum values that differ.
 */
export function schemaDrift(model: Model, schemas: readonly ImportedSchema[]): Finding[] {
  const out: Finding[] = [];
  for (const s of schemas) {
    const entry = model.data.get(s.data);
    if (!entry) continue;
    const at = entry.location;
    const files = [...s.files, ...(at ? [at.file] : [])];
    const base = { element: undefined, evidence: [s.ref], files, location: at };
    const label = `${s.data}'s ${s.kind} source ${s.ref}`;
    if (s.error || !s.fields) {
      out.push({
        ...base,
        severity: "error",
        code: "drift/schema-missing",
        message: `${label} can't be read: ${s.error ?? "no fields"}. Fix the source, or remove it.`,
      });
      continue;
    }
    const modeled = Object.entries(entry.spec.fields ?? {});
    const real = s.fields;
    for (const [name, field] of modeled) {
      const theirs = real[name];
      if (!theirs) {
        const classified = field.classification;
        out.push({
          ...base,
          severity: classified ? "error" : "warning",
          code: "drift/schema-field-missing",
          message: `The model has ${s.data}.${name}${classified ? ` (${classified})` : ""}, but ${s.ref} doesn't.${classified ? " If it was renamed, move its classification to the new name." : " Remove it from the model, or fix the source."}`,
        });
        continue;
      }
      const problem = mismatch(field, theirs);
      if (problem) {
        out.push({
          ...base,
          severity: "warning",
          code: "drift/schema-mismatch",
          message: `${s.data}.${name}: ${problem} in ${s.ref}.`,
        });
      }
    }
    // A model that lists fields should list them all, so new ones get classified.
    if (modeled.length) {
      const missing = Object.keys(real).filter((n) => !entry.spec.fields?.[n]);
      if (missing.length) {
        out.push({
          ...base,
          severity: "warning",
          code: "drift/schema-field-unmodeled",
          message: `${s.ref} has ${missing.length === 1 ? "a field" : "fields"} ${s.data} doesn't model: ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"}, and classify any that hold sensitive data.`,
        });
      }
    }
  }
  return out;
}

/** Fills in what a modeled field leaves out (type, values, references) from its schema. */
export function applySchemas(model: Model, schemas: readonly ImportedSchema[]): void {
  for (const s of schemas) {
    const entry = model.data.get(s.data);
    if (!entry || !s.fields) continue;
    for (const [name, field] of Object.entries(entry.spec.fields ?? {})) {
      const theirs = s.fields[name];
      if (!theirs) continue;
      if (field.type === undefined) field.type = theirs.type;
      if (field.values === undefined && theirs.values) field.values = theirs.values;
      if (field.references === undefined && theirs.references) {
        field.references = referenceFromSchema(model, theirs.references);
      }
    }
  }
}

function mismatch(ours: DataFieldSpec, theirs: ImportedField): string | undefined {
  if (ours.type !== undefined) {
    const a = normalizeType(ours.type);
    const b = normalizeType(theirs.type);
    // Only compare types both sides name in the common vocabulary.
    if (KNOWN.has(a) && KNOWN.has(b) && a !== b) return `the model says ${a}, the source says ${b}`;
  }
  if (ours.values && theirs.values) {
    const a = ours.values.map(String);
    const missing = theirs.values.filter((v) => !a.includes(v));
    const extra = a.filter((v) => !theirs.values?.includes(v));
    if (missing.length || extra.length) {
      return [
        missing.length ? `the source allows ${missing.join(", ")}, which the model doesn't` : "",
        extra.length ? `the model allows ${extra.join(", ")}, which the source doesn't` : "",
      ]
        .filter(Boolean)
        .join("; ");
    }
  }
  return undefined;
}

/** Splits a source reference, such as prisma/schema.prisma#Charge, into a path and a name. */
export function parseSourceRef(ref: string): { path: string; name?: string | undefined } {
  const hash = ref.indexOf("#");
  return hash < 0
    ? { path: ref }
    : { path: ref.slice(0, hash), name: ref.slice(hash + 1) || undefined };
}
