import { type ImportedSchema, type Model, parseSourceRef } from "@archdoc/core";
import type { AnalyzerContext } from "../api.js";
import type { SchemaImporter } from "./api.js";
import { jsonschema, openapi } from "./openapi.js";
import { prisma } from "./prisma.js";
import { proto } from "./proto.js";
import { sql } from "./sql.js";

export const builtinImporters: SchemaImporter[] = [sql, prisma, openapi, jsonschema, proto];

/** Reads every data entry's `source` with the importer for its kind. */
export async function importSchemas(
  ctx: AnalyzerContext,
  model: Model,
  importers: SchemaImporter[] = builtinImporters,
): Promise<ImportedSchema[]> {
  const byKind = new Map(importers.map((i) => [i.kind, i]));
  const out: ImportedSchema[] = [];
  for (const d of model.data.values()) {
    for (const [kind, ref] of Object.entries(d.spec.source ?? {})) {
      const importer = byKind.get(kind);
      const parsed = parseSourceRef(ref);
      if (!importer) {
        out.push({
          data: d.id,
          kind,
          ref,
          files: [],
          error: `no importer reads "${kind}" (known: ${[...byKind.keys()].join(", ")})`,
        });
        continue;
      }
      try {
        const t = await importer.read(ctx, parsed);
        out.push({ data: d.id, kind, ref, files: t.files, fields: t.fields });
      } catch (err) {
        out.push({
          data: d.id,
          kind,
          ref,
          files: ctx.files.includes(parsed.path) ? [parsed.path] : [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return out;
}

export type { ImportedType, SchemaImporter } from "./api.js";
export { jsonschema, openapi } from "./openapi.js";
export { prisma } from "./prisma.js";
export { proto } from "./proto.js";
export { sql } from "./sql.js";
