import {
  type ImportSpec,
  importRange,
  importSource,
  type Lock,
  type LockEntry,
} from "@archdoc/spec";
import type { Diagnostic, SourceLocation } from "../diagnostics.js";
import { contractDiagnostic, isEventContract, LANDSCAPE } from "../load/build.js";
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

  /** Loads one locked bundle, or reports why it can't be used. */
  const load = (
    key: string,
    label: string,
    spec: ImportSpec,
    entry: LockEntry | undefined,
    expected: string | undefined,
  ): ImportedModel | undefined => {
    if (!entry) {
      if (!input.lockError) {
        diagnostics.push({
          severity: "warning",
          code: "import/not-synced",
          message: `${label} is imported but not synced, so ${expected ? "references into it aren't checked" : "consumers in other repos aren't known"}. Run archdoc sync.`,
          location: at(key),
        });
      }
      return undefined;
    }
    const pinned = `${expected ?? label}@${entry.version ?? entry.commit?.slice(0, 7) ?? entry.source}`;
    if (entry.source !== importSource(spec) || entry.requested !== importRange(spec)) {
      diagnostics.push({
        severity: "warning",
        code: "import/out-of-date",
        message: `The import of ${label} changed since the last sync (archdoc.lock has ${entry.source}${entry.requested ? ` ${entry.requested}` : ""}). Run archdoc sync.`,
        location: at(key),
      });
    }
    const file = input.bundles.get(key);
    if (file?.text === undefined) {
      diagnostics.push({
        severity: "error",
        code: "import/missing-bundle",
        message: `The bundle for ${pinned} is missing (${file?.path ?? entry.bundle}). Run archdoc sync.`,
        location: at(key),
      });
      return undefined;
    }
    if (file.integrity !== entry.integrity) {
      diagnostics.push({
        severity: "error",
        code: "import/modified-bundle",
        message: `${file.path} doesn't match the hash in archdoc.lock. Vendored bundles aren't edited by hand; run archdoc sync.`,
        location: at(key),
      });
      return undefined;
    }
    const parsed = parseBundle(file.text);
    if ("error" in parsed) {
      diagnostics.push({
        severity: "error",
        code: "import/invalid-bundle",
        message: `${file.path} is ${parsed.error}. Run archdoc sync.`,
        location: at(key),
      });
      return undefined;
    }
    if (expected && parsed.bundle.namespace !== expected) {
      diagnostics.push({
        severity: "error",
        code: "import/namespace-mismatch",
        message: `"${expected}" points to a model with namespace "${parsed.bundle.namespace}". Import it under that name.`,
        location: at(key),
      });
      return undefined;
    }
    const m = modelFromBundle(parsed.bundle);
    const errors = m.diagnostics.filter((d) => d.severity === "error").length;
    if (errors) {
      diagnostics.push({
        severity: "warning",
        code: "import/invalid-bundle",
        message: `${pinned} has ${errors} error${errors === 1 ? "" : "s"} of its own, so checks against it may be wrong.`,
        location: at(key),
      });
    }
    return {
      namespace: parsed.bundle.namespace,
      version: entry.version,
      commit: entry.commit,
      source: entry.source,
      bundle: parsed.bundle,
      model: m,
    };
  };

  for (const [ns, spec] of Object.entries(model.imports)) {
    const dep = load(ns, `"${ns}"`, spec, input.lock?.imports[ns], ns);
    if (dep) imported.set(ns, dep);
  }

  if (model.landscapeImport) {
    const land = load(
      LANDSCAPE,
      "The landscape",
      model.landscapeImport,
      input.lock?.landscape,
      undefined,
    );
    if (land) {
      const members = new Map<string, ImportedModel>();
      for (const b of land.bundle.includes ?? []) {
        if (b.namespace === model.namespace) continue;
        members.set(b.namespace, {
          namespace: b.namespace,
          version: b.version,
          commit: b.commit,
          source: b.source,
          bundle: b,
          model: modelFromBundle(b),
        });
      }
      model.landscape = { ...land, members };
      // Teams the landscape defines resolve here, so owners: [payments-team] needs no local copy.
      for (let i = model.diagnostics.length - 1; i >= 0; i--) {
        const d = model.diagnostics[i];
        const owner =
          d?.code === "ref/unresolved-owner" ? /^Owner "([^"]+)"/.exec(d.message)?.[1] : undefined;
        if (owner && land.model.actors.has(owner)) model.diagnostics.splice(i, 1);
      }
    }
  } else if (input.lock?.landscape) {
    diagnostics.push({
      severity: "warning",
      code: "import/unused-lock-entry",
      message: `archdoc.lock pins the landscape ${input.lock.landscape.namespace}, which isn't imported anymore. Run archdoc sync.`,
      location: lockLocation,
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
      if (!from || !step.to) continue;
      const noteAt = (code: string) =>
        model.diagnostics.findIndex((d) => d.code === code && d.location === step.location);
      // A step from a synced repo is checked here: drop the "unverified" note.
      if (from.type === "external" && imported.has(from.namespace)) {
        const i = noteAt("journey/unverified-step");
        if (i >= 0) model.diagnostics.splice(i, 1);
      }
      // A missing end is already reported, and an import that didn't load has its own diagnostic.
      const unloaded = (t: Target) =>
        t.type === "external" && model.imports[t.namespace] && !imported.has(t.namespace);
      if (missing || unloaded(from) || unloaded(step.to)) continue;
      if (from.type !== "external") {
        // A local publisher and a subscriber in another repo: that repo declares the subscription.
        const i = noteAt("journey/broken-step");
        if (i >= 0 && subscribed(model, imported, from, step.to)) model.diagnostics.splice(i, 1);
        continue;
      }
      const dep = imported.get(from.namespace);
      if (!dep) continue;
      if (!declaredIn(model, dep, from, step.to) && !subscribed(model, imported, from, step.to)) {
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

/**
 * True when `to` subscribes to `from`: something in `to` uses something in
 * `from` via a topic or event that it provides. Each side may be in this
 * model or in an imported one; the subscription is declared where `to` lives.
 */
function subscribed(
  model: Model,
  imported: ReadonlyMap<string, ImportedModel>,
  from: Target,
  to: Target,
): boolean {
  const owner = (t: Target): { m: Model; node: NodeRef } | undefined => {
    if (t.type !== "external") return t.type === "element" ? { m: model, node: t } : undefined;
    const dep = imported.get(t.namespace);
    const id = t.ref.slice(t.namespace.length + 1);
    return dep?.model.elements.has(id)
      ? { m: dep.model, node: { type: "element", id } }
      : undefined;
  };
  const element = (ref: string) => {
    const [ns] = ref.split(".");
    const rest = ref.slice((ns?.length ?? 0) + 1);
    return ns === model.namespace
      ? model.elements.get(rest)
      : imported.get(ns ?? "")?.model.elements.get(rest);
  };
  const sub = owner(to);
  if (!sub) return false;
  const publisher = refOf(from, model.namespace);
  const subscribers = selfAndDescendants(sub.m, sub.node);
  return sub.m.relationships.some((r) => {
    if (!r.via || !subscribers.has(nodeKey(r.from))) return false;
    const target = refOf(r.to, sub.m.namespace);
    if (target !== publisher && !target.startsWith(`${publisher}.`)) return false;
    return isEventContract(element(target)?.spec.provides, r.via);
  });
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
