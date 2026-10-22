import { locate } from "../codemap/codemap.js";
import { compileGlob, normalizePath } from "../codemap/glob.js";
import type { ElementNode, Model } from "../model.js";
import { queryTerms, sameWord, splitIdentifier } from "./terms.js";

// The repository's code as plain data, for ranking files and symbols against
// a question. @archdoc/analyzers builds it (`indexCode`); core only reads it,
// so ranking stays deterministic and runs anywhere.

export type SymbolKind =
  | "function"
  | "class"
  | "const"
  | "let"
  | "var"
  | "interface"
  | "type"
  | "enum"
  | "default";

/** A declaration a file exports. */
export interface IndexedSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based line of the declaration. */
  line: number;
}

/** An `import { a, b } from "x"` (or `export { a } from "x"`). */
export interface IndexedImport {
  specifier: string;
  /** The repository file, or the workspace package's directory, it resolves to. */
  target?: string | undefined;
  /** 1-based line of the statement. */
  line: number;
  typeOnly?: boolean | undefined;
  /** `export … from`: the file passes the names on rather than using them. */
  reexport?: boolean | undefined;
  names: {
    /** The exported name ("default" for a default import, "*" for `export *`). */
    name: string;
    /** The local name, when it differs. */
    local?: string | undefined;
    typeOnly?: boolean | undefined;
    /** 1-based line the name is first used on, after the import. */
    line?: number | undefined;
  }[];
}

export interface IndexedSource {
  path: string;
  exports: IndexedSymbol[];
  imports: IndexedImport[];
  /** String literals that read as identifiers, such as tool names (archdoc_check), with their first line. */
  literals?: { text: string; line: number }[] | undefined;
}

export interface CodeIndex {
  /** Every repository file, relative to the root. */
  files: string[];
  /** TS/JS files: what they export and import. */
  sources: IndexedSource[];
}

const TEST =
  /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)conftest\.py$/;
const CODE =
  /\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|cs|php|swift|scala|vue|svelte|sql|proto|prisma)$/;
/** Files that are never where a change starts: lockfiles, generated output, the model itself. */
const NOISE =
  /(^|\/)(node_modules|dist|coverage|\.changeset|\.archdoc)\/|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|archdoc\.lock|CHANGELOG\.md)$/;

export function isTestFile(path: string): boolean {
  return TEST.test(path);
}

export function isCodeFile(path: string): boolean {
  return CODE.test(path);
}

/** A file name without its directory, extensions, or test suffix: pr-report.test.ts → pr-report. */
export function fileStem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base
    .replace(/\.(test|spec)(?=\.)/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/\.d$/, "");
}

interface FileDoc {
  path: string;
  base: Set<string>;
  dirs: Set<string>;
  symbols: { sym: IndexedSymbol; tokens: string[] }[];
  literals: Set<string>;
  /** Literals as written, lowercased, with their first line. */
  literalRaw: Map<string, number>;
  /** Every word the file itself has: path, symbols, literals. */
  own: Set<string>;
  test: boolean;
  code: boolean;
  noise: boolean;
}

interface CallSite {
  file: string;
  line: number;
  name: string;
}

/** What core derives from an index once: words per file, and who imports what. */
class IndexView {
  readonly docs = new Map<string, FileDoc>();
  readonly sources = new Map<string, IndexedSource>();
  readonly files: string[];
  readonly fileSet: Set<string>;
  readonly df = new Map<string, number>();
  readonly vocab: string[];
  /** Ranked documents (not tests, not noise). */
  readonly ranked: number;
  private declCache = new Map<string, string | undefined>();
  private callers?: Map<string, CallSite[]>;
  private byTarget?: Map<string, CallSite[]>;

  constructor(readonly index: CodeIndex) {
    this.files = index.files.map(normalizePath);
    this.fileSet = new Set(this.files);
    for (const s of index.sources) this.sources.set(normalizePath(s.path), s);
    let ranked = 0;
    for (const path of this.files) {
      const src = this.sources.get(path);
      const parts = path.split("/");
      const baseName = parts.pop() ?? path;
      const base = new Set(splitIdentifier(baseName.replace(/\.[^.]+$/, "")).map(stem));
      const dirs = new Set(parts.flatMap((p) => splitIdentifier(p)).map(stem));
      const symbols = (src?.exports ?? []).map((sym) => ({
        sym,
        tokens: splitIdentifier(sym.name).map(stem),
      }));
      const literalRaw = new Map((src?.literals ?? []).map((l) => [l.text.toLowerCase(), l.line]));
      // Tool and command names (archdoc_check); kebab-case literals are mostly CSS classes.
      const literals = new Set(
        [...literalRaw.keys()]
          .filter((l) => l.includes("_"))
          .flatMap((l) => splitIdentifier(l))
          .map(stem),
      );
      const own = new Set([...base, ...dirs, ...symbols.flatMap((s) => s.tokens), ...literals]);
      const doc: FileDoc = {
        path,
        base,
        dirs,
        symbols,
        literals,
        literalRaw,
        own,
        test: isTestFile(path),
        code: isCodeFile(path),
        noise: NOISE.test(path),
      };
      this.docs.set(path, doc);
      if (doc.test || doc.noise) continue;
      ranked++;
      for (const t of own) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.ranked = ranked;
    this.vocab = [...this.df.keys()];
  }

  /**
   * The file that declares `name` as reached through `target` (a file or a
   * package directory), following `export … from` through index files.
   */
  declaration(target: string | undefined, name: string, depth = 0): string | undefined {
    if (!target || depth > 6) return undefined;
    const key = `${target}\0${name}`;
    if (this.declCache.has(key)) return this.declCache.get(key);
    this.declCache.set(key, undefined);
    let found: string | undefined;
    const src = this.sources.get(target);
    if (src) {
      if (src.exports.some((e) => e.name === name)) {
        found = target;
      } else {
        for (const imp of src.imports) {
          if (!imp.reexport) continue;
          const named = imp.names.find((n) => (n.local ?? n.name) === name);
          if (named) found = this.declaration(imp.target, named.name, depth + 1);
          else if (imp.names.some((n) => n.name === "*"))
            found = this.declaration(imp.target, name, depth + 1);
          if (found) break;
        }
      }
    } else if (!this.fileSet.has(target)) {
      // A package directory: its entry point, or the one file under it that declares the name.
      const dir = target === "." ? "" : `${target}/`;
      for (const entry of [
        "src/index.ts",
        "src/index.tsx",
        "index.ts",
        "src/index.js",
        "index.js",
      ]) {
        if (this.sources.has(dir + entry)) {
          found = this.declaration(dir + entry, name, depth + 1);
          if (found) break;
        }
      }
      if (!found) {
        const declaring = [...this.sources.values()].filter(
          (s) =>
            s.path.startsWith(dir) && !isTestFile(s.path) && s.exports.some((e) => e.name === name),
        );
        if (declaring.length === 1) found = declaring[0]?.path;
      }
    }
    this.declCache.set(key, found);
    return found;
  }

  /** Every place that imports a declaration and uses it, keyed by `file\0name` of the declaration. */
  callSites(): Map<string, CallSite[]> {
    if (this.callers) return this.callers;
    const out = new Map<string, CallSite[]>();
    for (const src of this.sources.values()) {
      for (const imp of src.imports) {
        if (imp.reexport) continue;
        for (const n of imp.names) {
          if (n.name === "*" || n.name === "default") continue;
          const decl = this.declaration(imp.target, n.name);
          if (!decl) continue;
          const key = `${decl}\0${n.name}`;
          const list = out.get(key) ?? [];
          list.push({ file: src.path, line: n.line ?? imp.line, name: n.name });
          out.set(key, list);
        }
      }
    }
    this.callers = out;
    return out;
  }

  /** Files that import (or re-export) a file directly, with the line of the statement. */
  importersOf(file: string): CallSite[] {
    if (!this.byTarget) {
      this.byTarget = new Map();
      for (const src of this.sources.values()) {
        for (const imp of src.imports) {
          if (!imp.target) continue;
          const list = this.byTarget.get(imp.target) ?? [];
          if (!list.some((c) => c.file === src.path)) {
            list.push({ file: src.path, line: imp.line, name: imp.names[0]?.name ?? "*" });
          }
          this.byTarget.set(imp.target, list);
        }
      }
    }
    return this.byTarget.get(file) ?? [];
  }

  /** Where a declared symbol is imported and used. */
  callersOf(file: string, name: string): CallSite[] {
    return this.callSites().get(`${file}\0${name}`) ?? [];
  }
}

const views = new WeakMap<CodeIndex, IndexView>();

export function viewOf(index: CodeIndex): IndexView {
  let v = views.get(index);
  if (!v) {
    v = new IndexView(index);
    views.set(index, v);
  }
  return v;
}

export type { IndexView };

function stem(word: string): string {
  return word.length > 3 && !word.endsWith("ss") ? word.replace(/s$/, "") : word;
}

export interface RankedFile {
  path: string;
  score: number;
  /** How many of the question's words the file matched. */
  matched: number;
  /** The question's words. */
  terms: number;
  /** The exported declaration that best matches, or the file's main one. */
  symbol?: IndexedSymbol | undefined;
  /** A string the file registers that matched, such as a tool name, when no declaration did better. */
  literal?: { text: string; line: number } | undefined;
  /** Why it ranks: which words matched where. */
  why: string[];
  /** The element that owns the file. */
  element?: string | undefined;
}

const FIELD_LABEL: Record<string, string> = {
  name: "file name",
  path: "folder",
  element: "its element says",
};

const KIND_ORDER: Partial<Record<SymbolKind, number>> = {
  function: 3,
  class: 3,
  const: 2,
  enum: 1,
};

interface Weights {
  base: number;
  dirs: number;
  symbol: number;
  literal: number;
  owner: number;
  ownerText: number;
  step: number;
}

const W: Weights = {
  base: 3,
  dirs: 1.5,
  symbol: 2.5,
  literal: 1,
  owner: 1,
  ownerText: 0.5,
  step: 1,
};

/** Raw identifier-like words of a question, as written: archdoc_check, loadModelAtRef, pr-report.ts. */
export function rawTokens(query: string): string[] {
  return query
    .split(/[^A-Za-z0-9_./-]+/)
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter((t) => t.length > 1);
}

/** Journey steps whose `code:` names each file. */
export function journeyEntryPoints(
  model: Model,
): Map<string, { journey: string; step: number; action?: string | undefined }[]> {
  const out = new Map<string, { journey: string; step: number; action?: string | undefined }[]>();
  for (const j of model.journeys.values()) {
    for (const s of j.steps) {
      if (!s.spec.code) continue;
      const path = stepCodePath(s.spec.code);
      const list = out.get(path) ?? [];
      list.push({ journey: j.id, step: s.index + 1, action: s.spec.action });
      out.set(path, list);
    }
  }
  return out;
}

/** A step's `code:` as a repository path, without a `#symbol` or `:line` suffix. */
export function stepCodePath(code: string): string {
  return normalizePath(code.replace(/#.*$/, "").replace(/:\d+(?:-\d+)?$/, ""));
}

/**
 * Ranks the repository's files for a question: words in the file's name and
 * directories, in the names it exports and the tool names it registers, in
 * the element that owns it, and in the journey steps that name it. Rare words
 * count more than common ones (inverse document frequency), and files that
 * match more of the words rank first. Test files and lockfiles are left out.
 */
export function rankFiles(model: Model, index: CodeIndex, query: string, limit = 20): RankedFile[] {
  const view = viewOf(index);
  const terms = queryTerms(query);
  const raw = rawTokens(query).map((t) => t.toLowerCase());
  if (terms.length === 0 && raw.length === 0) return [];

  // Which words of the code each question word matches, and how rare it is.
  const matches = new Map<string, Set<string>>();
  const idf = new Map<string, number>();
  for (const q of terms) {
    const same = new Set(view.vocab.filter((t) => sameWord(q, t)));
    same.add(q);
    matches.set(q, same);
    let df = 0;
    for (const doc of view.docs.values()) {
      if (doc.test || doc.noise) continue;
      for (const t of same)
        if (doc.own.has(t)) {
          df++;
          break;
        }
    }
    idf.set(q, Math.log(1 + view.ranked / (1 + df)));
  }
  const maxIdf = Math.max(1, ...idf.values());

  const elementWords = new Map<string, { name: Set<string>; text: Set<string> }>();
  const wordsOf = (e: ElementNode) => {
    let w = elementWords.get(e.id);
    if (!w) {
      w = {
        name: new Set(splitIdentifier(`${e.key} ${e.spec.name ?? ""}`).map(stem)),
        text: new Set(
          splitIdentifier(`${e.spec.description ?? ""} ${e.spec.technology ?? ""}`).map(stem),
        ),
      };
      elementWords.set(e.id, w);
    }
    return w;
  };
  const entries = journeyEntryPoints(model);
  const has = (set: Set<string>, q: string) => {
    for (const t of matches.get(q) ?? []) if (set.has(t)) return true;
    return false;
  };

  const out: RankedFile[] = [];
  for (const doc of view.docs.values()) {
    if (doc.test || doc.noise) continue;
    const owner = locate(model, doc.path).element;
    const ownerWords = owner ? wordsOf(owner) : undefined;
    const steps = entries.get(doc.path) ?? [];
    const stepWords = new Set(
      steps.flatMap((s) => splitIdentifier(s.action ?? "")).map((w) => stem(w)),
    );

    let score = 0;
    let matched = 0;
    const where = new Map<string, string[]>();
    const note = (field: string, q: string) => {
      const list = where.get(field) ?? [];
      list.push(q);
      where.set(field, list);
    };
    const symbolScore = new Map<IndexedSymbol, number>();
    let literal: { text: string; line: number; exact: boolean } | undefined;
    for (const q of terms) {
      let best = 0;
      let field = "";
      const consider = (w: number, f: string) => {
        if (w > best) {
          best = w;
          field = f;
        }
      };
      if (has(doc.base, q)) consider(W.base, "name");
      if (has(doc.dirs, q)) consider(W.dirs, "path");
      for (const s of doc.symbols) {
        if (s.tokens.some((t) => matches.get(q)?.has(t))) {
          consider(W.symbol, "exports");
          symbolScore.set(s.sym, (symbolScore.get(s.sym) ?? 0) + (idf.get(q) ?? 0));
        }
      }
      if (has(doc.literals, q)) {
        consider(W.literal, "registers");
        if (!literal) {
          for (const [text, line] of doc.literalRaw) {
            if (
              text.includes("_") &&
              splitIdentifier(text).some((t) => matches.get(q)?.has(stem(t)))
            ) {
              literal = { text, line, exact: false };
              break;
            }
          }
        }
      }
      if (ownerWords && has(ownerWords.name, q)) consider(W.owner, "element");
      if (ownerWords && has(ownerWords.text, q)) consider(W.ownerText, "element");
      if (has(stepWords, q)) consider(W.step, "journey step");
      if (best > 0) {
        matched++;
        score += best * (idf.get(q) ?? 0);
        note(field, q);
      }
    }
    // A name written exactly as the code has it: a function, a tool name, a file.
    let exact: IndexedSymbol | undefined;
    for (const r of raw) {
      const sym = doc.symbols.find((s) => s.sym.name.toLowerCase() === r);
      const line = doc.literalRaw.get(r);
      if (sym && /[A-Z_]/.test(sym.sym.name)) {
        score += 3 * maxIdf;
        exact = sym.sym;
        note("exports", sym.sym.name);
      } else if (line !== undefined && /[_-]/.test(r)) {
        score += 2 * maxIdf;
        literal = { text: r, line, exact: true };
        note("registers", r);
      } else if (r.includes(".") && r.length > 3 && doc.path.toLowerCase().endsWith(r)) {
        score += 4 * maxIdf;
        note("name", r);
      }
    }
    if (score <= 0) continue;
    // Files that match more of the words rank first.
    if (terms.length) score *= Math.sqrt(Math.max(matched, 1) / terms.length);
    if (!doc.code) score *= 0.4;
    if (steps.length) score *= 1.15;

    // The declaration to open: an exact name, else the best match (functions before types).
    const stemWords = splitIdentifier(fileStem(doc.path)).join(" ");
    const rankSym = (sym: IndexedSymbol) =>
      (symbolScore.get(sym) ?? 0) +
      (KIND_ORDER[sym.kind] ?? 0) * 0.01 +
      (splitIdentifier(sym.name).join(" ") === stemWords ? 0.05 : 0);
    const symbol =
      exact ??
      [...symbolScore.keys()].sort((a, b) => rankSym(b) - rankSym(a) || a.line - b.line)[0] ??
      (literal?.exact ? undefined : mainSymbol(doc.symbols.map((s) => s.sym)));
    const why: string[] = [];
    for (const [field, qs] of where) {
      const words = [...new Set(qs)].join(", ");
      why.push(
        field === "exports" && symbol
          ? `exports ${symbol.name}`
          : field === "registers"
            ? `registers ${literal?.text ?? words}`
            : field === "journey step"
              ? `journey ${steps[0]?.journey} step ${steps[0]?.step}`
              : `${FIELD_LABEL[field] ?? field}: ${words}`,
      );
    }
    out.push({
      path: doc.path,
      score,
      matched,
      terms: terms.length,
      symbol,
      literal:
        literal && (literal.exact || !symbolScore.size)
          ? { text: literal.text, line: literal.line }
          : undefined,
      why: [...new Set(why)],
      element: owner?.id,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

/** What to point at in a ranked file: a tool name it registers that matched exactly, else its symbol. */
export function pointAt(r: RankedFile): { name?: string; line?: number; kind?: SymbolKind } {
  if (r.literal && (!r.symbol || r.literal.text.includes("_"))) {
    return { name: `"${r.literal.text}"`, line: r.literal.line };
  }
  return { name: r.symbol?.name, line: r.symbol?.line, kind: r.symbol?.kind };
}

/** A file's main declaration: its first exported function or class, else its first export. */
export function mainSymbol(symbols: IndexedSymbol[]): IndexedSymbol | undefined {
  return (
    symbols.find((s) => s.kind === "function" || s.kind === "class") ??
    symbols.find((s) => s.kind !== "type" && s.kind !== "interface") ??
    symbols[0]
  );
}

/** Files in the index that a path names: the file itself, or the files under a directory or glob. */
export function filesNamed(index: CodeIndex, path: string): string[] {
  const view = viewOf(index);
  const p = normalizePath(path).replace(/\/+$/, "");
  if (view.fileSet.has(p)) return [p];
  const re = compileGlob(p);
  return view.files.filter((f) => re.test(f));
}
