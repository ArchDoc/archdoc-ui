import { changedFiles, diffModels, loadModelAtRef, mergeBase, prReport } from "@archdoc/core";
import type { Io } from "../io.js";
import { runCheck } from "./check.js";

export interface ReportOptions {
  model?: string;
  base?: string;
  format?: string;
  /** False leaves out the Mermaid diagrams. */
  diagrams?: boolean;
}

/**
 * `archdoc report --base <ref>`: the architectural impact of the change since
 * the merge base with <ref>, as markdown for a pull request comment.
 */
export async function report(options: ReportOptions, io: Io): Promise<number> {
  if (!options.base) {
    io.err("--base is required, such as --base main or --base origin/main.");
    return 2;
  }
  const format = options.format ?? "markdown";
  try {
    const { model, findings } = await runCheck(
      { model: options.model, base: options.base },
      io.cwd,
    );
    const base = (await mergeBase(model.baseDir, options.base, "HEAD")) ?? options.base;
    const [baseModel, changed] = await Promise.all([
      loadModelAtRef(options.model ?? ".", base, { cwd: io.cwd }),
      changedFiles(model.baseDir, base),
    ]);
    const marked = findings.map((f) => f);
    const r = prReport({
      model,
      changedFiles: changed,
      diff: diffModels(baseModel, model),
      findings: marked,
      diagrams: options.diagrams !== false,
      // A commit hash, as the Action passes, reads better short.
      label: `${/^[0-9a-f]{40}$/.test(options.base) ? options.base.slice(0, 7) : options.base}...HEAD`,
    });
    io.out(format === "json" ? JSON.stringify({ ...r, markdown: undefined }, null, 2) : r.markdown);
    return 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
