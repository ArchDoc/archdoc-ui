import { filesUnder, locate, resolveCodeMap } from "../codemap/codemap.js";
import { compileGlob } from "../codemap/glob.js";
import type { Model } from "../model.js";
import { type CodeIndex, isTestFile } from "./code-index.js";
import { context } from "./context.js";
import { search } from "./search.js";

// How well the context brief points at the code that past changes touched:
// replay commits, ask with each subject, and count the changed files the
// brief named. Deterministic: callers read the commits from git.

export interface EvalCommit {
  sha: string;
  subject: string;
  /** Files the commit changed, relative to the repository root. */
  files: string[];
}

export interface EvalCase {
  sha: string;
  subject: string;
  query: string;
  /** The commit's source files (see `isEvalSource`). */
  changed: string[];
  /** Changed files the brief covers: named in Start here (with where they're wired in), or under an involved element's code paths. */
  covered: string[];
  /** Changed files named in Start here. */
  named: string[];
  /** Source files the brief points at: Start here plus the files under the involved elements. */
  scope: number;
  start: string[];
  elements: string[];
  /** The same counts for `search` alone (its top 3 hits' code paths), for comparison. */
  baseline: { covered: number; scope: number };
}

export interface EvalReport {
  cases: EvalCase[];
  /** Commits with no source files left after filtering. */
  skipped: number;
  changed: number;
  covered: number;
  named: number;
  /** covered / changed, over all commits. */
  recall: number;
  /** named / changed, over all commits. */
  startRecall: number;
  medianScope: number;
  baseline: { covered: number; recall: number; medianScope: number };
}

/** A commit subject without its Conventional Commit prefix: "feat(cli): add x" → "add x". */
export function subjectQuery(subject: string): string {
  return subject.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "").trim();
}

const NOT_SOURCE =
  /(^|\/)(\.archdoc|examples|docs|\.changeset|node_modules|dist)\/|\.(md|mdx)$|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|archdoc\.lock|LICENSE)$/;

/** Whether a changed file counts: source and config, not tests, the model, examples, docs, markdown, changesets, or lockfiles. */
export function isEvalSource(path: string): boolean {
  return !isTestFile(path) && !NOT_SOURCE.test(path);
}

/**
 * Replays commits through `context`. Each is asked with its subject (without
 * the Conventional Commit prefix), using the model and code index as they are
 * now, not as they were at the commit: it measures how well today's model
 * would have pointed at the files those changes touched.
 */
export function evaluate(model: Model, index: CodeIndex, commits: EvalCommit[]): EvalReport {
  const files = index.files.filter(isEvalSource);
  const map = resolveCodeMap(model, index.files);
  const under = new Map<string, Set<string>>();
  const filesOf = (id: string) => {
    let s = under.get(id);
    if (!s) {
      s = new Set(filesUnder(model, map, id).filter(isEvalSource));
      under.set(id, s);
    }
    return s;
  };
  const inside = (path: string, ids: Set<string>) => {
    for (let id = locate(model, path).element?.id; id; id = model.elements.get(id)?.parentId) {
      if (ids.has(id)) return true;
    }
    return false;
  };

  const cases: EvalCase[] = [];
  let skipped = 0;
  for (const c of commits) {
    const changed = [...new Set(c.files)].filter(isEvalSource).sort();
    if (changed.length === 0) {
      skipped++;
      continue;
    }
    const query = subjectQuery(c.subject);
    const brief = context(model, query, { index });
    const start = brief.start.flatMap((s) => [s.path, ...(s.wiredIn ?? []).map((w) => w.path)]);
    const startSet = new Set(start);
    const ids = new Set(brief.elements.map((e) => e.id));
    const scope = new Set(start.filter(isEvalSource));
    for (const id of ids) for (const f of filesOf(id)) scope.add(f);
    const covered = changed.filter((f) => startSet.has(f) || inside(f, ids));

    // search alone: the code paths of its top three hits.
    const globs = search(model, query, 3)
      .flatMap((h) => h.code)
      .map((p) => compileGlob(p));
    const hit = (f: string) => globs.some((re) => re.test(f));

    cases.push({
      sha: c.sha,
      subject: c.subject,
      query,
      changed,
      covered,
      named: changed.filter((f) => startSet.has(f)),
      scope: scope.size,
      start,
      elements: [...ids],
      baseline: { covered: changed.filter(hit).length, scope: files.filter(hit).length },
    });
  }

  const sum = (f: (c: EvalCase) => number) => cases.reduce((n, c) => n + f(c), 0);
  const changed = sum((c) => c.changed.length);
  const covered = sum((c) => c.covered.length);
  const named = sum((c) => c.named.length);
  const baseCovered = sum((c) => c.baseline.covered);
  const ratio = (a: number) => (changed ? a / changed : 0);
  return {
    cases,
    skipped,
    changed,
    covered,
    named,
    recall: ratio(covered),
    startRecall: ratio(named),
    medianScope: median(cases.map((c) => c.scope)),
    baseline: {
      covered: baseCovered,
      recall: ratio(baseCovered),
      medianScope: median(cases.map((c) => c.baseline.scope)),
    },
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}
