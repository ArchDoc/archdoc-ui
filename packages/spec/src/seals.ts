import { z } from "zod";

/** Where seals live, beside archdoc.lock in the model directory. Written by `archdoc seal`. */
export const SUM_FILE = "archdoc.sum";

/**
 * How a fact's code is fingerprinted. structure: the files it owns and what
 * they export, so editing a function body doesn't break it but a new file or a
 * renamed export does. content: the exact lines, for snippets, decisions,
 * mappings, and contracts. schema: the fields a data entry's schema source
 * declares.
 */
export const SealKindSchema = z.enum(["structure", "content", "schema"]);

export const SealSchema = z.strictObject({
  kind: SealKindSchema,
  /** A fingerprint of what the fact points at, such as fnv-6c1f0e2a9b3d4c5e. */
  hash: z.string(),
  /** What the code was when sealed, to say what changed. */
  files: z
    .record(z.string(), z.array(z.string()))
    .optional()
    .describe("structure: each file the fact owns, with the names it exports"),
  refs: z
    .record(z.string(), z.strictObject({ hash: z.string(), lines: z.number().int() }))
    .optional()
    .describe("content: each code reference, with its own fingerprint and how many lines it had"),
  fields: z.record(z.string(), z.string()).optional().describe("schema: each field, with its type"),
  by: z
    .string()
    .optional()
    .describe(
      "Who last checked that the model still describes this code, such as agent:claude-code",
    ),
});

/** `.archdoc/archdoc.sum`: a seal per model fact that points at code. */
export const SumFileSchema = z.strictObject({
  sealVersion: z.literal(1),
  seals: z.record(z.string(), SealSchema),
});

export type SealKind = z.infer<typeof SealKindSchema>;
export type Seal = z.infer<typeof SealSchema>;
export type SumFile = z.infer<typeof SumFileSchema>;
