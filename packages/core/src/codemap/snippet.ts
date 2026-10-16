import type { CodeRef } from "../model.js";

/** The part of a file a code reference points at. */
export interface Snippet {
  path: string;
  /** 1-based, inclusive. */
  start: number;
  end: number;
  text: string;
}

/** The most lines a symbol's snippet takes, when its end isn't plain from indentation. */
const MAX_SYMBOL_LINES = 120;

/** A code reference as people read it: path:40-88 (symbol). */
export function snippetLabel(ref: CodeRef): string {
  return `${ref.path}${ref.lines !== undefined ? `:${ref.lines}` : ""}${ref.symbol ? ` (${ref.symbol})` : ""}`;
}

/** Whether a code reference points at part of a file, not a whole file or directory. */
export function isSnippet(ref: CodeRef): boolean {
  return ref.lines !== undefined || ref.symbol !== undefined;
}

/**
 * The snippet a code reference points at in a file's text: its lines, or the
 * declaration of its symbol, from the line that declares it to where the
 * declaration ends (the next line back at its indentation), with lines
 * narrowing a symbol to the declaration inside them. A problem when the file
 * is shorter than the lines, or doesn't declare the symbol.
 */
export function findSnippet(ref: CodeRef, text: string): Snippet | { problem: string } {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  let from = 1;
  let to = lines.length;
  if (ref.lines !== undefined) {
    const [a, b = a] = ref.lines.split("-").map(Number) as [number, number?];
    if (a > lines.length || (b as number) > lines.length) {
      return { problem: `has ${lines.length} lines, not ${ref.lines}` };
    }
    from = a;
    to = b as number;
  }
  if (ref.symbol === undefined) return slice(ref.path, lines, from, to);
  const at = declarationOf(lines, ref.symbol, from, to);
  if (at === undefined) {
    return {
      problem: `doesn't declare ${ref.symbol}${ref.lines !== undefined ? ` in lines ${ref.lines}` : ""}`,
    };
  }
  return slice(ref.path, lines, at, Math.min(endOf(lines, at), to, at + MAX_SYMBOL_LINES - 1));
}

function slice(path: string, lines: string[], start: number, end: number): Snippet {
  return { path, start, end, text: lines.slice(start - 1, end).join("\n") };
}

/** The line (1-based) that declares a symbol: Type.member looks for member after Type. */
function declarationOf(lines: string[], symbol: string, from: number, to: number) {
  const parts = symbol.split(".");
  let start = from;
  for (const [i, name] of parts.entries()) {
    const n = escapeRe(name);
    const declares = new RegExp(
      [
        // function x, class X, interface X, type X, enum X, struct X, def x, func x, fn x, const x =
        `\\b(?:function\\*?|class|interface|type|enum|struct|trait|def|func|fn|module|namespace|object|record|const|let|var|val)\\s+${n}\\b`,
        // func (r Receiver) X(, Go methods
        `\\bfunc\\s*\\([^)]*\\)\\s*${n}\\s*\\(`,
        // x(...) {, x = (...) =>, x: ..., members and object properties
        `^\\s*(?:(?:export|public|private|protected|static|async|override|readonly|default)\\s+)*${n}\\s*(?:<[^>]*>)?\\s*(?:\\(|=|:)`,
      ].join("|"),
    );
    const found = lines.findIndex((l, k) => k + 1 >= start && k + 1 <= to && declares.test(l));
    if (found < 0) return undefined;
    start = found + 1;
    if (i === parts.length - 1) return start;
  }
  return undefined;
}

/** Where a declaration starting at `at` ends: the last line before the code is back at its indentation. */
function endOf(lines: string[], at: number): number {
  const indent = (l: string) => l.length - l.trimStart().length;
  const base = indent(lines[at - 1] as string);
  // The last line that isn't blank, so a snippet doesn't end on the gap before what follows.
  let last = at;
  for (let k = at; k < lines.length; k++) {
    const l = lines[k] as string;
    if (l.trim() === "") continue;
    if (indent(l) <= base) {
      // A closing bracket at the same indentation belongs to the declaration.
      return /^\s*[)}\]]/.test(l) ? k + 1 : last;
    }
    last = k + 1;
  }
  return last;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The code an element points at, as an agent reads it: each reference with
 * its description, and each snippet's text, numbered by line.
 */
export function formatCode(
  id: string,
  refs: readonly CodeRef[],
  read: (path: string) => string | undefined,
): string {
  if (!refs.length) return `${id} doesn't point at any code.`;
  const out: string[] = [`Code for ${id}`];
  for (const ref of refs) {
    out.push("", `${snippetLabel(ref)}${ref.description ? ` · ${ref.description}` : ""}`);
    if (!isSnippet(ref)) continue;
    const text = read(ref.path);
    if (text === undefined) {
      out.push("  (file not found)");
      continue;
    }
    const found = findSnippet(ref, text);
    if ("problem" in found) {
      out.push(`  (${ref.path} ${found.problem})`);
      continue;
    }
    const width = String(found.end).length;
    found.text.split("\n").forEach((line, i) => {
      out.push(`${String(found.start + i).padStart(width)} | ${line}`);
    });
  }
  return out.join("\n");
}
