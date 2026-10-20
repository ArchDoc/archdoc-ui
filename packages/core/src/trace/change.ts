import { normalizePath } from "../codemap/glob.js";
import { parseExpands, type Trace } from "./trace.js";

/**
 * A trace a change adds or edits. It fits the PR comment's `fixes` input
 * (`{ id, title, anchor }`), which renders as "Fixes the bug traced in <id>:
 * <title> (<anchor>)".
 */
export interface TraceInChange {
  id: string;
  title: string;
  /** The journey step it opens up, as people read it: "review-ai-change step 4". */
  anchor?: string | undefined;
  file: string;
  /** The journey step it opens up, when it says. */
  journey?: string | undefined;
  /** 1-based. */
  step?: number | undefined;
  /** 1-based steps with role cause. */
  causes: number[];
}

/**
 * The traces among a change's files. `changedFiles` are repository-relative
 * (as `changedFiles` from git returns them); a trace's `file` is matched by
 * its path, or by its tail when it was read relative to another directory.
 */
export function tracesInChange(
  changedFiles: readonly string[],
  traces: readonly Trace[],
): TraceInChange[] {
  const changed = changedFiles.map(normalizePath);
  const touched = (file: string) => {
    const f = normalizePath(file);
    return changed.some((c) => c === f || c.endsWith(`/${f}`) || f.endsWith(`/${c}`));
  };
  return traces
    .filter((t) => touched(t.file))
    .map((t) => {
      const anchor = t.spec.expands ? parseExpands(t.spec.expands) : undefined;
      return {
        id: t.id,
        title: t.spec.title,
        ...(anchor ? { anchor: `${anchor.journey} step ${anchor.step}` } : {}),
        file: normalizePath(t.file),
        ...(anchor ? { journey: anchor.journey, step: anchor.step } : {}),
        causes: t.spec.steps.flatMap((s, i) => (s.role === "cause" ? [i + 1] : [])),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
