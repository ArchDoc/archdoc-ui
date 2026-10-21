import { type Seal, type SealKind, type SumFile, SumFileSchema } from "@archdoc/spec";

export { type Seal, SUM_FILE, type SumFile } from "@archdoc/spec";

import { parse, stringify } from "yaml";
import type { Finding } from "../check/check.js";
import { resolveCodeMap } from "../codemap/codemap.js";
import { compileGlob, normalizePath } from "../codemap/glob.js";
import { findSnippet, isSnippet, snippetLabel } from "../codemap/snippet.js";
import type { ImportedSchema } from "../data/schemas.js";
import type { SourceLocation } from "../diagnostics.js";
import { normalizeCode } from "../load/build.js";
import type { CodeRef, Model } from "../model.js";
import type { CodeIndex } from "../query/code-index.js";

// Seals: a fingerprint of the code each model fact points at, recorded in
// archdoc.sum. When the code changes, the fact's seal breaks, and someone
// (usually the agent that changed the code) checks whether the model still
// describes it before sealing it again. Pure: the caller reads the files.

/** A model fact that points at code, and so can be sealed. */
export interface SealedFact {
  /** Stable key in archdoc.sum, such as element:toolchain.cli or logic:refund-approval. */
  key: string;
  /** What the fact is, as people read it: "element toolchain.cli", "journey checkout, step 2". */
  label: string;
  kind: SealKind;
  /** The code it points at, as written. */
  refs: string[];
  /** Where the fact is in the model. */
  location?: SourceLocation | undefined;
  element?: string | undefined;
}

/** What a fact's code is now. */
export interface Fingerprint {
  fact: SealedFact;
  seal: Seal;
  /** A reference that couldn't be read, such as a snippet whose symbol is gone. */
  problems: string[];
}

export interface FingerprintInputs {
  /** Repository files, relative to its root. */
  files: readonly string[];
  /** A repository file's text, or undefined when it isn't there. */
  read: (path: string) => string | undefined;
  /** Exports per TS/JS file, from @archdoc/analyzers. Without it, structure is the file list alone. */
  index?: CodeIndex | undefined;
  /** What data entries' schema sources say. */
  schemas?: readonly ImportedSchema[] | undefined;
}

export type SealState = "sealed" | "changed" | "unsealed";

export interface SealStatus {
  fact: SealedFact;
  state: SealState;
  current: Seal;
  recorded?: Seal | undefined;
  /** What changed since it was sealed, as short lines: "+ src/new.ts", "loadRevision: no longer exported". */
  changes: string[];
  problems: string[];
}

const TEST = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
/** Files that aren't the code a fact describes: dependencies, build output, lockfiles, and the model itself. */
const NOISE =
  /(^|\/)(node_modules|dist|build|coverage|\.archdoc|\.changeset)\/|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|CHANGELOG\.md)$/;

/** Every fact in the model that points at code, in a stable order. */
export function sealableFacts(model: Model): SealedFact[] {
  const facts: SealedFact[] = [];
  for (const e of model.elements.values()) {
    if (e.code.length === 0) continue;
    const globs = e.code.filter((r) => !isSnippet(r));
    if (globs.length) {
      facts.push({
        key: `element:${e.id}`,
        label: `element ${e.id}`,
        kind: "structure",
        refs: globs.map((r) => r.path),
        location: e.location,
        element: e.id,
      });
    }
    for (const r of e.code.filter(isSnippet)) {
      // Shell-safe: element:core.codemap#packages/core/src/codemap/snippet.ts:findSnippet
      const at = [r.lines, r.symbol].filter(Boolean).join(":");
      facts.push({
        key: `element:${e.id}#${r.path}:${at}`,
        label: `element ${e.id}, ${snippetLabel(r)}`,
        kind: "content",
        refs: [snippetLabel(r)],
        location: e.location,
        element: e.id,
      });
    }
    for (const p of e.spec.provides ?? []) {
      const name = "api" in p ? p.api : undefined;
      // An API spec that's a file in the repo: proto/charges.proto, openapi.yaml.
      if (!name || !/\.[a-z]+$/i.test(name)) continue;
      facts.push({
        key: `contract:${e.id}#${name}`,
        label: `contract ${name} of ${e.id}`,
        kind: "content",
        refs: [name],
        location: e.location,
        element: e.id,
      });
    }
  }
  for (const j of model.journeys.values()) {
    for (const s of j.steps) {
      if (!s.spec.code) continue;
      facts.push({
        key: `step:${j.id}#${s.index + 1}`,
        label: `journey ${j.id}, step ${s.index + 1}`,
        kind: "structure",
        refs: [s.spec.code.replace(/:\d+(-\d+)?$/, "")],
        location: s.location ?? j.location,
      });
    }
  }
  for (const [section, map] of [
    ["logic", model.logic],
    ["mapping", model.mappings],
  ] as const) {
    for (const node of map.values()) {
      const refs = normalizeCode(node.spec.code);
      if (!refs.length) continue;
      facts.push({
        key: `${section}:${node.id}`,
        label: `${section === "logic" ? "decision" : "mapping"} ${node.id}`,
        kind: "content",
        refs: refs.map(snippetLabel),
        location: node.location,
      });
    }
  }
  for (const d of model.data.values()) {
    if (!d.spec.source || Object.keys(d.spec.source).length === 0) continue;
    facts.push({
      key: `data:${d.id}`,
      label: `data entry ${d.id}`,
      kind: "schema",
      refs: Object.entries(d.spec.source).map(([kind, ref]) => `${kind} ${ref}`),
      location: d.location,
    });
  }
  return facts.sort((a, b) => a.key.localeCompare(b.key));
}

/** The files content seals read, so a caller can read them ahead of time. */
export function sealedPaths(model: Model): string[] {
  const paths = new Set<string>();
  for (const fact of sealableFacts(model)) {
    if (fact.kind !== "content") continue;
    for (const r of fact.refs) paths.add(normalizePath(r.replace(/(:\d+(-\d+)?)?( \(.*\))?$/, "")));
  }
  return [...paths].sort();
}

/** What each fact's code is now. */
export function fingerprints(model: Model, inputs: FingerprintInputs): Fingerprint[] {
  const files = inputs.files.map(normalizePath);
  const owned = resolveCodeMap(model, files).files;
  const exportsOf = new Map(
    (inputs.index?.sources ?? []).map((s) => [s.path, s.exports.map((x) => x.name).sort()]),
  );
  const structure = (paths: string[]): Seal => {
    const detail: Record<string, string[]> = {};
    for (const p of [...new Set(paths)].filter((f) => !NOISE.test(f) && !TEST.test(f)).sort()) {
      detail[p] = exportsOf.get(p) ?? [];
    }
    return { kind: "structure", hash: hash(JSON.stringify(detail)), files: detail };
  };

  const out: Fingerprint[] = [];
  for (const fact of sealableFacts(model)) {
    const problems: string[] = [];
    let seal: Seal;
    if (fact.key.startsWith("element:") && fact.kind === "structure") {
      seal = structure(owned.get(fact.element ?? "") ?? []);
    } else if (fact.key.startsWith("step:")) {
      const path = normalizePath(fact.refs[0] ?? "");
      const matched = files.filter((f) => f === path || compileGlob(path).test(f));
      if (!matched.length) problems.push(`${path} matches no file`);
      seal = structure(matched);
    } else if (fact.kind === "schema") {
      const id = fact.key.slice("data:".length);
      const fields: Record<string, string> = {};
      for (const s of inputs.schemas ?? []) {
        if (s.data !== id) continue;
        if (s.error) problems.push(s.error);
        for (const [name, f] of Object.entries(s.fields ?? {})) {
          fields[name] = f.values?.length ? `${f.type} (${f.values.join(", ")})` : f.type;
        }
      }
      seal = { kind: "schema", hash: hash(JSON.stringify(sorted(fields))), fields: sorted(fields) };
    } else {
      const refs: CodeRef[] = fact.key.startsWith("element:")
        ? (model.elements
            .get(fact.element ?? "")
            ?.code.filter((r) => snippetLabel(r) === fact.refs[0]) ?? [])
        : fact.key.startsWith("contract:")
          ? [{ path: fact.refs[0] ?? "" }]
          : normalizeCode(
              (fact.key.startsWith("logic:")
                ? model.logic.get(fact.key.slice(6))
                : model.mappings.get(fact.key.slice(8))
              )?.spec.code,
            );
      const each: Record<string, { hash: string; lines: number }> = {};
      for (const ref of refs) {
        const label = snippetLabel(ref);
        const text = contentOf(ref, files, inputs.read);
        if (typeof text === "object") {
          problems.push(`${label} ${text.problem}`);
          each[label] = { hash: "missing", lines: 0 };
          continue;
        }
        const normal = normalize(text);
        each[label] = { hash: hash(normal), lines: normal ? normal.split("\n").length : 0 };
      }
      seal = {
        kind: "content",
        hash: hash(JSON.stringify(Object.entries(each).map(([k, v]) => [k, v.hash]))),
        refs: each,
      };
    }
    out.push({ fact, seal, problems });
  }
  return out;
}

/** How each fact's code compares with its seal in archdoc.sum. */
export function sealStatuses(current: Fingerprint[], recorded: SumFile | undefined): SealStatus[] {
  return current.map(({ fact, seal, problems }) => {
    const before = recorded?.seals[fact.key];
    if (!before) return { fact, state: "unsealed", current: seal, changes: [], problems };
    if (before.hash === seal.hash) {
      return { fact, state: "sealed", current: seal, recorded: before, changes: [], problems };
    }
    return {
      fact,
      state: "changed",
      current: seal,
      recorded: before,
      changes: describeChanges(before, seal),
      problems,
    };
  });
}

/** What changed between a seal and the code now, as short lines. */
export function describeChanges(before: Seal, now: Seal): string[] {
  const out: string[] = [];
  if (before.kind !== now.kind) return [`now fingerprinted by ${now.kind}, was ${before.kind}`];
  if (now.kind === "structure") {
    const a = before.files ?? {};
    const b = now.files ?? {};
    for (const f of Object.keys(b).filter((f) => !(f in a))) out.push(`+ ${f}`);
    for (const f of Object.keys(a).filter((f) => !(f in b))) out.push(`- ${f}`);
    for (const f of Object.keys(b).filter((f) => f in a)) {
      const was = new Set(a[f]);
      const is = new Set(b[f]);
      const added = [...is].filter((x) => !was.has(x));
      const removed = [...was].filter((x) => !is.has(x));
      if (added.length || removed.length) {
        out.push(
          `${f}: ${[...added.map((x) => `exports ${x}`), ...removed.map((x) => `no longer exports ${x}`)].join(", ")}`,
        );
      }
    }
  } else if (now.kind === "content") {
    const a = before.refs ?? {};
    const b = now.refs ?? {};
    for (const [ref, x] of Object.entries(b)) {
      const was = a[ref];
      if (!was) out.push(`+ ${ref}`);
      else if (x.hash === "missing" && was.hash !== "missing") out.push(`${ref} is gone`);
      else if (x.hash !== was.hash) {
        out.push(
          `${ref} changed${was.lines !== x.lines ? ` (${was.lines} → ${x.lines} lines)` : ""}`,
        );
      }
    }
    for (const ref of Object.keys(a).filter((r) => !(r in b))) out.push(`- ${ref}`);
  } else {
    const a = before.fields ?? {};
    const b = now.fields ?? {};
    for (const f of Object.keys(b).filter((f) => !(f in a))) out.push(`+ ${f} (${b[f]})`);
    for (const f of Object.keys(a).filter((f) => !(f in b))) out.push(`- ${f}`);
    for (const f of Object.keys(b).filter((f) => f in a && a[f] !== b[f])) {
      out.push(`${f}: ${a[f]} → ${b[f]}`);
    }
  }
  return out.length ? out : ["changed"];
}

/**
 * Findings for check: facts whose code changed since they were sealed, and
 * facts no one has sealed yet. Only when the repository keeps an archdoc.sum.
 */
export function sealFindings(statuses: SealStatus[], sumFile: string): Finding[] {
  const out: Finding[] = [];
  for (const s of statuses) {
    if (s.state === "sealed") continue;
    const files = [sumFile, ...(s.fact.location ? [s.fact.location.file] : [])];
    if (s.state === "changed") {
      out.push({
        severity: "warning",
        code: "seal/changed",
        message: `The code ${s.fact.label} points at changed since it was sealed (${s.changes.slice(0, 3).join("; ")}${s.changes.length > 3 ? `; and ${s.changes.length - 3} more` : ""}). Check that the model still describes it, update it if not, then run archdoc seal ${s.fact.key}.`,
        element: s.fact.element,
        evidence: s.fact.refs,
        files,
        location: s.fact.location,
      });
    } else {
      out.push({
        severity: "warning",
        code: "seal/unsealed",
        message: `${capitalize(s.fact.label)} points at code no one has sealed. Check that the model describes ${s.fact.refs.join(", ")}, then run archdoc seal ${s.fact.key}.`,
        element: s.fact.element,
        evidence: s.fact.refs,
        files,
        location: s.fact.location,
      });
    }
  }
  return out;
}

export interface SealOptions {
  /** Seal these facts (keys, or element/journey/data IDs) whatever their state. */
  keys?: readonly string[] | undefined;
  /** Seal every fact, changed or not. */
  all?: boolean | undefined;
  /** Who checked, such as agent:claude-code. */
  by?: string | undefined;
}

/**
 * archdoc.sum after sealing: the facts asked for (or, when none are, the new
 * ones) take their current fingerprints, facts that left the model drop out,
 * and the rest keep their old seal, so changed ones stay flagged.
 */
export function sealSum(
  statuses: SealStatus[],
  options: SealOptions = {},
): { sum: SumFile; sealed: string[]; unknown: string[] } {
  const wanted = new Set(options.keys ?? []);
  const matches = (s: SealStatus) =>
    wanted.has(s.fact.key) ||
    (s.fact.element !== undefined && wanted.has(s.fact.element)) ||
    [...wanted].some((w) => s.fact.key.startsWith(`${w}#`) || s.fact.key === `element:${w}`);
  const known = new Set(
    statuses.flatMap((s) => [s.fact.key, ...(s.fact.element ? [s.fact.element] : [])]),
  );
  const unknown = [...wanted].filter(
    (w) => !known.has(w) && !statuses.some((s) => s.fact.key.startsWith(`${w}#`)),
  );
  const seals: SumFile["seals"] = {};
  const sealed: string[] = [];
  for (const s of statuses) {
    // Named facts seal only those; no names seals the new ones.
    const take = options.all || (wanted.size ? matches(s) : s.state === "unsealed");
    if (take) {
      seals[s.fact.key] = { ...s.current, ...(options.by ? { by: options.by } : {}) };
      if (s.state !== "sealed" || wanted.size || options.all) sealed.push(s.fact.key);
    } else if (s.recorded) {
      seals[s.fact.key] = s.recorded;
    }
  }
  return { sum: { sealVersion: 1, seals }, sealed, unknown };
}

/** archdoc.sum as YAML, with a header so nobody edits it by hand. */
export function formatSum(sum: SumFile): string {
  const keys = Object.keys(sum.seals).sort();
  const ordered: SumFile = {
    sealVersion: 1,
    seals: Object.fromEntries(keys.map((k) => [k, sum.seals[k] as Seal])),
  };
  return `# Written by archdoc seal. Don't edit it by hand: when the code a fact points at changes, check the model, then run archdoc seal <fact>.\n${stringify(ordered, { lineWidth: 0, aliasDuplicateObjects: false })}`;
}

export function parseSum(text: string): { sum?: SumFile; error?: string } {
  try {
    const result = SumFileSchema.safeParse(parse(text));
    if (result.success) return { sum: result.data };
    const issue = result.error.issues[0];
    return { error: `${issue?.path.join(".") || "root"}: ${issue?.message}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** A code reference's text: a snippet's lines, or a whole file. */
function contentOf(
  ref: CodeRef,
  files: readonly string[],
  read: (path: string) => string | undefined,
): string | { problem: string } {
  const path = normalizePath(ref.path);
  if (!files.includes(path)) return { problem: "matches no file" };
  const text = read(path);
  if (text === undefined) return { problem: "can't be read" };
  if (!isSnippet(ref)) return text;
  const found = findSnippet(ref, text);
  return "problem" in found ? { problem: found.problem } : found.text;
}

/**
 * Text as it matters to a fingerprint: line endings, trailing spaces, blank
 * lines, and lines that are only a comment don't count.
 */
export function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "" && !/^\s*(\/\/|#(?!!)|\/\*|\*|--)/.test(l))
    .join("\n");
}

/** A 64-bit FNV-1a fingerprint, as fnv-<16 hex digits>. Not for security: it only tells text apart. */
export function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5 | 1) >>> 0;
  }
  return `fnv-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function sorted(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
