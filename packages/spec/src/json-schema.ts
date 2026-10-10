import { z } from "zod";
import { JourneyFileSchema, ModelFileSchema } from "./schema.js";

export const JSON_SCHEMA_ID = "https://archdoc.github.io/schema/archdoc.v2.schema.json";

/**
 * The JSON Schema for v2 model files, for editors (yaml-language-server) and
 * non-TypeScript tooling. Generated from the Zod schema, so it never drifts.
 */
export function archdocJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(z.union([ModelFileSchema, JourneyFileSchema]), {
    unrepresentable: "any",
  });
  return {
    $schema: schema.$schema,
    $id: JSON_SCHEMA_ID,
    title: "ArchDoc model file (spec v2)",
    ...Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "$schema")),
  };
}
