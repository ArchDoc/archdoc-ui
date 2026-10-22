import { locate } from "../codemap/codemap.js";
import { compileGlob, normalizePath } from "../codemap/glob.js";
import { dataFlows, dataStores } from "../data/flows.js";
import type { ElementNode, Model, Target } from "../model.js";
import { nodeKey } from "../model.js";
import {
  type CodeIndex,
  fileStem,
  filesNamed,
  isTestFile,
  journeyEntryPoints,
  mainSymbol,
  pointAt,
  type RankedFile,
  rankFiles,
  type SymbolKind,
  stepCodePath,
  viewOf,
} from "./code-index.js";
import { impact, rulesMentioning } from "./impact.js";
import { search } from "./search.js";
import { queryTerms, sameWord, splitIdentifier } from "./terms.js";

export interface ContextInputs {
  /** The repository's code index (from @archdoc/analyzers' `indexCode`). Without it, the brief uses the model only. */
  index?: CodeIndex | undefined;
  /** Files or directories to start from, relative to the repository root. Paths in the query count too. */
  paths?: string[] | undefined;
  /** At most this many files to start in (default 6). */
  limit?: number | undefined;
}

export interface ContextStart {
  path: string;
  line?: number | undefined;
  symbol?: string | undefined;
  kind?: SymbolKind | undefined;
  /** The element that owns the file. */
  element?: string | undefined;
  why: string;
  /** Where its container wires it in: an index that re-exports it, a program that registers it. */
  wiredIn?: ContextCallSite[] | undefined;
}

export interface ContextCallSite {
  path: string;
  line: number;
}

/** A function the start files use or declare, and the other places that call it. */
export interface ContextSameJob {
  symbol: string;
  /** The file that declares it. */
  declaredIn: string;
  element?: string | undefined;
  /** imports: a start file imports it from another element; declares: a start file declares it. */
  relation: "imports" | "declares";
  /** The start file it was found through. */
  via: string;
  callers: ContextCallSite[];
  /** Callers left out. */
  more: number;
}

export interface ContextJourney {
  id: string;
  goal: string;
  importance: string;
  /** 1-based steps whose `code:` names a start file. */
  steps: number[];
  file: string;
}

export interface ContextBrief {
  query: string;
  /** Paths the question named. */
  paths: string[];
  start: ContextStart[];
  /** The elements that own the start files, most specific first. */
  elements: { id: string; kind: string }[];
  sameJob: ContextSameJob[];
  data: { id: string; kind: string; how: string }[];
  rules: { id: string; description?: string | undefined }[];
  /** Journeys with a step whose `code:` names a start file. */
  journeys: ContextJourney[];
  /** Other journeys through the elements, by ID, most important first. */
  journeysThrough: { id: string; importance: string }[];
  /** Journeys in other repos' models with steps on the elements, as namespace.journey, most important first. */
  journeysElsewhere: { id: string; importance: string; steps: number[] }[];
  tests: { path: string; why: string }[];
  owners: string[];
  /** What uses the elements directly: other elements, actors, and other repos. */
  usedBy: { elements: string[]; actors: string[]; elsewhere: string[] };
}

const IMPORTANCE: Record<string, number> = { critical: 0, high: 1, normal: 2 };
const PER_ELEMENT = 3;
/** Files of the elements the model's own search names first rank higher. */
const BOOSTED = 3;
const BOOST = 1.5;
const VALUE_KINDS = new Set<SymbolKind>(["function", "class", "const", "let", "var", "enum"]);

/**
 * A brief for starting a task: the files and symbols to open first (ranked),
 * other places that call the same functions, the data, rules, and journeys
 * involved (the narrowest: those whose step `code:` names a start file), the
 * tests to run, and owners. `query` is a task in words, file paths, or both.
 * Deterministic: it reads the model and the code index, nothing else.
 */
export function context(model: Model, query: string, inputs: ContextInputs = {}): ContextBrief {
  const { index } = inputs;
  const limit = inputs.limit ?? 6;
  const entries = journeyEntryPoints(model);

  // Paths the question names, and the words left over.
  const named: string[] = [...(inputs.paths ?? []).map(normalizePath)];
  const words: string[] = [];
  for (const token of query.split(/\s+/).filter(Boolean)) {
    const clean = token.replace(/^[`'"(]+|[`'",:;)]+$/g, "");
    const pathLike = /\//.test(clean) || /^[\w.-]+\.[a-z]{1,5}$/i.test(clean);
    if (pathLike && (index ? filesNamed(index, clean).length > 0 : locate(model, clean).element)) {
      named.push(normalizePath(clean));
    } else {
      words.push(token);
    }
  }
  const text = words.join(" ");

  const start: ContextStart[] = [];
  const seen = new Set<string>();
  const perElement = new Map<string, number>();
  const push = (s: ContextStart, capped = true) => {
    if (seen.has(s.path) || start.length >= limit) return;
    const key = s.element ?? "";
    if (capped && (perElement.get(key) ?? 0) >= PER_ELEMENT) return;
    seen.add(s.path);
    perElement.set(key, (perElement.get(key) ?? 0) + 1);
    start.push(s);
  };
  const ownerOf = (path: string) => locate(model, path).element?.id;
  const symbolAt = (path: string) => {
    const src = index ? viewOf(index).sources.get(path) : undefined;
    return src ? mainSymbol(src.exports) : undefined;
  };

  // 1. The files the question names.
  // The model's answer (search over descriptions) lifts the files of the elements it names.
  const hits = text ? search(model, text, 5) : [];
  const named3 = hits
    .filter((h) => h.type === "element")
    .slice(0, BOOSTED)
    .map((h) => h.id);
  const byWords: RankedFile[] = (index && text ? rankFiles(model, index, text, 200) : [])
    .map((r) => ({
      ...r,
      score: named3.some((id) => related(model, id, r.element) && inside(model, r.element, id))
        ? r.score * BOOST
        : r.score,
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  for (const p of named) {
    const found = index ? filesNamed(index, p).filter((f) => !isTestFile(f)) : [p];
    // A file that doesn't exist yet: where it would belong.
    if (!found.length && ownerOf(p)) {
      push({ path: p, element: ownerOf(p), why: "a new file" }, false);
      continue;
    }
    const files = found;
    const order = (f: string) => {
      const r = byWords.findIndex((x) => x.path === f);
      return (r < 0 ? 1000 : r) - (entries.has(f) ? 0.5 : 0);
    };
    for (const f of [...files].sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
      const sym = symbolAt(f);
      push(
        {
          path: f,
          line: sym?.line,
          symbol: sym?.name,
          kind: sym?.kind,
          element: ownerOf(f),
          why: files.length === 1 ? "you named it" : `under ${p}`,
        },
        files.length > 1,
      );
    }
  }

  // 2. Files that match the words: names, symbols, the owning element, journey steps.
  const ranked = byWords.slice(0, 60);
  const top = ranked[0]?.score ?? 0;
  for (const r of ranked) {
    if (r.score < top * 0.2) break;
    const p = pointAt(r);
    push({
      path: r.path,
      line: p.line,
      symbol: p.name,
      kind: p.kind,
      element: ownerOf(r.path),
      why: r.why.slice(0, 2).join("; "),
    });
  }

  // 3. Without an index (or to fill up): the model's own pointers into the code.
  if (start.length < Math.min(limit, 3)) {
    for (const h of hits) {
      if (h.type === "journey") {
        const j = model.journeys.get(h.id);
        for (const s of j?.steps ?? []) {
          if (!s.spec.code) continue;
          const path = stepCodePath(s.spec.code);
          push({
            path,
            element: ownerOf(path),
            why: `journey ${h.id} step ${s.index + 1}${s.spec.action ? `: ${s.spec.action}` : ""}`,
          });
        }
      } else if (h.type === "element") {
        const e = model.elements.get(h.id);
        for (const c of e?.code ?? []) {
          if (/[*?{]/.test(c.path)) continue;
          push({
            path: normalizePath(c.path),
            symbol: c.symbol,
            element: e?.id,
            why: c.description ?? `code of ${h.id}`,
          });
        }
      }
    }
  }

  // Where the container wires the first start files in (index files, command registries).
  if (index) {
    const view = viewOf(index);
    for (const s of start.slice(0, 3)) {
      const e = s.element ? model.elements.get(s.element) : undefined;
      if (!e?.parentId) continue;
      const containers = new Set(ancestors(model, e).map((a) => a.id));
      const wired = view
        .importersOf(s.path)
        .filter((c) => !isTestFile(c.file) && !seen.has(c.file))
        .filter((c) => {
          const owner = ownerOf(c.file);
          return owner !== undefined && containers.has(owner);
        })
        .slice(0, 2);
      if (wired.length) s.wiredIn = wired.map((c) => ({ path: c.file, line: c.line }));
    }
  }

  // The elements involved: the owners of the start files, or what the words match.
  const elementIds = [
    ...new Set(start.flatMap((s) => (s.element ? [s.element] : []))),
    ...(start.length ? [] : hits.filter((h) => h.type === "element").map((h) => h.id)),
  ].slice(0, 6);
  const elements = elementIds.flatMap((id) => model.elements.get(id) ?? []);
  const chain = new Set<string>();
  for (const e of elements) for (const a of [e, ...ancestors(model, e)]) chain.add(a.id);

  const startPaths = new Set(start.map((s) => s.path));
  const terms = queryTerms(text);
  const matchesQuery = (name: string) =>
    splitIdentifier(name).some((t) => terms.some((q) => sameWord(q, t)));

  return {
    query,
    paths: named,
    start,
    elements: elements.map((e) => ({ id: e.id, kind: e.spec.kind })),
    sameJob: index ? sameJob(model, index, start, matchesQuery) : [],
    data: dataFor(model, elements, chain, matchesQuery),
    rules: rulesMentioning(
      model,
      new Set([...chain].flatMap((id) => [id, id.split(".").pop() as string])),
    ).map((r) => ({ id: r.id, description: r.description })),
    ...journeysFor(model, elements, startPaths),
    tests: index ? testsFor(index, start) : [],
    owners: [
      ...new Set(
        elements.flatMap((e) => [...ancestors(model, e), e].flatMap((x) => x.spec.owners ?? [])),
      ),
    ],
    usedBy: usedBy(model, elements, chain),
    journeysElsewhere: journeysElsewhere(model, elements),
  };
}

/** Journeys in other repos that pass through the elements, so a change here can break them. */
function journeysElsewhere(
  model: Model,
  elements: ElementNode[],
): ContextBrief["journeysElsewhere"] {
  const out = new Map<string, { id: string; importance: string; steps: number[] }>();
  for (const e of elements) {
    const r = impact(model, e.id);
    if (!r.ok) continue;
    for (const j of r.impact.elsewhere.journeys) {
      const id = `${j.namespace}.${j.journey.id}`;
      const seen = out.get(id);
      if (seen) seen.steps = [...new Set([...seen.steps, ...j.steps])].sort((a, b) => a - b);
      else
        out.set(id, { id, importance: j.journey.spec.importance ?? "normal", steps: [...j.steps] });
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      (IMPORTANCE[a.importance] ?? 9) - (IMPORTANCE[b.importance] ?? 9) || a.id.localeCompare(b.id),
  );
}

/** Who uses the elements directly, leaving out the elements themselves and their parents. */
function usedBy(model: Model, elements: ElementNode[], chain: Set<string>): ContextBrief["usedBy"] {
  const out = {
    elements: new Set<string>(),
    actors: new Set<string>(),
    elsewhere: new Set<string>(),
  };
  for (const e of elements) {
    const r = impact(model, e.id);
    if (!r.ok) continue;
    for (const c of r.impact.consumers) {
      if (c.depth !== 1) continue;
      const from = c.relationship.from;
      if (from.type === "actor") out.actors.add(from.id);
      else if (from.type === "element" && !chain.has(from.id)) out.elements.add(from.id);
    }
    for (const c of r.impact.elsewhere.consumers) {
      if (c.reach === "direct") out.elsewhere.add(c.from);
    }
  }
  return {
    elements: [...out.elements].sort(),
    actors: [...out.actors].sort(),
    elsewhere: [...out.elsewhere].sort(),
  };
}

function ancestors(model: Model, e: ElementNode): ElementNode[] {
  const out: ElementNode[] = [];
  for (let p = e.parentId; p; p = model.elements.get(p)?.parentId) {
    const parent = model.elements.get(p);
    if (parent) out.unshift(parent);
  }
  return out;
}

/**
 * Other callers of what the start files use from other elements (and of what
 * they declare that the question names): code that does the same job, which
 * a fix in one place usually needs too.
 */
function sameJob(
  model: Model,
  index: CodeIndex,
  start: ContextStart[],
  matchesQuery: (name: string) => boolean,
): ContextSameJob[] {
  const view = viewOf(index);
  const elementOf = (path: string) => locate(model, path).element?.id;
  const out: (ContextSameJob & { rank: number })[] = [];
  const seen = new Set<string>();

  const add = (
    via: string,
    decl: string,
    name: string,
    relation: "imports" | "declares",
    bonus: number,
  ) => {
    const key = `${decl}\0${name}`;
    if (seen.has(key)) return;
    const sym = view.sources.get(decl)?.exports.find((e) => e.name === name);
    if (sym && !VALUE_KINDS.has(sym.kind)) return;
    const callers = view
      .callersOf(decl, name)
      .filter((c) => c.file !== via && !isTestFile(c.file))
      .filter((c) => relation === "declares" || elementOf(c.file) !== elementOf(decl));
    if (callers.length === 0) return;
    seen.add(key);
    // Few callers say more than many: a helper everything uses is no hint.
    const rank = bonus + (matchesQuery(name) ? 4 : 0) + 1 / callers.length;
    out.push({
      symbol: name,
      declaredIn: decl,
      element: elementOf(decl),
      relation,
      via,
      callers: callers.slice(0, 3).map((c) => ({ path: c.file, line: c.line })),
      more: Math.max(0, callers.length - 3),
      rank,
    });
  };

  start.slice(0, 3).forEach((s, i) => {
    const bonus = (3 - i) * 0.5;
    const src = view.sources.get(s.path);
    if (!src) return;
    const own = elementOf(s.path);
    for (const imp of src.imports) {
      if (imp.reexport || imp.typeOnly) continue;
      for (const n of imp.names) {
        if (n.typeOnly || n.name === "*" || n.name === "default") continue;
        const decl = view.declaration(imp.target, n.name);
        // From another element: not its own helpers, nor its container's.
        if (!decl || related(model, own, elementOf(decl))) continue;
        add(s.path, decl, n.name, "imports", bonus);
      }
    }
    if (s.symbol && matchesQuery(s.symbol)) add(s.path, s.path, s.symbol, "declares", bonus + 1);
  });
  return out
    .sort((a, b) => b.rank - a.rank || a.symbol.localeCompare(b.symbol))
    .slice(0, 4)
    .map(({ rank: _, ...rest }) => rest);
}

/** Whether element `a` is `b` or inside it. */
function inside(model: Model, a: string | undefined, b: string): boolean {
  for (let p = a; p; p = model.elements.get(p)?.parentId) if (p === b) return true;
  return false;
}

/** Whether two elements are the same, or one contains the other. */
function related(model: Model, a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return a === b;
  const inside = (x: string, y: string) => {
    for (let p: string | undefined = x; p; p = model.elements.get(p)?.parentId)
      if (p === y) return true;
    return false;
  };
  return inside(a, b) || inside(b, a);
}

function dataFor(
  model: Model,
  elements: ElementNode[],
  chain: Set<string>,
  matchesQuery: (name: string) => boolean,
): ContextBrief["data"] {
  const own = new Set(elements.map((e) => e.id));
  // An element's own flows, then its container's; never the whole system's.
  const inScope = (t: Target) =>
    t.type === "element" &&
    chain.has(t.id) &&
    (own.has(t.id) || model.elements.get(t.id)?.spec.kind !== "system");
  const name = (t: Target) => (t.type === "external" ? t.ref : t.id.split(".").pop());
  const found = new Map<string, { how: string; rank: number }>();
  const note = (data: string, how: string, rank: number) => {
    const prev = found.get(data);
    if (!prev || prev.rank < rank) found.set(data, { how, rank });
  };
  for (const f of dataFlows(model)) {
    if (!inScope(f.from) && !inScope(f.to)) continue;
    const direct =
      (f.from.type === "element" && own.has(f.from.id)) ||
      (f.to.type === "element" && own.has(f.to.id));
    note(f.data, `${name(f.from)} → ${name(f.to)}`, direct ? 2 : 1);
  }
  for (const s of dataStores(model)) {
    if (chain.has(s.element)) note(s.data, `stored in ${s.element} (${s.table})`, 2);
  }
  for (const d of model.data.values()) {
    if (matchesQuery(d.id) || Object.keys(d.spec.fields ?? {}).some(matchesQuery)) {
      note(d.id, found.get(d.id)?.how ?? "matches the question", 3);
    }
  }
  return [...found.entries()]
    .sort((a, b) => b[1].rank - a[1].rank || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([id, v]) => ({ id, kind: model.data.get(id)?.spec.kind ?? "data", how: v.how }));
}

function journeysFor(
  model: Model,
  elements: ElementNode[],
  startPaths: Set<string>,
): Pick<ContextBrief, "journeys" | "journeysThrough"> {
  const keys = new Set<string>();
  for (const e of elements) {
    keys.add(`element:${e.id}`);
    for (const a of ancestors(model, e)) if (a.spec.kind !== "system") keys.add(`element:${a.id}`);
    const stack = [...e.childIds];
    while (stack.length) {
      const id = stack.pop() as string;
      keys.add(`element:${id}`);
      stack.push(...(model.elements.get(id)?.childIds ?? []));
    }
  }
  const globs = [...startPaths].map((p) => ({ p, re: compileGlob(p) }));
  const journeys: ContextJourney[] = [];
  const through: ContextBrief["journeysThrough"] = [];
  for (const j of model.journeys.values()) {
    const importance = j.spec.importance ?? "normal";
    const naming = j.steps.flatMap((s) => {
      if (!s.spec.code) return [];
      const code = stepCodePath(s.spec.code);
      const file = globs.find((g) => g.p === code || g.re.test(code))?.p;
      return file ? [{ step: s.index + 1, file }] : [];
    });
    if (naming.length) {
      journeys.push({
        id: j.id,
        goal: j.spec.goal,
        importance,
        steps: naming.map((n) => n.step),
        // The best-ranked start file it names.
        file: globs.find((g) => naming.some((n) => n.file === g.p))?.p ?? "",
      });
    } else if (
      j.steps.some(
        (s) => (s.from && keys.has(nodeKey(s.from))) || (s.to && keys.has(nodeKey(s.to))),
      )
    ) {
      through.push({ id: j.id, importance });
    }
  }
  const order = (a: { importance: string; id: string }, b: { importance: string; id: string }) =>
    (IMPORTANCE[a.importance] ?? 2) - (IMPORTANCE[b.importance] ?? 2) || a.id.localeCompare(b.id);
  return { journeys: journeys.sort(order), journeysThrough: through.sort(order) };
}

/** Where a test's package starts: the directory above its test/ folder, or its own directory. */
function testRoot(test: string): string {
  const m = test.match(/^(.*?\/)?(?:test|tests|__tests__)\//);
  if (m) return m[1] ?? "";
  return test.slice(0, test.lastIndexOf("/") + 1);
}

function sharedDirs(a: string, b: string): number {
  const x = a.split("/").slice(0, -1);
  const y = b.split("/").slice(0, -1);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

/** Tests with the same name as a start file, or that import what a start file declares. */
function testsFor(index: CodeIndex, start: ContextStart[]): ContextBrief["tests"] {
  const view = viewOf(index);
  const found = new Map<string, { why: Set<string>; rank: number }>();
  const note = (path: string, why: string, rank: number) => {
    const t = found.get(path) ?? { why: new Set<string>(), rank: 0 };
    t.why.add(why);
    t.rank += rank;
    found.set(path, t);
  };
  const tests = view.files.filter(isTestFile);
  start.forEach((s, i) => {
    const weight = start.length - i;
    const stem = fileStem(s.path);
    // The same name, nearest first: packages/core/test/x.test.ts for packages/core/src/x.ts.
    const same = tests
      .filter((t) => fileStem(t) === stem && s.path.startsWith(testRoot(t)))
      .map((t) => ({ t, shared: sharedDirs(t, s.path) }));
    const nearest = Math.max(0, ...same.map((x) => x.shared));
    for (const x of same) if (x.shared === nearest) note(x.t, "same name", 10 * weight);
    const src = view.sources.get(s.path);
    const exports = [...(src?.exports ?? [])].sort(
      (a, b) => Number(b.name === s.symbol) - Number(a.name === s.symbol),
    );
    for (const e of exports) {
      if (!VALUE_KINDS.has(e.kind)) continue;
      for (const c of view.callersOf(s.path, e.name)) {
        if (isTestFile(c.file)) note(c.file, `imports ${e.name}`, weight);
      }
    }
  });
  return [...found.entries()]
    .sort((a, b) => b[1].rank - a[1].rank || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([path, t]) => ({ path, why: [...t.why].slice(0, 2).join(", ") }));
}
