import {
  check,
  diffModels,
  type Finding,
  loadModel,
  type MarkedFinding,
  prReport,
} from "@archdoc/core";
import type { Io } from "../io.js";
import { isModelPath } from "../model-path.js";
import { runCheck } from "./check.js";

export interface ReportOptions {
  model?: string;
  base?: string;
  format?: string;
  /** False leaves out the Mermaid diagrams. */
  diagrams?: boolean;
  /** A page that shows the change in the explorer, linked from the comment. */
  explorerUrl?: string;
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
    if (isModelPath(io.cwd, options.base)) return await reportFiles(options.base, options, io);
    const { model, findings, base } = await runCheck(
      { model: options.model, base: options.base },
      io.cwd,
    );
    if (!base) throw new Error(`Couldn't read the model at ${options.base}.`);
    const baseModel = base.model;
    const changed = base.changedFiles;
    const r = prReport({
      model,
      base: baseModel,
      changedFiles: changed,
      diff: diffModels(baseModel, model),
      findings,
      diagrams: options.diagrams !== false,
      explorerUrl: options.explorerUrl,
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

/**
 * The report for two models on disk, such as an example and its variant: the
 * model checked on its own (there's no code to compare it with), with what the
 * base didn't already have marked as introduced.
 */
async function reportFiles(base: string, options: ReportOptions, io: Io): Promise<number> {
  const target = options.model ?? ".";
  const [baseModel, model] = await Promise.all([
    loadModel(base, { cwd: io.cwd }),
    loadModel(target, { cwd: io.cwd }),
  ]);
  const key = (f: Finding) => `${f.code} ${f.message}`;
  const before = new Set(check(baseModel).findings.map(key));
  const findings: MarkedFinding[] = check(model).findings.map((f) => ({
    ...f,
    introduced: !before.has(key(f)),
  }));
  const r = prReport({
    model,
    base: baseModel,
    changedFiles: [],
    diff: diffModels(baseModel, model),
    findings,
    diagrams: options.diagrams !== false,
    label: `${base} → ${target}`,
  });
  io.out(
    (options.format ?? "markdown") === "json"
      ? JSON.stringify({ ...r, markdown: undefined }, null, 2)
      : r.markdown,
  );
  return 0;
}
