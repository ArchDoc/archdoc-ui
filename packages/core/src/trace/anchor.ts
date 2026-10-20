import type { Importance } from "@archdoc/spec";
import { stringify } from "yaml";
import { locate } from "../codemap/codemap.js";
import { normalizePath } from "../codemap/glob.js";
import { otherModels } from "../federation/consumers.js";
import type { JourneyStep, Model, Target } from "../model.js";
import { impact } from "../query/impact.js";
import { covers } from "./hops.js";

/** Something in the error text that points into the code or the model. */
export interface ErrorEvidence {
  /** frame: a stack frame. path: a file path (with a line, maybe). identifier: a name the model knows. */
  kind: "frame" | "path" | "identifier";
  /** The text it was read from. */
  text: string;
  /** Repository-relative path, when it maps to one. */
  path?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  /** The function a frame is in. */
  function?: string | undefined;
  /** The element that owns the path, or that the identifier names. */
  element?: string | undefined;
  /** What an identifier names: a data entry, a mapping, a logic block, a symbol, or an element. */
  names?: "data" | "mapping" | "logic" | "symbol" | "element" | undefined;
  /** Frames from the same trace, innermost first, numbered from 0. */
  depth?: number | undefined;
}

/** An element the error points at, with why. */
export interface AnchorElement {
  element: string;
  score: number;
  /** Repository files in the error that it owns. */
  files: string[];
  /** The evidence, as text such as packages/core/src/load/git.ts:101 (frame 1). */
  evidence: string[];
}

/** A journey step the error may have shown up in, best first. */
export interface AnchorCandidate {
  journey: string;
  /** 1-based. */
  step: number;
  /** The step's ends, by the model's IDs. */
  from: string;
  to: string;
  action?: string | undefined;
  code?: string | undefined;
  goal: string;
  actor: string;
  importance: Importance;
  score: number;
  /** Why it ranks where it does, strongest first. */
  reasons: string[];
  /** The elements in the error that this step goes through. */
  elements: string[];
}

export interface AnchorResult {
  evidence: ErrorEvidence[];
  elements: AnchorElement[];
  anchors: AnchorCandidate[];
  /** Paths in the error that no element maps (or that aren't in the repository). */
  unmapped: string[];
}

export interface AnchorOptions {
  /** Repository files, to map absolute, built (dist/*.js), and partial paths onto source files. */
  files?: readonly string[] | undefined;
  /** The repository's absolute path, stripped from absolute paths when `files` isn't given. */
  root?: string | undefined;
  /** How many anchors to return (default 5). */
  limit?: number | undefined;
}

const IMPORTANCE = { critical: 0, high: 1, normal: 2 } as const;

interface Raw {
  kind: "frame" | "path";
  text: string;
  path: string;
  line?: number | undefined;
  column?: number | undefined;
  function?: string | undefined;
  /** Python prints the innermost frame last. */
  innermostLast?: boolean;
}

/** Stack frame formats: the pattern, and which groups hold the path, line, column, and function. */
const FRAMES: {
  re: RegExp;
  path: number;
  line: number;
  column?: number;
  fn?: number;
  innermostLast?: boolean;
}[] = [
  // JavaScript: at fn (file:line:col), at file:line:col
  {
    re: /^\s*at\s+(?:(?:async\s+)?(.+?)\s+\()?(?:file:\/\/)?([^\s()]+?):(\d+):(\d+)\)?$/,
    fn: 1,
    path: 2,
    line: 3,
    column: 4,
  },
  // Java, Kotlin, Scala: at pkg.Class.method(File.java:12)
  { re: /^\s*at\s+([\w$.<>]+)\(([\w$-]+\.\w+):(\d+)\)/, fn: 1, path: 2, line: 3 },
  // Python: File "x.py", line 12, in fn (innermost last)
  {
    re: /File "([^"]+)", line (\d+)(?:, in ([\w.<>]+))?/,
    path: 1,
    line: 2,
    fn: 3,
    innermostLast: true,
  },
  // Go: \t/path/file.go:12 +0x1d; Rust: --> src/main.rs:12:5
  {
    re: /^\s*(?:-->\s*)?(\S+\.(?:go|rs)):(\d+)(?::(\d+))?(?:\s+\+0x[0-9a-f]+)?$/,
    path: 1,
    line: 2,
    column: 3,
  },
];

/** Anything else: path:line[:col], or a path with a directory. */
const GENERIC_PATH =
  /(?:^|[\s'"`([=])((?:file:\/\/)?(?:[\w.@~-]*\/)*[\w@-][\w.@-]*\.[A-Za-z]\w{0,5})(?::(\d+)(?::(\d+))?)?(?=$|[\s'"`)\],;:])/g;

/** Stack frames and paths, line by line, in the order they appear. */
function extract(text: string): Raw[] {
  const out: Raw[] = [];
  const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));
  lines: for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    for (const f of FRAMES) {
      const m = f.re.exec(line);
      if (!m) continue;
      out.push({
        kind: "frame",
        text: line.trim(),
        path: m[f.path] as string,
        line: num(m[f.line]),
        column: f.column ? num(m[f.column]) : undefined,
        function: f.fn ? m[f.fn] : undefined,
        ...(f.innermostLast ? { innermostLast: true } : {}),
      });
      continue lines;
    }
    for (const g of line.matchAll(GENERIC_PATH)) {
      const path = g[1] as string;
      // A bare name.ext without a line is usually prose (archdoc.yaml, v1.2), unless it has a directory.
      if (g[2] === undefined && !path.includes("/")) continue;
      if (/^\d/.test(path.split("/").pop() ?? "")) continue;
      out.push({ kind: "path", text: g[0].trim(), path, line: num(g[2]), column: num(g[3]) });
    }
  }
  return out;
}

/** Ways a built or absolute path may name a source file. */
function variants(path: string): string[] {
  const out = [path];
  const src = path.replace(/(^|\/)dist\//, "$1src/");
  for (const p of new Set([path, src])) {
    if (/\.d\.ts$/.test(p)) out.push(p.replace(/\.d\.ts$/, ".ts"));
    if (/\.js$/.test(p)) out.push(p.replace(/\.js$/, ".ts"), p.replace(/\.js$/, ".tsx"));
    if (/\.mjs$/.test(p)) out.push(p.replace(/\.mjs$/, ".mts"));
    if (/\.cjs$/.test(p)) out.push(p.replace(/\.cjs$/, ".cts"));
    if (p !== path) out.push(p);
  }
  return [...new Set(out)];
}

/** A path from an error as a repository path, or undefined when it's outside the repository. */
function repoPathOf(model: Model, written: string, options: AnchorOptions): string | undefined {
  let p = written.replace(/^file:\/\//, "").replace(/\\/g, "/");
  if (/^node:|(^|\/)node_modules\/|^internal\/|^<anonymous>$/.test(p)) return undefined;
  if (options.root) {
    const root = normalizePath(options.root).replace(/\/$/, "");
    const abs = p.replace(/^\/+/, "");
    if (abs.startsWith(`${root}/`)) p = abs.slice(root.length + 1);
  }
  p = p.replace(/^\.\//, "");
  const files = options.files;
  if (files) {
    const set = new Set(files);
    for (const v of variants(p.replace(/^\/+/, ""))) if (set.has(v)) return v;
    // An absolute path that ends with a repository file, or a partial one (src/x.ts run from a package).
    for (const v of variants(p)) {
      const longer = files
        .filter((f) => v.endsWith(`/${f}`))
        .sort((a, b) => b.length - a.length)[0];
      if (longer) return longer;
      const partial = files.filter((f) => f.endsWith(`/${v.replace(/^\/+/, "")}`));
      if (partial.length === 1) return partial[0];
    }
    return undefined;
  }
  // Without the file list: the longest tail of the path that an element maps.
  const parts = p.replace(/^\/+/, "").split("/");
  for (let i = 0; i < parts.length; i++) {
    const tail = parts.slice(i).join("/");
    for (const v of variants(tail)) if (locate(model, v).element) return v;
  }
  return /^\//.test(p) ? undefined : p;
}

/** Names the model knows, to find in the error text. */
function vocabulary(
  model: Model,
): Map<string, { names: ErrorEvidence["names"]; element?: string }> {
  const out = new Map<string, { names: ErrorEvidence["names"]; element?: string }>();
  // Other repos' first, so this model's own names win.
  const models: [string | undefined, Model][] = [
    ...[...otherModels(model)].map(([ns, m]) => [ns, m.model] as [string, Model]),
    [undefined, model],
  ];
  for (const [ns, m] of models) {
    const set = (id: string, v: { names: ErrorEvidence["names"]; element?: string }) => {
      out.set(id, v);
      if (ns) out.set(`${ns}.${id}`, v);
    };
    for (const id of m.data.keys()) set(id, { names: "data" });
    for (const id of m.mappings.keys()) set(id, { names: "mapping" });
    for (const [id, l] of m.logic.entries()) {
      const runsIn = l.spec["runs-in"];
      set(id, { names: "logic", ...(runsIn && !ns ? { element: runsIn } : {}) });
    }
  }
  for (const e of model.elements.values()) {
    if (e.id.includes(".")) out.set(e.id, { names: "element", element: e.id });
    for (const c of e.code) if (c.symbol) out.set(c.symbol, { names: "symbol", element: e.id });
  }
  return out;
}

/**
 * Where an error belongs in the model: the elements its stack frames and
 * paths map to, and the journey steps it most likely showed up in, best
 * first. Steps whose `code:` names a file in the error rank first, then
 * steps through the elements the error passes, then steps that send or
 * decide on something the error names. Deterministic: the same text and
 * model always give the same answer.
 */
export function anchorError(model: Model, text: string, options: AnchorOptions = {}): AnchorResult {
  const evidence: ErrorEvidence[] = [];
  const unmapped: string[] = [];
  const raws = extract(text);
  // Number frames innermost first, whichever way the language prints them.
  const frames = raws.filter((r) => r.kind === "frame");
  const innermostLast = frames.some((f) => f.innermostLast);
  const ordered = innermostLast ? [...frames].reverse() : frames;
  const seenPaths = new Set<string>();
  for (const r of raws) {
    const path = repoPathOf(model, r.path, options);
    const element = path ? locate(model, path).element?.id : undefined;
    const depth = r.kind === "frame" ? ordered.indexOf(r) : undefined;
    if (!path || !element) {
      if (
        !/^node:|node_modules|^internal\/|<anonymous>/.test(r.path) &&
        !unmapped.includes(path ?? r.path)
      )
        unmapped.push(path ?? r.path);
    }
    // The same path written twice (a frame and the message) counts once, as the frame.
    const key = `${path ?? r.path}:${r.line ?? ""}`;
    if (r.kind === "path" && seenPaths.has(key)) continue;
    seenPaths.add(key);
    evidence.push({
      kind: r.kind,
      text: r.text,
      ...(path ? { path } : {}),
      ...(r.line !== undefined ? { line: r.line } : {}),
      ...(r.column !== undefined ? { column: r.column } : {}),
      ...(r.function ? { function: r.function } : {}),
      ...(element ? { element } : {}),
      ...(depth !== undefined ? { depth } : {}),
    });
  }

  // Names the model knows: data entries, mappings, logic, symbols, dotted element IDs.
  const words = vocabulary(model);
  const named = new Set<string>();
  const functions = new Set(evidence.flatMap((e) => (e.function ? e.function.split(/[.\s]/) : [])));
  for (const token of text.match(/[A-Za-z_][\w.-]*[\w]/g) ?? []) {
    for (const t of new Set([token, token.replace(/[.-]+$/, "")])) {
      const hit = words.get(t);
      if (!hit || named.has(t)) continue;
      named.add(t);
      evidence.push({
        kind: "identifier",
        text: t,
        names: hit.names,
        ...(hit.element ? { element: resolveElement(model, hit.element) } : {}),
      });
    }
  }
  for (const f of functions) {
    const hit = words.get(f);
    if (hit?.names === "symbol" && !named.has(f)) {
      named.add(f);
      evidence.push({ kind: "identifier", text: f, names: "symbol", element: hit.element });
    }
  }

  // Elements, by how strongly the error points at them.
  const byElement = new Map<string, AnchorElement>();
  const weigh = (e: ErrorEvidence): number => {
    if (e.kind === "frame") return (e.depth ?? 9) < 3 ? 6 : 3;
    if (e.kind === "path") return e.line !== undefined ? 5 : 3;
    return e.names === "symbol" ? 6 : e.names === "element" || e.names === "logic" ? 4 : 0;
  };
  for (const e of evidence) {
    if (!e.element) continue;
    const w = weigh(e);
    if (!w) continue;
    const a = byElement.get(e.element) ?? { element: e.element, score: 0, files: [], evidence: [] };
    a.score += w;
    if (e.path && !a.files.includes(e.path)) a.files.push(e.path);
    a.evidence.push(describeEvidence(e));
    byElement.set(e.element, a);
  }
  const elements = [...byElement.values()].sort(
    (a, b) => b.score - a.score || a.element.localeCompare(b.element),
  );

  // Journey steps.
  const candidates = new Map<string, AnchorCandidate>();
  const candidate = (journey: string, step: JourneyStep): AnchorCandidate => {
    const key = `${journey}#${step.index + 1}`;
    let c = candidates.get(key);
    if (!c) {
      const j = model.journeys.get(journey);
      c = {
        journey,
        step: step.index + 1,
        from: idOf(step.from) ?? step.spec.from,
        to: idOf(step.to) ?? step.spec.to,
        action: step.spec.action,
        code: step.spec.code,
        goal: j?.spec.goal ?? "",
        actor: j?.spec.actor ?? "",
        importance: j?.spec.importance ?? "normal",
        score: 0,
        reasons: [],
        elements: [],
      };
      candidates.set(key, c);
    }
    return c;
  };
  const paths = [...new Set(evidence.flatMap((e) => (e.path ? [e.path] : [])))];

  for (const j of model.journeys.values()) {
    for (const step of j.steps) {
      const code = step.spec.code ? normalizePath(step.spec.code) : undefined;
      if (!code) continue;
      const hit = paths.find((p) => p === code || p.startsWith(`${code.replace(/\/\*\*$/, "")}/`));
      if (hit) {
        const c = candidate(j.id, step);
        c.score += 100;
        c.reasons.push(`its code is ${code}, which the error names`);
      }
    }
  }

  for (const a of elements) {
    const r = impact(model, a.element, 1);
    if (!r.ok) continue;
    for (const aj of r.impact.journeys) {
      for (const n of aj.steps) {
        const step = aj.journey.steps[n - 1];
        if (!step) continue;
        let points = 0;
        let how = "";
        for (const end of [step.from, step.to]) {
          const id = end?.type === "element" ? end.id : undefined;
          if (!id) continue;
          const p =
            id === a.element ? 3 : covers(a.element, id) ? 2 : covers(id, a.element) ? 1 : 0;
          if (p > points) {
            points = p;
            how =
              p === 3
                ? "goes through"
                : p === 2
                  ? `goes through ${id}, which contains`
                  : `goes through ${id}, part of`;
          }
        }
        if (!points) continue;
        const c = candidate(aj.journey.id, step);
        c.score += points * a.score;
        if (!c.elements.includes(a.element)) c.elements.push(a.element);
        c.reasons.push(`${how} ${a.element} (${a.evidence[0]})`);
      }
    }
  }

  for (const e of evidence) {
    if (
      e.kind !== "identifier" ||
      (e.names !== "data" && e.names !== "mapping" && e.names !== "logic")
    )
      continue;
    for (const j of model.journeys.values()) {
      for (const step of j.steps) {
        const s = step.spec;
        const says =
          e.names === "data"
            ? mentionsData(s, e.text)
              ? `sends or writes ${e.text}`
              : undefined
            : sameName(e.names === "logic" ? s.decides : s.via, e.text)
              ? `${e.names === "logic" ? "decides with" : "writes through"} ${e.text}`
              : undefined;
        if (!says) continue;
        const c = candidate(j.id, step);
        c.score += e.names === "data" ? 4 : 6;
        c.reasons.push(`${says}, which the error names`);
      }
    }
  }

  const anchors = [...candidates.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        IMPORTANCE[a.importance] - IMPORTANCE[b.importance] ||
        a.journey.localeCompare(b.journey) ||
        a.step - b.step,
    )
    .slice(0, options.limit ?? 5);
  return { evidence, elements, anchors, unmapped };
}

function resolveElement(model: Model, ref: string): string | undefined {
  if (model.elements.has(ref)) return ref;
  const matches = [...model.elements.keys()].filter((id) => id.endsWith(`.${ref}`));
  return matches.length === 1 ? matches[0] : undefined;
}

function idOf(t: Target | undefined): string | undefined {
  return t === undefined ? undefined : t.type === "external" ? t.ref : t.id;
}

/** The same name, written with or without a namespace: payments.Refund and Refund. */
function sameName(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function mentionsData(s: JourneyStep["spec"], entry: string): boolean {
  const list = (v: string | string[] | undefined) =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  if (list(s.sends).some((x) => sameName(x, entry))) return true;
  const creates = s.creates;
  const created =
    creates === undefined
      ? []
      : typeof creates === "string" || Array.isArray(creates)
        ? list(creates)
        : Object.keys(creates);
  if (created.some((x) => sameName(x, entry))) return true;
  return Object.keys(s.changes ?? {}).some((k) => sameName(k.slice(0, k.lastIndexOf(".")), entry));
}

/** One piece of evidence as text: packages/x.ts:12 (frame 1, in fn). */
export function describeEvidence(e: ErrorEvidence): string {
  if (e.kind === "identifier")
    return `names ${e.names === "data" ? "data entry" : e.names} ${e.text}`;
  const where = `${e.path ?? e.text}${e.line !== undefined ? `:${e.line}` : ""}`;
  if (e.kind === "path") return where;
  return `${where} (frame ${(e.depth ?? 0) + 1}${e.function ? `, in ${e.function}` : ""})`;
}

/**
 * A trace to start from, for the best anchor: the journey step, the symptom,
 * and a step for each call between elements the stack shows (outermost
 * first, with the line that makes the call). Every guess says TODO.
 */
export function traceSkeleton(result: AnchorResult, text: string): string {
  const top = result.anchors[0];
  const id = slug(text);
  const q = (s: string) => stringify(s).trimEnd();

  // Calls between elements, outermost first: each frame's caller is the frame after it.
  const frames = result.evidence
    .filter((e) => e.kind === "frame" && e.element && e.depth !== undefined)
    .sort((a, b) => (b.depth as number) - (a.depth as number));
  const hops: { from: string; to: string; code: string }[] = [];
  for (let i = 0; i + 1 < frames.length; i++) {
    const caller = frames[i] as ErrorEvidence;
    const callee = frames[i + 1] as ErrorEvidence;
    if (caller.element === callee.element) continue;
    hops.push({
      from: caller.element as string,
      to: callee.element as string,
      code: `${caller.path}${caller.line !== undefined ? `:${caller.line}` : ""}`,
    });
  }

  const symptom = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l, i, all) => l || (i > 0 && i < all.length - 1))
    .slice(0, 8);
  const out = [
    "# Suggested by archdoc trace anchor. Follow the code, then fix every step: say",
    "# what it does, give it evidence (reproduced, read, or inferred), and mark the",
    `# cause. Save it as .archdoc/traces/${id}.yaml and run archdoc trace check.`,
    `trace: ${id}`,
    "title: TODO the bug in one line, as the user would say it",
    "symptom: |",
    ...(symptom.length ? symptom : ["TODO"]).map((l) => `  ${l}`),
    "reproduce: TODO a command, a request, or a test that shows it",
  ];
  if (top) {
    out.push(
      `expands: ${top.journey}#${top.step}   # ${top.from} → ${top.to}${top.action ? `: ${top.action}` : ""}`,
    );
  } else {
    out.push("actor: TODO whose request it was", "goal: TODO what they were doing");
  }
  out.push("diagnosis: TODO why it happens", "steps:");
  if (hops.length) {
    for (const [i, h] of hops.entries()) {
      out.push(
        `  - from: ${q(h.from)}`,
        `    to: ${q(h.to)}`,
        "    action: TODO what it asks for",
        `    code: ${q(h.code)}`,
        `    evidence: reproduced   # the stack trace shows this call`,
      );
      if (i === hops.length - 1)
        out.push("    role: symptom   # TODO: where the error shows; mark the cause too");
    }
  } else {
    const first = result.evidence.find((e) => e.path);
    out.push(
      `  - from: ${q(top?.from ?? "TODO")}`,
      `    to: ${q(top?.to ?? "TODO")}`,
      `    action: ${q(top?.action ? `TODO ${top.action}` : "TODO what happens")}`,
      ...(first?.path
        ? [`    code: ${q(`${first.path}${first.line !== undefined ? `:${first.line}` : ""}`)}`]
        : []),
      "    role: symptom",
      "    evidence: inferred   # TODO: reproduced or read, once you've seen it",
    );
  }
  out.push("fix: TODO what fixes it");
  return `${out.join("\n")}\n`;
}

/** A trace ID from the first line of an error: lowercase words, joined by -. */
function slug(text: string): string {
  const line = text.split(/\r?\n/).find((l) => /[A-Za-z]/.test(l) && !/^\s*at\s/.test(l)) ?? "";
  const words = (line.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? [])
    .filter((w) => w.length > 1)
    .slice(0, 5);
  return words.join("-").slice(0, 48).replace(/-+$/, "") || "bug";
}
