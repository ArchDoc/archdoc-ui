import { posix } from "node:path";
import type { IndexedImport, IndexedSource, IndexedSymbol } from "@archdoc/core";
import type { Analyzer, AnalyzerContext, ObservedDependency } from "./api.js";

// Go support, parsed from the text in TypeScript: no Go toolchain, no network.
// Go code is organized in packages (directories) inside modules (a go.mod and
// the directories under it), so an import resolves to a package directory.

/** A Go module in the repository: a go.mod and the directory it governs. */
export interface GoModule {
  /** The module path from the `module` directive, such as github.com/acme/shop. */
  path: string;
  /** Its directory relative to the repository root ("" for the root). */
  dir: string;
  /** The go.mod file. */
  manifest: string;
  /**
   * The `replace` directives that apply to its imports: its own, preceded by
   * those of a go.work file above it, which take precedence.
   */
  replaces: GoReplace[];
}

/** A `replace` directive: a module path and where its code is. */
export interface GoReplace {
  /** The replaced module path. */
  path: string;
  /** The repository directory it points to, or undefined when it points outside the repository. */
  dir: string | undefined;
}

/** String literals that read as identifiers with parts (the same rule as the TS index). */
const LITERAL = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/;
const MAX_LITERALS = 100;

/**
 * A Go file the Go tool builds: `.go`, outside `vendor/`, `testdata/`, and
 * `node_modules/`, and outside files or directories whose names start with
 * "." or "_" (which the Go tool ignores). `_test.go` files are included.
 */
export function isGoSource(path: string): boolean {
  return path.endsWith(".go") && !ignored(path);
}

function ignored(path: string): boolean {
  return path
    .split("/")
    .some(
      (seg) =>
        seg === "vendor" ||
        seg === "testdata" ||
        seg === "node_modules" ||
        seg.startsWith(".") ||
        seg.startsWith("_"),
    );
}

/**
 * Every Go module in the repository: each go.mod's module path, directory,
 * and replace directives (go.work replaces included). Sorted longest module
 * path first.
 */
export async function goModules(ctx: AnalyzerContext): Promise<GoModule[]> {
  const modules: GoModule[] = [];
  const works: { dir: string; replaces: GoReplace[] }[] = [];
  for (const file of ctx.files) {
    const base = posix.basename(file);
    if ((base !== "go.mod" && base !== "go.work") || ignored(dirOf(file))) continue;
    let text: string;
    try {
      text = await ctx.read(file);
    } catch {
      continue;
    }
    const dir = dirOf(file);
    const directives = parseModFile(text);
    const replaces: GoReplace[] = [];
    for (const d of directives) {
      if (d.verb !== "replace") continue;
      const r = replaceOf(d.args, dir, ctx.baseDir);
      if (r) replaces.push(r);
    }
    if (base === "go.work") {
      works.push({ dir, replaces });
      continue;
    }
    const path = directives.find((d) => d.verb === "module")?.args[0];
    if (path) modules.push({ path, dir, manifest: file, replaces });
  }
  // A go.work's replaces apply to the modules under it, and override theirs.
  for (const work of works.sort((a, b) => b.dir.length - a.dir.length)) {
    for (const m of modules) {
      if (within(m.dir, work.dir)) m.replaces = [...work.replaces, ...m.replaces];
    }
  }
  return modules.sort(
    (a, b) =>
      b.path.length - a.path.length || a.path.localeCompare(b.path) || a.dir.localeCompare(b.dir),
  );
}

/**
 * The repository package directory a Go import path in `from` points to, or
 * undefined for the standard library, third-party modules, and modules
 * replaced with code outside the repository. The longest matching module
 * path wins; a replace directive of `from`'s module wins over a module of the
 * same path.
 */
export function resolveGoImport(
  from: string,
  importPath: string,
  modules: readonly GoModule[],
): string | undefined {
  let best: { path: string; dir: string | undefined } | undefined;
  const consider = (path: string, dir: string | undefined) => {
    if (!best || path.length > best.path.length) {
      if (importPath === path || importPath.startsWith(`${path}/`)) best = { path, dir };
    }
  };
  for (const r of moduleOf(from, modules)?.replaces ?? []) consider(r.path, r.dir);
  for (const m of modules) consider(m.path, m.dir);
  if (!best || best.dir === undefined) return undefined;
  const dir = posix.join(best.dir || ".", importPath.slice(best.path.length + 1));
  return dir === ".." || dir.startsWith("../") ? undefined : dir;
}

/** The module whose directory contains `file`: the deepest one. */
function moduleOf(file: string, modules: readonly GoModule[]): GoModule | undefined {
  let best: GoModule | undefined;
  for (const m of modules) {
    if (within(file, m.dir) && (!best || m.dir.length > best.dir.length)) best = m;
  }
  return best;
}

function within(path: string, dir: string): boolean {
  return dir === "" || path === dir || path.startsWith(`${dir}/`);
}

function dirOf(file: string): string {
  const dir = posix.dirname(file);
  return dir === "." ? "" : dir;
}

/**
 * Imports between Go packages: every import in every `.go` file (tests
 * included) whose path falls under a module in the repository resolves to
 * that package's directory. Standard library and third-party imports are
 * ignored. Imports in `_test.go` files are marked `typeOnly`: they are needed
 * to test the code, not to run it.
 */
export const goImports: Analyzer = {
  name: "go-imports",
  async analyze(ctx) {
    const modules = await goModules(ctx);
    const out: ObservedDependency[] = [];
    if (modules.length === 0) return out;
    for (const file of ctx.files) {
      if (!isGoSource(file)) continue;
      let text: string;
      try {
        text = await ctx.read(file);
      } catch {
        continue;
      }
      const test = file.endsWith("_test.go");
      for (const imp of goImportDecls(tokenize(text))) {
        const to = resolveGoImport(file, imp.path, modules);
        if (!to) continue;
        out.push({
          from: file,
          to,
          analyzer: "go-imports",
          specifier: imp.path,
          line: imp.line,
          typeOnly: test || undefined,
        });
      }
    }
    return out;
  },
};

/**
 * One Go file's exports, imports, and literals. Exports are its exported
 * (capitalized) top-level funcs, methods of exported types (named
 * `Type.Method`), types, consts, and vars. Each import names the package (its
 * local name when an alias differs) with the line it's first used on, then
 * each exported name used through it (`store.Open` → Open) with its first line.
 * `resolve` maps an import path to a repository directory.
 */
export function indexGoSource(
  path: string,
  text: string,
  resolve: (specifier: string) => string | undefined = () => undefined,
): IndexedSource {
  const tokens = tokenize(text);
  const exports: IndexedSymbol[] = [];
  const imports: IndexedImport[] = [];
  /** Package local names → their import entry, for first uses. */
  const locals = new Map<string, IndexedImport>();
  const skip = new Set<Token>();

  for (const stmt of statements(tokens)) {
    const head = stmt[0];
    if (head?.kind !== "ident") continue;
    if (head.text === "import") {
      for (const t of stmt) skip.add(t);
      for (const imp of importSpecs(stmt)) {
        const pkg = packageName(imp.path);
        const name: IndexedImport["names"][number] = { name: pkg };
        if (imp.name !== undefined && imp.name !== pkg) name.local = imp.name;
        const entry: IndexedImport = {
          specifier: imp.path,
          target: resolve(imp.path),
          line: imp.line,
          names: [name],
        };
        imports.push(entry);
        const local = imp.name ?? pkg;
        if (local !== "_" && local !== "." && local !== "") locals.set(local, entry);
      }
    } else if (head.text === "func") {
      const fn = funcName(stmt);
      if (fn) exports.push({ name: fn, kind: "function", line: head.line });
    } else if (head.text === "type") {
      for (const spec of specs(stmt)) {
        const name = spec[0];
        if (name?.kind !== "ident" || !isExported(name.text)) continue;
        exports.push({ name: name.text, kind: typeKind(spec), line: name.line });
      }
    } else if (head.text === "const" || head.text === "var") {
      for (const spec of specs(stmt)) {
        for (const name of specNames(spec)) {
          if (isExported(name.text))
            exports.push({ name: name.text, kind: head.text, line: name.line });
        }
      }
    }
  }

  // The first use of each imported package (`pkg.`) and of each name used through it.
  const literals = new Map<string, number>();
  tokens.forEach((t, i) => {
    if (skip.has(t)) return;
    if (t.kind === "string") {
      if (literals.size < MAX_LITERALS && LITERAL.test(t.value) && !literals.has(t.value)) {
        literals.set(t.value, t.line);
      }
      return;
    }
    if (t.kind !== "ident") return;
    const imp = locals.get(t.text);
    if (!imp || !isOp(tokens[i + 1], ".") || isOp(tokens[i - 1], ".")) return;
    const pkg = imp.names[0];
    if (pkg && pkg.line === undefined) pkg.line = t.line;
    const sel = tokens[i + 2];
    if (
      sel?.kind === "ident" &&
      isExported(sel.text) &&
      !imp.names.some((n, k) => k > 0 && n.name === sel.text)
    ) {
      imp.names.push({ name: sel.text, line: sel.line });
    }
  });

  const out: IndexedSource = {
    path,
    exports: exports.sort((a, b) => a.line - b.line),
    imports,
  };
  if (literals.size) {
    out.literals = [...literals]
      .map(([text, line]) => ({ text, line }))
      .sort((a, b) => a.line - b.line || a.text.localeCompare(b.text));
  }
  return out;
}

/**
 * The name a package is assumed to have from its import path, the way
 * goimports guesses it: the last element, skipping a major version suffix
 * (`/v2`), without a "go-" prefix, up to the first character that can't be in
 * an identifier (`gopkg.in/yaml.v3` → yaml).
 */
export function packageName(importPath: string): string {
  const parts = importPath.split("/");
  let base = parts[parts.length - 1] ?? importPath;
  if (/^v\d+$/.test(base) && parts.length > 1) base = parts[parts.length - 2] ?? base;
  if (base.startsWith("go-")) base = base.slice(3);
  const end = base.search(/[^\p{L}\p{N}_]/u);
  return end >= 0 ? base.slice(0, end) : base;
}

function isExported(name: string): boolean {
  return /^\p{Lu}/u.test(name);
}

// ---------------------------------------------------------------------------
// Declarations

/** `func Name`, or `func (r *T) Name` as T.Name: exported names only, on exported types. */
function funcName(stmt: Token[]): string | undefined {
  let k = 1;
  let receiver: string | undefined;
  if (isOp(stmt[1], "(")) {
    const close = closing(stmt, 1);
    // The receiver's type: the last identifier before any type parameters.
    for (let i = 2; i < close; i++) {
      const t = stmt[i];
      if (isOp(t, "[")) break;
      if (t?.kind === "ident") receiver = t.text;
    }
    if (receiver === undefined || !isExported(receiver)) return undefined;
    k = close + 1;
  }
  const name = stmt[k];
  if (name?.kind !== "ident" || !isExported(name.text)) return undefined;
  return receiver ? `${receiver}.${name.text}` : name.text;
}

/** struct → class, interface → interface, anything else (aliases, func types, named types) → type. */
function typeKind(spec: Token[]): IndexedSymbol["kind"] {
  let k = 1;
  if (isOp(spec[k], "[") && isTypeParams(spec, k)) k = closing(spec, k) + 1;
  if (isOp(spec[k], "=")) k++;
  const t = spec[k];
  return t?.text === "struct" ? "class" : t?.text === "interface" ? "interface" : "type";
}

/** `type T[P any]` declares type parameters; `type A [4]int` is an array. */
function isTypeParams(spec: Token[], open: number): boolean {
  const first = spec[open + 1];
  const second = spec[open + 2];
  if (first?.kind !== "ident" || !second) return false;
  return second.kind === "ident" || isOp(second, ",") || isOp(second, "~") || isOp(second, "[");
}

/** The names a const or var spec declares: `A, B int = 1, 2` → A, B. */
function specNames(spec: Token[]): Token[] {
  const out: Token[] = [];
  for (let k = 0; spec[k]?.kind === "ident"; k += 2) {
    out.push(spec[k] as Token);
    if (!isOp(spec[k + 1], ",")) break;
  }
  return out;
}

/** The import paths of a file's import declarations, with the line of each. */
function goImportDecls(tokens: Token[]): { name?: string; path: string; line: number }[] {
  const out: { name?: string; path: string; line: number }[] = [];
  for (const stmt of statements(tokens)) {
    const head = stmt[0];
    if (head?.kind !== "ident") continue;
    if (head.text === "import") out.push(...importSpecs(stmt));
    // Imports come first: the first other declaration ends them.
    else if (head.text !== "package") break;
  }
  return out;
}

/** `import "x"`, `import name "x"`, `import . "x"`, `import _ "x"`, and the grouped forms. */
function importSpecs(stmt: Token[]): { name?: string; path: string; line: number }[] {
  const out: { name?: string; path: string; line: number }[] = [];
  for (const spec of specs(stmt)) {
    let k = 0;
    let name: string | undefined;
    const first = spec[0];
    if (first && (first.kind === "ident" || isOp(first, "."))) {
      name = first.text;
      k = 1;
    }
    const lit = spec[k];
    if (lit?.kind === "string" && lit.value) out.push({ name, path: lit.value, line: lit.line });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokens

interface Token {
  kind: "ident" | "string" | "number" | "rune" | "op";
  /** The source text (for strings, with quotes). */
  text: string;
  /** A string's value. */
  value: string;
  /** 1-based line it starts on. */
  line: number;
  /** Brackets open around it; a closing bracket has its opener's depth. */
  depth: number;
}

const KEYWORDS = new Set([
  "break",
  "case",
  "chan",
  "const",
  "continue",
  "default",
  "defer",
  "else",
  "fallthrough",
  "for",
  "func",
  "go",
  "goto",
  "if",
  "import",
  "interface",
  "map",
  "package",
  "range",
  "return",
  "select",
  "struct",
  "switch",
  "type",
  "var",
]);
/** Keywords after which a newline ends the statement. */
const ENDING_KEYWORDS = new Set(["break", "continue", "fallthrough", "return"]);
const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  '"': '"',
  "'": "'",
};
const IDENT = /[\p{L}_][\p{L}\p{N}_]*/uy;
const NUMBER = /(?:[0-9]|\.[0-9])(?:[eEpP][+-]|[0-9a-zA-Z_.])*/y;

/**
 * Go's tokens, without comments, with the semicolons Go inserts at the end of
 * a line that ends a statement. Never throws: unterminated strings and
 * comments end at the end of the line or file.
 */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let depth = 0;
  const push = (kind: Token["kind"], start: number, value = "", at = line) => {
    out.push({ kind, text: text.slice(start, i), value, line: at, depth });
  };
  const endsStatement = (): boolean => {
    const last = out[out.length - 1];
    if (!last) return false;
    if (last.kind === "ident") return !KEYWORDS.has(last.text) || ENDING_KEYWORDS.has(last.text);
    if (last.kind !== "op") return true;
    return [")", "]", "}", "++", "--"].includes(last.text);
  };
  const semicolon = () => {
    if (endsStatement()) out.push({ kind: "op", text: ";", value: "", line, depth });
  };

  while (i < n) {
    const c = text[i] as string;
    if (c === "\n") {
      semicolon();
      line++;
      i++;
    } else if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "﻿") {
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? n : end;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      const lines = countLines(text, i, stop);
      // A comment spanning lines acts like a newline.
      if (lines) semicolon();
      line += lines;
      i = stop;
    } else if (c === '"' || c === "'") {
      const start = i;
      let value = "";
      i++;
      while (i < n && text[i] !== c && text[i] !== "\n") {
        if (text[i] === "\\" && i + 1 < n && text[i + 1] !== "\n") {
          const e = text[i + 1] as string;
          value += ESCAPES[e] ?? `\\${e}`;
          i += 2;
        } else {
          value += text[i];
          i++;
        }
      }
      if (text[i] === c) i++;
      push(c === '"' ? "string" : "rune", start, value);
    } else if (c === "`") {
      const start = i;
      const end = text.indexOf("`", i + 1);
      i = end < 0 ? n : end + 1;
      const startLine = line;
      line += countLines(text, start, i);
      push("string", start, text.slice(start + 1, end < 0 ? n : end).replace(/\r/g, ""), startLine);
    } else if (match(IDENT, text, i)) {
      const start = i;
      i = IDENT.lastIndex;
      push("ident", start);
    } else if (match(NUMBER, text, i)) {
      const start = i;
      i = NUMBER.lastIndex;
      push("number", start);
    } else {
      const start = i;
      const three = text.slice(i, i + 3);
      const two = text.slice(i, i + 2);
      if (three === "...") i += 3;
      else if (two === "++" || two === "--") i += 2;
      else i++;
      if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
      push("op", start);
      if (c === "(" || c === "[" || c === "{") depth++;
    }
  }
  semicolon();
  return out;
}

function match(re: RegExp, text: string, at: number): boolean {
  re.lastIndex = at;
  return re.test(text);
}

function countLines(text: string, from: number, to: number): number {
  let lines = 0;
  for (let i = from; i < to; i++) if (text.charCodeAt(i) === 10) lines++;
  return lines;
}

function isOp(t: Token | undefined, text: string): boolean {
  return t?.kind === "op" && t.text === text;
}

/** Top-level statements: the tokens between semicolons outside any brackets. */
function statements(tokens: Token[]): Token[][] {
  const out: Token[][] = [];
  let cur: Token[] = [];
  for (const t of tokens) {
    if (t.depth === 0 && isOp(t, ";")) {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The specs of a declaration (`kw spec` or `kw ( spec; spec )`), without the keyword. */
function specs(stmt: Token[]): Token[][] {
  const open = stmt[1];
  if (!open || !isOp(open, "(")) return stmt.length > 1 ? [stmt.slice(1)] : [];
  const out: Token[][] = [];
  let cur: Token[] = [];
  for (const t of stmt.slice(2)) {
    if (t.depth === open.depth) break;
    if (t.depth === open.depth + 1 && isOp(t, ";")) {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The index of the bracket closing the one at `open` (or the end). */
function closing(tokens: Token[], open: number): number {
  const depth = tokens[open]?.depth ?? 0;
  for (let i = open + 1; i < tokens.length; i++) {
    const t = tokens[i] as Token;
    if (t.depth === depth && t.kind === "op" && /^[)\]}]$/.test(t.text)) return i;
  }
  return tokens.length;
}

// ---------------------------------------------------------------------------
// go.mod and go.work

interface Directive {
  verb: string;
  args: string[];
}

/** go.mod and go.work directives, single-line and in blocks (`require ( … )`). */
function parseModFile(text: string): Directive[] {
  const out: Directive[] = [];
  let block: string | undefined;
  for (const raw of text.split("\n")) {
    const words: string[] = [];
    for (const m of raw.matchAll(
      /\/\/.*|"(?:[^"\\]|\\.)*"|`[^`]*`|=>|[()]|(?:[^\s"`()=]|=(?!>))+/g,
    )) {
      if (m[0].startsWith("//")) break;
      words.push(unquote(m[0]));
    }
    if (words.length === 0) continue;
    if (block !== undefined) {
      if (words[0] === ")") block = undefined;
      else out.push({ verb: block, args: words });
    } else if (words[1] === "(" && words.length === 2) {
      block = words[0];
    } else {
      out.push({ verb: words[0] as string, args: words.slice(1) });
    }
  }
  return out;
}

function unquote(word: string): string {
  if (word.startsWith("`")) return word.slice(1, -1);
  if (!word.startsWith('"')) return word;
  try {
    return JSON.parse(word) as string;
  } catch {
    return word.slice(1, -1);
  }
}

/** `old [version] => new [version]`, resolved against the directory of the file declaring it. */
function replaceOf(args: string[], dir: string, baseDir: string): GoReplace | undefined {
  const arrow = args.indexOf("=>");
  const path = args[0];
  const target = args[arrow + 1];
  if (arrow < 1 || !path || !target) return undefined;
  let local: string | undefined;
  if (target === "." || target === ".." || /^\.\.?\//.test(target)) {
    local = posix.normalize(posix.join(dir || ".", target));
  } else if (target.startsWith("/")) {
    const root = baseDir.replace(/\\/g, "/").replace(/\/$/, "");
    if (target === root || target.startsWith(`${root}/`)) {
      local = posix.normalize(target.slice(root.length + 1) || ".");
    }
  }
  // A module path (fetched, not in the repository) or a directory outside it.
  if (local === undefined || local === ".." || local.startsWith("../")) {
    return { path, dir: undefined };
  }
  return { path, dir: local === "." ? "" : local.replace(/\/$/, "") };
}
