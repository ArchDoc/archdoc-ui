import type { ElementNode, Model } from "../model.js";
import { compileGlob, literalPrefix, normalizePath } from "./glob.js";

export interface CodeMatch {
  element: ElementNode;
  /** The `code:` path that matched. */
  pattern: string;
}

export interface Located {
  /** The path as asked, normalized to forward slashes relative to the repo. */
  path: string;
  /** The most specific owning element, or undefined if nothing maps it. */
  element?: ElementNode | undefined;
  pattern?: string | undefined;
  /** Other elements that match equally well. Usually empty. */
  ties: ElementNode[];
  /** Every element whose code paths match, most specific first. */
  matches: CodeMatch[];
}

export interface CodeMap {
  /** Files owned by each element (most specific owner only), by element ID. */
  files: Map<string, string[]>;
  /** Files no element maps. */
  unmapped: string[];
  /** Code paths that match no file. */
  stale: { element: string; pattern: string }[];
}

interface CompiledPattern {
  element: ElementNode;
  pattern: string;
  re: RegExp;
  prefix: number;
}

const cache = new WeakMap<Model, CompiledPattern[]>();

function patterns(model: Model): CompiledPattern[] {
  let compiled = cache.get(model);
  if (!compiled) {
    compiled = [...model.elements.values()].flatMap((element) =>
      element.code.map((c) => ({
        element,
        pattern: c.path,
        re: compileGlob(c.path),
        prefix: literalPrefix(c.path).length,
      })),
    );
    cache.set(model, compiled);
  }
  return compiled;
}

/**
 * Which element owns a path. The deepest matching element wins, so
 * `packages/core/src/load/fs.ts` belongs to `core.loader`, not `core`. Between
 * elements at the same depth, the longer literal path wins. Paths don't need
 * to exist: an agent can ask about a file before creating it.
 */
export function locate(model: Model, path: string): Located {
  const p = normalizePath(path);
  const matches = patterns(model)
    .filter((c) => c.re.test(p))
    .sort((a, b) => b.element.depth - a.element.depth || b.prefix - a.prefix);

  // One entry per element, keeping its best pattern.
  const seen = new Set<string>();
  const unique = matches.filter((m) => !seen.has(m.element.id) && seen.add(m.element.id));
  const best = unique[0];
  const ties = best
    ? unique
        .slice(1)
        .filter((m) => m.element.depth === best.element.depth && m.prefix === best.prefix)
        .map((m) => m.element)
    : [];
  return {
    path: p,
    element: best?.element,
    pattern: best?.pattern,
    ties,
    matches: unique.map((m) => ({ element: m.element, pattern: m.pattern })),
  };
}

/** Maps a list of repository files onto the model. */
export function resolveCodeMap(model: Model, files: readonly string[]): CodeMap {
  const byElement = new Map<string, string[]>();
  const unmapped: string[] = [];
  const used = new Set<CompiledPattern>();
  const all = patterns(model);

  for (const file of files) {
    const p = normalizePath(file);
    const owner = locate(model, p).element;
    for (const c of all) if (c.re.test(p)) used.add(c);
    if (!owner) {
      unmapped.push(p);
      continue;
    }
    const list = byElement.get(owner.id) ?? [];
    list.push(p);
    byElement.set(owner.id, list);
  }

  return {
    files: byElement,
    unmapped,
    stale: all
      .filter((c) => !used.has(c) && c.element.spec.status !== "planned")
      .map((c) => ({ element: c.element.id, pattern: c.pattern })),
  };
}

/** Files owned by an element and everything inside it. */
export function filesUnder(model: Model, map: CodeMap, elementId: string): string[] {
  const out: string[] = [];
  const stack = [elementId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    out.push(...(map.files.get(id) ?? []));
    stack.push(...(model.elements.get(id)?.childIds ?? []));
  }
  return out.sort();
}
