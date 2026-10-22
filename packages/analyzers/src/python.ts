import { posix } from "node:path";
import type { IndexedImport, IndexedSource, IndexedSymbol } from "@archdoc/core";
import type { Analyzer, AnalyzerContext, ObservedDependency } from "./api.js";

// Python, read as text: no Python at runtime and no parser dependency. A small
// lexer blanks out strings and comments, joins logical lines (brackets and
// backslash continuations), and tracks indentation, which is enough to find
// imports, `if TYPE_CHECKING:` blocks, and module-level declarations.

const SOURCE = /\.py$/;
/** Virtual environments, caches, and installed packages: never the repository's own code. */
const SKIP = /(^|\/)(node_modules|\.venv|venv|__pycache__|site-packages|\.tox)\//;
/** Files that mark a Python project's root, whose directory is on its import path. */
const PROJECT = /(^|\/)(pyproject\.toml|setup\.py|setup\.cfg)$/;
/** String literals that read as identifiers with parts, as in symbols.ts. */
const LITERAL = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/;
const MAX_LITERALS = 100;

const ID = "[\\p{L}_][\\p{L}\\p{N}_]*";
const DOTTED = `${ID}(?:\\s*\\.\\s*${ID})*`;
const IMPORT = /^import\s+(.+)$/su;
const FROM = new RegExp(`^from\\s+(\\.*)\\s*(${DOTTED})?\\s*\\bimport\\b\\s*(.*)$`, "su");
const IMPORT_PART = new RegExp(`^(${DOTTED})(?:\\s+as\\s+(${ID}))?$`, "u");
const FROM_PART = new RegExp(`^(${ID}|\\*)(?:\\s+as\\s+(${ID}))?$`, "u");
const HEADER =
  /^(?:if|elif|else|try|except|finally|with|for|while|def|class|async\s+(?:def|for|with))\b/;
const DEF = new RegExp(`^(?:async\\s+)?def\\s+(${ID})`, "u");
const CLASS = new RegExp(`^class\\s+(${ID})`, "u");
const TYPE_CHECKING_IF = /^if\s+(?:[\p{L}_][\p{L}\p{N}_]*\s*\.\s*)?TYPE_CHECKING\s*$/u;
const NAME = new RegExp(`^${ID}$`, "u");
const ANNOTATED = new RegExp(`^(${ID})\\s*:.+$`, "su");
const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;
const STRING_PREFIX = /^(?:[rRuUbBfFtT]|[rR][bBfFtT]|[bBfFtT][rR])$/;

/**
 * Imports between Python files: `import a.b`, `from a.b import c`, and relative
 * `from . import x` / `from ..pkg import y`, including parenthesized multi-line
 * imports and imports inside functions. Imports in `if TYPE_CHECKING:` blocks
 * are type-only. Only imports that resolve to a repository file are reported;
 * the standard library and third-party packages are ignored.
 */
export const pythonImports: Analyzer = {
  name: "python-imports",
  async analyze(ctx) {
    const roots = pythonRoots(ctx);
    const files = new Set(ctx.files.filter((f) => !SKIP.test(f)));
    const out: ObservedDependency[] = [];
    for (const file of ctx.files) {
      if (!SOURCE.test(file) || SKIP.test(file)) continue;
      const text = await ctx.read(file);
      const resolve = (spec: string) => resolvePythonModule(file, spec, files, roots);
      for (const imp of parsePython(text).imports) {
        const seen = new Set<string>();
        for (const { target } of targetsOf(imp, resolve)) {
          if (!target || seen.has(target)) continue;
          seen.add(target);
          out.push({
            from: file,
            to: target,
            analyzer: "python-imports",
            specifier: imp.module,
            line: imp.line,
            typeOnly: imp.typeOnly || undefined,
          });
        }
      }
    }
    return out;
  },
};

/**
 * The directories absolute imports are resolved against, in order: the
 * repository root, `src/` when it holds Python, and every directory with a
 * `pyproject.toml`, `setup.py`, or `setup.cfg` (and its `src/`). Resolution
 * also tries, first, the directory above each file's outermost package.
 */
export function pythonRoots(ctx: Pick<AnalyzerContext, "files">): string[] {
  const files = ctx.files.filter((f) => !SKIP.test(f));
  const hasPython = (dir: string) => files.some((f) => f.startsWith(`${dir}/`) && SOURCE.test(f));
  const extra = new Set<string>();
  if (hasPython("src")) extra.add("src");
  for (const f of files) {
    if (!PROJECT.test(f)) continue;
    const dir = dirOf(f);
    if (dir) extra.add(dir);
    const src = dir ? `${dir}/src` : "src";
    if (hasPython(src)) extra.add(src);
  }
  return ["", ...[...extra].sort()];
}

/**
 * The repository file a module specifier names, as written in `from`: "a.b"
 * (absolute, against `roots`), or ".mod" / "..pkg.mod" / "." (relative to the
 * file's package). `a.b` is `a/b/__init__.py` or `a/b.py`. Undefined for a
 * module outside the repository (standard library, third-party).
 */
export function resolvePythonModule(
  from: string,
  specifier: string,
  files: ReadonlySet<string>,
  roots: readonly string[] = [""],
): string | undefined {
  const spec = specifier.replace(/\s+/g, "");
  const dots = /^\.*/.exec(spec)?.[0].length ?? 0;
  const rest = spec.slice(dots);
  const parts = rest ? rest.split(".") : [];
  if (parts.some((p) => !NAME.test(p))) return undefined;
  if (dots > 0) {
    let base = dirOf(from);
    for (let k = 1; k < dots; k++) {
      if (!base) return undefined;
      base = dirOf(base);
    }
    return moduleFile(joinPath(base, parts.join("/")), files, parts.length === 0);
  }
  if (!parts.length) return undefined;
  for (const root of rootsFor(from, files, roots)) {
    const found = moduleFile(joinPath(root, parts.join("/")), files, false);
    if (found) return found;
  }
  return undefined;
}

/** Every Python file's exports, imports, and literals, as `indexCode` does for TS/JS. */
export async function indexPythonCode(ctx: AnalyzerContext): Promise<IndexedSource[]> {
  const roots = pythonRoots(ctx);
  const files = new Set(ctx.files.filter((f) => !SKIP.test(f)));
  const out: IndexedSource[] = [];
  for (const path of ctx.files) {
    if (!SOURCE.test(path) || SKIP.test(path)) continue;
    let text: string;
    try {
      text = await ctx.read(path);
    } catch {
      continue;
    }
    out.push(
      indexPythonSource(path, text, (spec) => resolvePythonModule(path, spec, files, roots)),
    );
  }
  return out;
}

/**
 * One Python file's exports (module-level public `def`, `class`, and
 * assignments, narrowed to `__all__` when it is a literal list), the names it
 * imports with the line each is first used on, and identifier-like string
 * literals. `resolve` maps a module specifier as written (".models", "app.db")
 * to a repository path.
 */
export function indexPythonSource(
  path: string,
  text: string,
  resolve: (specifier: string) => string | undefined = () => undefined,
): IndexedSource {
  const parsed = parsePython(text);
  const all = parsed.all;
  const isInit = posix.basename(path) === "__init__.py";

  const exports: IndexedSymbol[] = [];
  const seen = new Set<string>();
  for (const d of parsed.defs) {
    if (d.name.startsWith("_") || seen.has(d.name)) continue;
    if (all && !all.includes(d.name)) continue;
    seen.add(d.name);
    exports.push(d);
  }

  const imports: IndexedImport[] = [];
  for (const imp of parsed.imports) {
    const groups = targetsOf(imp, resolve);
    for (const g of groups) {
      const entry: IndexedImport = {
        specifier: imp.module,
        target: g.target,
        line: imp.line,
        names: g.names.map((n) => {
          const out: IndexedImport["names"][number] = { name: n.name };
          if (n.local !== undefined && n.local !== n.name) out.local = n.local;
          const line = n.name === "*" && n.local === undefined ? undefined : imp.uses.get(n);
          if (line !== undefined) out.line = line;
          return out;
        }),
      };
      if (imp.typeOnly) entry.typeOnly = true;
      if (
        imp.kind === "from" &&
        (isInit ||
          g.names.some((n) => n.name === "*" || (all?.includes(n.local ?? n.name) ?? false)))
      ) {
        entry.reexport = true;
      }
      imports.push(entry);
    }
  }

  const out: IndexedSource = {
    path,
    exports: exports.sort((a, b) => a.line - b.line),
    imports,
  };
  if (parsed.literals.length) out.literals = parsed.literals;
  return out;
}

// --- Resolution -------------------------------------------------------------

interface ImportName {
  /** The imported name: a module's attribute or submodule, or "*" for the module itself. */
  name: string;
  local?: string | undefined;
}

/**
 * The targets one import statement reaches, with the names that reach each.
 * `from a import b` reaches `a/b.py` when b is a submodule, else `a`'s own file.
 */
function targetsOf(
  imp: ParsedImport,
  resolve: (spec: string) => string | undefined,
): { target: string | undefined; names: ImportName[] }[] {
  const groups = new Map<string | undefined, ImportName[]>();
  const add = (target: string | undefined, name: ImportName) => {
    const list = groups.get(target) ?? [];
    list.push(name);
    groups.set(target, list);
  };
  if (imp.kind === "import") {
    for (const n of imp.names) add(resolveOrParent(imp.module, resolve), n);
  } else {
    let own: { target: string | undefined } | undefined;
    for (const n of imp.names) {
      const sub = n.name === "*" ? undefined : resolve(joinModule(imp.module, n.name));
      if (sub) {
        add(sub, n);
        continue;
      }
      own ??= { target: resolveOrParent(imp.module, resolve) };
      add(own.target, n);
    }
  }
  return [...groups].map(([target, names]) => ({ target, names }));
}

/** `a.b.c`, or the closest enclosing package that resolves (`a.b`, then `a`). */
function resolveOrParent(
  spec: string,
  resolve: (spec: string) => string | undefined,
): string | undefined {
  let s = spec;
  for (;;) {
    const found = resolve(s);
    if (found) return found;
    const cut = s.lastIndexOf(".");
    if (cut < 0 || /^\.+$/.test(s)) return undefined;
    // "..pkg" → ".."; "a.b" → "a"
    s = /^\.+$/.test(s.slice(0, cut + 1)) ? s.slice(0, cut + 1) : s.slice(0, cut);
  }
}

function joinModule(spec: string, name: string): string {
  return spec.endsWith(".") ? spec + name : `${spec}.${name}`;
}

/**
 * Where absolute imports from `from` are looked up: the directory above its
 * outermost package (or its own directory, for a script), the project roots
 * that contain it (deepest first), then the rest.
 */
function rootsFor(from: string, files: ReadonlySet<string>, roots: readonly string[]): string[] {
  let top = dirOf(from);
  while (top && files.has(`${top}/__init__.py`)) top = dirOf(top);
  const containing = roots
    .filter((r) => r && from.startsWith(`${r}/`))
    .sort((a, b) => b.length - a.length);
  return [...new Set([top, ...containing, ...roots])];
}

function moduleFile(
  base: string,
  files: ReadonlySet<string>,
  packageOnly: boolean,
): string | undefined {
  const pkg = joinPath(base, "__init__.py");
  if (files.has(pkg)) return pkg;
  if (!packageOnly && base && files.has(`${base}.py`)) return `${base}.py`;
  return undefined;
}

function dirOf(path: string): string {
  const d = posix.dirname(path);
  return d === "." ? "" : d;
}

function joinPath(a: string, b: string): string {
  return a && b ? `${a}/${b}` : a || b;
}

// --- Parsing ----------------------------------------------------------------

interface ParsedImport {
  kind: "import" | "from";
  /** The module as written, without whitespace: "a.b", ".models", "..". */
  module: string;
  names: ImportName[];
  line: number;
  typeOnly: boolean;
  /** The line each name is first used on, after the statement. */
  uses: Map<ImportName, number>;
}

interface Parsed {
  imports: ParsedImport[];
  /** Module-level declarations, in order (including private names). */
  defs: IndexedSymbol[];
  /** `__all__`, when it is a literal list of strings. */
  all: string[] | undefined;
  literals: { text: string; line: number }[];
}

interface StringToken {
  start: number;
  end: number;
  value: string | undefined;
}

/** Reads a Python file's imports, module-level declarations, `__all__`, and literals. */
function parsePython(text: string): Parsed {
  const { masked, strings } = lex(text);
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const imports: (ParsedImport & { start: number; end: number })[] = [];
  const defs: IndexedSymbol[] = [];
  let all: string[] | undefined;
  let allDynamic = false;

  const simple = (stmt: Segment, typeOnly: boolean, nested: boolean) => {
    const flat = stmt.text.replace(/\\\r?\n/g, " ").trim();
    const line = lineOf(stmt.start);
    const end = stmt.start + stmt.text.length;
    const base = { line, typeOnly, start: stmt.start, end };
    let m = FROM.exec(flat);
    if (m && (m[1] || m[2])) {
      const module = `${m[1] ?? ""}${(m[2] ?? "").replace(/\s+/g, "")}`;
      // "from xyz import" needs a space unless the module is only dots.
      if (m[2] && !/^from\s+\.*\s*\S+\s+import\b/su.test(flat)) return;
      const list = (m[3] ?? "").trim().replace(/^\(([\s\S]*)\)$/, "$1");
      const names: ImportName[] = [];
      for (const part of list.split(",")) {
        const p = FROM_PART.exec(part.trim());
        if (p?.[1]) names.push(p[2] ? { name: p[1], local: p[2] } : { name: p[1] });
      }
      if (names.length) imports.push({ kind: "from", module, names, uses: new Map(), ...base });
      return;
    }
    m = IMPORT.exec(flat);
    if (m) {
      for (const part of (m[1] ?? "").split(",")) {
        const p = IMPORT_PART.exec(part.trim());
        if (!p?.[1]) continue;
        const module = p[1].replace(/\s+/g, "");
        imports.push({
          kind: "import",
          module,
          names: [{ name: "*", local: p[2] ?? module }],
          uses: new Map(),
          ...base,
        });
      }
      return;
    }
    if (nested) return;
    // Assignments: `A = 1`, `a = b = 2`, `x: int = 3`, `a, b = f()`, `__all__ += [...]`.
    const eqs = assignments(stmt.text);
    const augmented = /^__all__\s*\+=/.exec(stmt.text);
    if (augmented || (eqs.length && /^__all__\s*(?::[^=]*)?$/.test(stmt.text.slice(0, eqs[0])))) {
      const rhsStart = augmented ? augmented[0].length : (eqs[0] ?? 0) + 1;
      const names = literalList(stmt.start + rhsStart, end, masked, strings);
      if (!names) allDynamic = true;
      else all = augmented ? [...(all ?? []), ...names] : names;
      return;
    }
    let from = 0;
    for (const eq of eqs) {
      const targets = targetNames(stmt.text.slice(from, eq), from === 0);
      if (!targets) break;
      for (const name of targets) defs.push({ name, kind: "const", line });
      from = eq + 1;
    }
  };

  /** A statement, or a compound header followed by an inline body (`if X: import y`). */
  const statement = (
    seg: Segment,
    typeOnly: boolean,
    nested: boolean,
  ): "def" | "tc" | undefined => {
    const head = HEADER.exec(seg.text);
    if (!head) {
      for (const s of splitStatements(seg)) simple(s, typeOnly, nested);
      return undefined;
    }
    const colon = headerColon(seg.text);
    if (colon < 0) return undefined;
    const header = seg.text.slice(0, colon).trim();
    let kind: "def" | "tc" | undefined;
    const def = DEF.exec(header) ?? CLASS.exec(header);
    if (def?.[1]) {
      kind = "def";
      if (!nested) {
        defs.push({
          name: def[1],
          kind: header.startsWith("class") ? "class" : "function",
          line: lineOf(seg.start),
        });
      }
    } else if (TYPE_CHECKING_IF.test(header.replace(/\\\r?\n/g, " "))) {
      kind = "tc";
    }
    const bodyText = seg.text.slice(colon + 1);
    const lead = bodyText.length - bodyText.trimStart().length;
    if (bodyText.trim()) {
      statement(
        { start: seg.start + colon + 1 + lead, text: bodyText.trimStart() },
        typeOnly || kind === "tc",
        nested || kind === "def",
      );
      return undefined;
    }
    return kind;
  };

  const stack: { indent: number; kind: "def" | "tc" }[] = [];
  for (const ll of logicalLines(masked)) {
    while (stack.length && (stack[stack.length - 1]?.indent ?? 0) >= ll.indent) stack.pop();
    const typeOnly = stack.some((e) => e.kind === "tc");
    const nested = stack.some((e) => e.kind === "def");
    if (ll.text.startsWith("@")) continue;
    const opened = statement(ll, typeOnly, nested);
    if (opened) stack.push({ indent: ll.indent, kind: opened });
  }

  // The first line each imported name is used on, outside import statements.
  for (const imp of imports) {
    for (const n of imp.names) {
      const local = n.local ?? (n.name === "*" ? undefined : n.name);
      if (!local) continue;
      const word = new RegExp(
        `(?<![\\p{L}\\p{N}_.])${local.replace(/\./g, "\\s*\\.\\s*")}(?![\\p{L}\\p{N}_])`,
        "gu",
      );
      word.lastIndex = imp.end;
      for (let m = word.exec(masked); m; m = word.exec(masked)) {
        const at = m.index;
        if (imports.some((o) => at >= o.start && at < o.end)) continue;
        imp.uses.set(n, lineOf(at));
        break;
      }
    }
  }

  const literals = new Map<string, number>();
  for (const s of strings) {
    if (literals.size >= MAX_LITERALS) break;
    if (s.value === undefined || !LITERAL.test(s.value) || literals.has(s.value)) continue;
    literals.set(s.value, lineOf(s.start));
  }

  return {
    imports: imports.map(({ start: _s, end: _e, ...rest }) => rest),
    defs,
    all: allDynamic ? undefined : all,
    literals: [...literals]
      .map(([text, line]) => ({ text, line }))
      .sort((a, b) => a.line - b.line || a.text.localeCompare(b.text)),
  };
}

/** Offsets of the `=` signs that separate assignment targets, at bracket depth 0. */
function assignments(text: string): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    else if (c === "=" && depth === 0) {
      const prev = text[i - 1] ?? "";
      if (text[i + 1] === "=") {
        i++;
        continue;
      }
      if (!"=<>!:+-*/%&|^@~".includes(prev) || prev === "") out.push(i);
    }
  }
  return out;
}

/** The names an assignment target binds (`a`, `a: T`, `a, b`, `(a, *b)`), or undefined. */
function targetNames(target: string, first: boolean): string[] | undefined {
  const t = target.replace(/\\\r?\n/g, " ").trim();
  if (NAME.test(t)) return [t];
  const annotated = ANNOTATED.exec(t);
  if (annotated?.[1]) return first ? [annotated[1]] : undefined;
  const inner = t.replace(/^\(([\s\S]*)\)$|^\[([\s\S]*)\]$/, "$1$2");
  const parts = inner
    .split(",")
    .map((p) => p.trim().replace(/^\*/, ""))
    .filter(Boolean);
  if (parts.length && inner.includes(",") && parts.every((p) => NAME.test(p))) return parts;
  return undefined;
}

/** The strings of a literal list or tuple between two offsets, or undefined if it holds anything else. */
function literalList(
  start: number,
  end: number,
  masked: string,
  strings: readonly StringToken[],
): string[] | undefined {
  const inside = strings.filter((s) => s.start >= start && s.end <= end);
  let rest = "";
  let at = start;
  for (const s of inside) {
    rest += masked.slice(at, s.start);
    at = s.end;
  }
  rest += masked.slice(at, end);
  if (!/^[\s()[\],\\]*$/.test(rest) || !/[[(]/.test(rest)) return undefined;
  if (inside.some((s) => s.value === undefined)) return undefined;
  return inside.map((s) => s.value as string);
}

/** The `:` that ends a compound statement's header, at bracket depth 0 (not `:=`). */
function headerColon(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0 && text[i + 1] !== "=") return i;
  }
  return -1;
}

interface Segment {
  /** Offset of the first non-blank character. */
  start: number;
  text: string;
}

function splitStatements(seg: Segment): Segment[] {
  const out: Segment[] = [];
  let depth = 0;
  let from = 0;
  const push = (to: number) => {
    const raw = seg.text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) out.push({ start: seg.start + from + lead, text });
  };
  for (let i = 0; i < seg.text.length; i++) {
    const c = seg.text[i] as string;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      push(i);
      from = i + 1;
    }
  }
  push(seg.text.length);
  return out;
}

/** Logical lines of masked source: physical lines joined inside brackets and after `\`. */
function logicalLines(masked: string): (Segment & { indent: number })[] {
  const out: (Segment & { indent: number })[] = [];
  let depth = 0;
  let from = 0;
  const push = (to: number) => {
    const raw = masked.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (!text) return;
    const firstLine = raw.slice(raw.lastIndexOf("\n", lead) + 1);
    const indent = /^[ \t\f]*/.exec(firstLine)?.[0].length ?? 0;
    out.push({ start: from + lead, text, indent });
  };
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i] as string;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    else if (c === "\\") {
      if (masked[i + 1] === "\n") i++;
      else if (masked[i + 1] === "\r" && masked[i + 2] === "\n") i += 2;
    } else if (c === "\n" && depth === 0) {
      push(i);
      from = i + 1;
    }
  }
  push(masked.length);
  return out;
}

/**
 * The source with comments blanked and each string's contents replaced by
 * spaces (quotes and newlines kept, so offsets and lines still match), and
 * the strings themselves. f-string replacement fields may nest strings.
 */
function lex(text: string): { masked: string; strings: StringToken[] } {
  const out = text.split("");
  const strings: StringToken[] = [];
  const n = text.length;

  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (text[k] !== "\n") out[k] = " ";
  };

  /**
   * Scans the string whose opening quote is at `q`, blanking its contents as
   * it goes. An f-string's replacement fields stay visible: they are code.
   */
  const scanString = (q: number, isF: boolean): { end: number; closed: boolean } => {
    const quote = text[q] as string;
    const delim = text.startsWith(quote.repeat(3), q) ? quote.repeat(3) : quote;
    out[q] = '"';
    blank(q + 1, q + delim.length);
    let i = q + delim.length;
    while (i < n) {
      const ch = text[i];
      if (ch === "\\") {
        blank(i, i + 2);
        i += 2;
        continue;
      }
      if (delim.length === 1 && ch === "\n") return { end: i, closed: false };
      if (text.startsWith(delim, i)) {
        blank(i, i + delim.length - 1);
        out[i + delim.length - 1] = '"';
        return { end: i + delim.length, closed: true };
      }
      if (isF && ch === "{") {
        if (text[i + 1] === "{") {
          blank(i, i + 2);
          i += 2;
          continue;
        }
        out[i] = " ";
        const end = scanField(i + 1);
        if (end <= n && text[end - 1] === "}") out[end - 1] = " ";
        i = end;
        continue;
      }
      blank(i, i + 1);
      i++;
    }
    return { end: n, closed: false };
  };

  const scanField = (start: number): number => {
    let depth = 0;
    let i = start;
    while (i < n) {
      const ch = text[i] as string;
      if (ch === '"' || ch === "'") {
        let p = i;
        while (p > start && /[a-zA-Z]/.test(text[p - 1] ?? "")) p--;
        i = scanString(i, /f/i.test(text.slice(p, i))).end;
        continue;
      }
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        if (depth === 0 && ch === "}") return i + 1;
        depth--;
      }
      i++;
    }
    return n;
  };

  let i = 0;
  while (i < n) {
    const c = text[i] as string;
    if (c === "#") {
      while (i < n && text[i] !== "\n") out[i++] = " ";
      continue;
    }
    let prefix = "";
    if (IDENT_START.test(c)) {
      let j = i;
      while (j < n && IDENT_PART.test(text[j] as string)) j++;
      const word = text.slice(i, j);
      if ((text[j] === '"' || text[j] === "'") && STRING_PREFIX.test(word)) {
        prefix = word;
        i = j;
      } else {
        i = j;
        continue;
      }
    }
    const q = text[i];
    if (q === '"' || q === "'") {
      const { end, closed } = scanString(i, /[fFtT]/.test(prefix));
      const delim = text.startsWith((q as string).repeat(3), i) ? 3 : 1;
      strings.push({
        start: i - prefix.length,
        end,
        value: closed && !/[fFtT]/.test(prefix) ? text.slice(i + delim, end - delim) : undefined,
      });
      i = end;
      continue;
    }
    i++;
  }
  return { masked: out.join(""), strings };
}
