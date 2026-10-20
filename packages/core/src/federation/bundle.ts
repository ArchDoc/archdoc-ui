import { type Bundle, BundleSchema } from "@archdoc/spec";
import { applySchemas, type ImportedSchema } from "../data/schemas.js";
import { buildModel, type ModelSource } from "../load/build.js";
import type { Model } from "../model.js";

export interface BundleMeta {
  version?: string | undefined;
  commit?: string | undefined;
  source?: string | undefined;
  /** Versions of other namespaces the model was built against, from its archdoc.lock. */
  imports?: Record<string, string> | undefined;
  /** Other repos' models to carry along, for a landscape. */
  includes?: Bundle["includes"] | undefined;
  /** What the data entries' schema sources say, read by the caller. */
  schemas?: Bundle["schemas"] | undefined;
}

/**
 * Packs a model's files into a bundle, after checking that they build without
 * errors. Pure: the caller reads the files and writes the result.
 */
export function createBundle(
  sources: readonly ModelSource[],
  root: string,
  meta: BundleMeta = {},
): { bundle?: Bundle; model: Model } {
  const model = buildModel(sources, { root });
  if (model.diagnostics.some((d) => d.severity === "error")) return { model };
  const bundle: Bundle = {
    archdocBundle: 1,
    namespace: model.namespace,
    ...(model.name ? { name: model.name } : {}),
    ...(meta.version ? { version: meta.version } : {}),
    ...(meta.commit ? { commit: meta.commit } : {}),
    ...(meta.source ? { source: meta.source } : {}),
    ...(meta.imports && Object.keys(meta.imports).length ? { imports: meta.imports } : {}),
    root,
    sources: sources.map(({ path, text }) => ({ path, text })),
    ...(meta.schemas?.length ? { schemas: meta.schemas } : {}),
    ...(meta.includes?.length ? { includes: meta.includes } : {}),
  };
  return { bundle, model };
}

/** Bundles are JSON, with a stable layout so their hashes are reproducible. */
export function serializeBundle(bundle: Bundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseBundle(text: string): { bundle: Bundle } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { error: `not JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const result = BundleSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { error: `not a bundle (${issue?.path.join(".") || "root"}: ${issue?.message})` };
  }
  return { bundle: result.data };
}

/** Builds the model inside a bundle. File paths read like payments@5.2.0:model.yaml. */
export function modelFromBundle(bundle: Bundle): Model {
  const prefix = `${bundle.namespace}@${bundle.version ?? bundle.commit?.slice(0, 7) ?? "local"}:`;
  const model = buildModel(
    bundle.sources.map((s) => ({ path: prefix + s.path, text: s.text })),
    { root: prefix + bundle.root },
  );
  // Field types its schema sources gave it, as the repo that published it read them.
  applySchemas(
    model,
    (bundle.schemas ?? []).map((s) => ({ ...s, files: [] })),
  );
  return model;
}

/** Schemas as a bundle carries them: the ones that read, without the files they came from. */
export function bundleSchemas(schemas: readonly ImportedSchema[]): Bundle["schemas"] {
  const out = schemas.flatMap((s) =>
    s.fields && !s.error ? [{ data: s.data, kind: s.kind, ref: s.ref, fields: s.fields }] : [],
  );
  return out.length ? out : undefined;
}
