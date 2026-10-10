import { importRange, importSource, type Lock } from "@archdoc/spec";
import type { Diagnostic, SourceLocation } from "../diagnostics.js";
import { contractDiagnostic } from "../load/build.js";
import type {
  ActorNode,
  ElementNode,
  ExternalRef,
  ImportedModel,
  Model,
  NodeRef,
  Target,
} from "../model.js";
import { nodeKey } from "../model.js";
import { modelFromBundle, parseBundle } from "./bundle.js";

/** A vendored bundle as the loader found it on disk. */
export interface VendoredBundle {
  /** Display path, for diagnostics. */
  path: string;
  /** Undefined when the file is missing. */
  text?: string | undefined;
  /** sha256 of the file as found, as sha256-<base64>. */
  integrity?: string | undefined;
}

export interface FederationInput {
  /** Display path of archdoc.lock, for diagnostics. */
  lockPath: string;
  /** Undefined when there's no lockfile. */
  lock?: Lock | undefined;
  /** Why the lockfile couldn't be read, if it couldn't. */
  lockError?: string | undefined;
  /** Each locked namespace's vendored bundle. */
  bundles: ReadonlyMap<string, VendoredBundle>;
}

/**
 * Connects a model to the other repos it imports: loads their vendored
 * bundles into `model.imported`, checks the lockfile against `imports`, and
 * checks every reference into another repo against that repo's model at the
 * pinned version. Adds diagnostics to the model. Pure: the loader reads the
 * files.
 */
export function federate(model: Model, input: FederationInput): Model {
  const diagnostics: Diagnostic[] = [];
  const imported = new Map<string, ImportedModel>();
  const at = (ns: string) => model.importLocations?.get(ns);
  const lockLocation: SourceLocation = { file: input.lockPath, line: 1, column: 1 };

  if (input.lockError) {
    diagnostics.push({
      severity: "error",
      code: "import/invalid-lock",
      message: `${input.lockPath} can't be read: ${input.lockError}. Run archdoc sync to rewrite it.`,
      location: lockLocation,
    });
  }

  for (const [ns, spec] of Object.entries(model.imports)) {
    const entry = input.lock?.imports[ns];
    if (!entry) {
      if (!input.lockError) {
        diagnostics.push({
          severity: "warning",
          code: "import/not-synced",
          message: `"${ns}" is imported but not synced, so references into it aren't checked. Run archdoc sync.`,
          location: at(ns),
        });
      }
      continue;
    }
    const pinned = `${ns}@${entry.version ?? entry.commit?.slice(0, 7) ?? entry.source}`;
    if (entry.source !== importSource(spec) || entry.requested !== importRange(spec)) {
      diagnostics.push({
        severity: "warning",
        code: "import/out-of-date",
        message: `The import of "${ns}" changed since the last sync (archdoc.lock has ${entry.source}${entry.requested ? ` ${entry.requested}` : ""}). Run archdoc sync.`,
        location: at(ns),
      });
    }
    const file = input.bundles.get(ns);
    if (file?.text === undefined) {
      diagnostics.push({
        severity: "error",
        code: "import/missing-bundle",
        message: `The bundle for ${pinned} is missing (${file?.path ?? entry.bundle}). Run archdoc sync.`,
        location: at(ns),
      });
      continue;
    }
    if (file.integrity !== entry.integrity) {
      diagnostics.push({
        severity: "error",
        code: "import/modified-bundle",
        message: `${file.path} doesn't match the hash in archdoc.lock. Vendored bundles aren't edited by hand; run archdoc sync.`,
        location: at(ns),
      });
      continue;
    }
    const parsed = parseBundle(file.text);
    if ("error" in parsed) {
      diagnostics.push({
        severity: "error",
        code: "import/invalid-bundle",
        message: `${file.path} is ${parsed.error}. Run archdoc sync.`,
        location: at(ns),
      });
      continue;
    }
    if (parsed.bundle.namespace !== ns) {
      diagnostics.push({
        severity: "error",
        code: "import/namespace-mismatch",
        message: `"${ns}" points to a model with namespace "${parsed.bundle.namespace}". Import it under that name.`,
        location: at(ns),
      });
      continue;
    }
    const m = modelFromBundle(parsed.bundle);
    const errors = m.diagnostics.filter((d) => d.severity === "error").length;
    if (errors) {
      diagnostics.push({
        severity: "warning",
        code: "import/invalid-bundle",
        message: `${pinned} has ${errors} error${errors === 1 ? "" : "s"} of its own, so checks against it may be wrong.`,
        location: at(ns),
      });
    }
    imported.set(ns, {
      namespace: ns,
      version: entry.version,
      commit: entry.commit,
      source: entry.source,
      bundle: parsed.bundle,
      model: m,
    });
  }

  for (const ns of Object.keys(input.lock?.imports ?? {})) {
    if (model.imports[ns]) continue;
    diagnostics.push({
      severity: "warning",
      code: "import/unused-lock-entry",
      message: `archdoc.lock pins "${ns}", which isn't imported anymore. Run archdoc sync.`,
      location: lockLocation,
    });
  }

  // A repo built against a different major version of a namespace than ours pins.
  for (const dep of imported.values()) {
    for (const [ns, theirs] of Object.entries(dep.bundle.imports ?? {})) {
      const ours = input.lock?.imports[ns]?.version;
      if (!ours || !model.imports[ns] || compatible(ours, theirs)) continue;
      diagnostics.push({
        severity: "warning",
        code: "import/version-skew",
        message: `${dep.namespace}@${dep.version ?? "?"} was built against ${ns} ${theirs}, but this repo pins ${ns} ${ours}. What ${dep.namespace} says about ${ns} may not hold.`,
        location: at(dep.namespace),
      });
    }
  }

  model.imported = imported;
  checkReferences(model, imported, diagnostics);
  model.diagnostics.push(...diagnostics);
  return model;
}

/** What a reference into another repo points to, in that repo's model. */
export function lookupImported(
  imported: ReadonlyMap<string, ImportedModel>,
  ref: string,
):
  | { status: "found"; dep: ImportedModel; node: ElementNode | ActorNode }
  | { status: "missing"; dep: ImportedModel; id: string; hint?: string }
  | { status: "not-synced" } {
  const dot = ref.indexOf(".");
  const dep = dot > 0 ? imported.get(ref.slice(0, dot)) : undefined;
  if (!dep) return { status: "not-synced" };
  const id = ref.slice(dot + 1);
  const node = dep.model.elements.get(id) ?? dep.model.actors.get(id);
  if (node) return { status: "found", dep, node };
  const near = [...dep.model.elements.keys()].filter((e) => e.endsWith(`.${id}`));
  return {
    status: "missing",
    dep,
    id,
    ...(near.length
      ? { hint: `Did you mean ${near.map((n) => `${dep.namespace}.${n}`).join(" or ")}?` }
      : {}),
  };
}

function checkReferences(
  model: Model,
  imported: ReadonlyMap<string, ImportedModel>,
  diagnostics: Diagnostic[],
) {
  const describe = (dep: ImportedModel) => `${dep.namespace}@${dep.version ?? "?"}`;
  const resolveRef = (
    ref: ExternalRef,
    subject: string,
    location: SourceLocation | undefined,
  ): ElementNode | ActorNode | undefined => {
    const found = lookupImported(imported, ref.ref);
    if (found.status === "not-synced") return undefined;
    if (found.status === "missing") {
      diagnostics.push({
        severity: "error",
        code: "ref/unknown-in-import",
        message: `${subject} ${ref.ref}, which ${describe(found.dep)} doesn't have.${found.hint ? ` ${found.hint}` : ""}`,
        location,
      });
      return undefined;
    }
    if (found.node.spec.status === "deprecated") {
      diagnostics.push({
        severity: "warning",
        code: "ref/deprecated-target",
        message: `${subject} ${ref.ref}, which is deprecated in ${describe(found.dep)}.`,
        location,
      });
    }
    return found.node;
  };

  for (const rel of model.relationships) {
    if (rel.to.type !== "external") continue;
    const node = resolveRef(rel.to, `${rel.from.id} uses`, rel.location);
    if (node && rel.via) {
      const d = contractDiagnostic(
        rel,
        node.type === "element" ? node.spec.provides : undefined,
        rel.to.ref,
      );
      if (d) diagnostics.push(d);
    }
  }

  for (const journey of model.journeys.values()) {
    const label = `Journey "${journey.id}"`;
    if (journey.actor?.type === "external") {
      resolveRef(journey.actor, `${label}: its actor is`, journey.location);
    }
    for (const step of journey.steps) {
      const n = step.index + 1;
      let missing = false;
      for (const end of [step.from, step.to]) {
        if (end?.type !== "external") continue;
        if (resolveRef(end, `${label}, step ${n}: refers to`, step.location)) continue;
        missing ||= lookupImported(imported, end.ref).status === "missing";
      }
      const from = step.from;
      if (from?.type !== "external" || !step.to) continue;
      const dep = imported.get(from.namespace);
      if (!dep) continue;
      // Checked here instead: drop the "unverified" note.
      const i = model.diagnostics.findIndex(
        (d) => d.code === "journey/unverified-step" && d.location === step.location,
      );
      if (i >= 0) model.diagnostics.splice(i, 1);
      if (!missing && !declaredIn(model, dep, from, step.to)) {
        diagnostics.push({
          severity: "error",
          code: "journey/broken-step",
          message: `${label}, step ${n}: ${from.ref} → ${refOf(step.to, model.namespace)} doesn't follow a relationship that ${describe(dep)} declares.`,
          location: step.location,
        });
      }
    }
  }
}

/**
 * True when the step from `from` (in the imported repo) to `to` follows a
 * declared relationship: the imported model has `from` (or a part of it)
 * using `to` (or a part of it), or `to` is an actor that uses `from` (the
 * response), declared in whichever model owns the actor.
 */
function declaredIn(model: Model, dep: ImportedModel, from: ExternalRef, to: Target): boolean {
  const m = dep.model;
  const inDep = (ref: string): NodeRef | undefined => {
    if (!ref.startsWith(`${dep.namespace}.`)) return undefined;
    const id = ref.slice(dep.namespace.length + 1);
    if (m.elements.has(id)) return { type: "element", id };
    if (m.actors.has(id)) return { type: "actor", id };
    return undefined;
  };
  const source = inDep(from.ref);
  if (!source) return false;
  const sources = selfAndDescendants(m, source);
  const target = refOf(to, model.namespace);
  const targetInDep = inDep(target);
  const targets = targetInDep ? selfAndDescendants(m, targetInDep) : undefined;
  const covers = (ref: string, whole: string) => ref === whole || ref.startsWith(`${whole}.`);

  const forward = m.relationships.some(
    (r) =>
      sources.has(nodeKey(r.from)) &&
      (targets ? targets.has(nodeKey(r.to)) : r.to.type === "external" && covers(r.to.ref, target)),
  );
  if (forward) return true;
  // The response: back to an actor that uses `from`.
  if (targetInDep?.type === "actor") {
    return m.relationships.some(
      (r) => nodeKey(r.from) === nodeKey(targetInDep) && sources.has(nodeKey(r.to)),
    );
  }
  if (to.type === "actor") {
    return model.relationships.some(
      (r) =>
        r.from.type === "actor" &&
        r.from.id === to.id &&
        r.to.type === "external" &&
        covers(from.ref, r.to.ref),
    );
  }
  return false;
}

function selfAndDescendants(m: Model, ref: NodeRef): Set<string> {
  const out = new Set([nodeKey(ref)]);
  if (ref.type !== "element") return out;
  const stack = [ref.id];
  while (stack.length) {
    for (const child of m.elements.get(stack.pop() as string)?.childIds ?? []) {
      out.add(nodeKey({ type: "element", id: child }));
      stack.push(child);
    }
  }
  return out;
}

/** A target as another repo would write it. */
function refOf(t: Target, ownNamespace: string): string {
  return t.type === "external" ? t.ref : `${ownNamespace}.${t.id}`;
}

/** Same major version (or same minor, before 1.0). */
function compatible(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^[^\d]*/, "")
      .split(".")
      .map(Number);
  const [am = 0, an = 0] = parse(a);
  const [bm = 0, bn = 0] = parse(b);
  return am === bm && (am > 0 || an === bn);
}
