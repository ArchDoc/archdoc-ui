import { z } from "zod";
import { type ImportSpec, NamespaceSchema } from "./schema.js";

/**
 * A published model: one repo's model files at one version, with what it was
 * built against. Written by `archdoc publish` and `archdoc sync`, read by any
 * repo that imports the namespace. JSON, so tools that don't use ArchDoc can
 * read it too.
 */
export const BundleSchema = z.strictObject({
  archdocBundle: z.literal(1).describe("Bundle format version"),
  namespace: NamespaceSchema,
  name: z.string().optional(),
  version: z.string().optional().describe("Semver of the release, such as 5.2.0"),
  commit: z.string().optional().describe("Commit the bundle was built from"),
  source: z.string().optional().describe("Where it came from, such as github:acme/payments"),
  imports: z
    .record(NamespaceSchema, z.string())
    .optional()
    .describe("Versions of other namespaces the model was built against, from its archdoc.lock"),
  root: z.string().describe("Path of the root model file among sources"),
  sources: z
    .array(z.strictObject({ path: z.string(), text: z.string() }))
    .min(1)
    .describe("The model files, as written"),
});

export const LockEntrySchema = z.strictObject({
  source: z
    .string()
    .describe("The import, such as github:acme/payments or file:stubs/zendesk.yaml"),
  requested: z.string().optional().describe("The version range in imports"),
  version: z.string().optional().describe("The version it resolved to"),
  ref: z.string().optional().describe("The tag it was read from"),
  commit: z.string().optional(),
  bundle: z.string().describe("The vendored bundle, relative to the lockfile"),
  integrity: z.string().describe("sha256 of the bundle file, as sha256-<base64>"),
});

/** `.archdoc/archdoc.lock`: what each import resolved to. Written by `archdoc sync`. */
export const LockSchema = z.strictObject({
  lockfileVersion: z.literal(1),
  imports: z.record(NamespaceSchema, LockEntrySchema),
});

export type Bundle = z.infer<typeof BundleSchema>;
export type LockEntry = z.infer<typeof LockEntrySchema>;
export type Lock = z.infer<typeof LockSchema>;

export const LOCK_FILE = "archdoc.lock";
export const VENDOR_DIR = "vendor";

/** How an import is written in the lock, such as github:acme/payments. */
export function importSource(spec: ImportSpec): string {
  if ("github" in spec) return `github:${spec.github}${spec.path ? `#${spec.path}` : ""}`;
  if ("git" in spec) return `git:${spec.git}${spec.path ? `#${spec.path}` : ""}`;
  if ("url" in spec) return `url:${spec.url}`;
  return `file:${spec.file}`;
}

/** The version range an import asks for, if any. */
export function importRange(spec: ImportSpec): string | undefined {
  return "version" in spec ? spec.version : undefined;
}
