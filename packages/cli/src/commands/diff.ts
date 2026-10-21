import { loadRevision } from "@archdoc/analyzers";
import {
  type DiffFormat,
  diffModels,
  formatDiff,
  isEmptyDiff,
  loadModel,
  type Model,
  mergeBase,
} from "@archdoc/core";
import type { Io } from "../io.js";
import { isModelPath } from "../model-path.js";

export interface DiffOptions {
  model?: string;
  format?: string;
  /** Exit 1 when the model changed, like `git diff --exit-code`. */
  exitCode?: boolean;
}

const FORMATS = ["text", "markdown", "mermaid", "json"];

/**
 * `archdoc diff [range]`. No range: HEAD against the working tree. `main`:
 * main against the working tree. `a..b`: a against b. `a...b`: the merge base
 * of a and b against b, which is what a pull request shows. Two model
 * files: the first against the second.
 */
export async function diff(
  range: string | undefined,
  options: DiffOptions,
  io: Io,
  /** With a model path as `range`, the model to compare it with; else --model. */
  after?: string,
): Promise<number> {
  const format = (options.format ?? "text") as DiffFormat;
  if (!FORMATS.includes(format)) {
    io.err(`--format must be one of ${FORMATS.join(", ")}.`);
    return 1;
  }
  const target = options.model ?? ".";
  try {
    // Two models on disk, such as an example and its variant: the first against the second.
    if (range && isModelPath(io.cwd, range)) {
      const other = after ?? target;
      const [base, model] = await Promise.all([
        loadModel(range, { cwd: io.cwd }),
        loadModel(other, { cwd: io.cwd }),
      ]);
      warnOnErrors(base, range, io);
      warnOnErrors(model, other, io);
      const d = diffModels(base, model);
      io.out(formatDiff(d, format, `${range} → ${other}`));
      return options.exitCode && !isEmptyDiff(d) ? 1 : 0;
    }
    if (after) {
      io.err(`${range} isn't a model file. Compare two model files, or give a git range.`);
      return 2;
    }
    const sides = await resolveRange(range ?? "HEAD", io.cwd);
    // Both sides as every surface reads them: schema sources and other repos' models included.
    const at = async (ref: string | undefined) => {
      const rev = await loadRevision(target, { cwd: io.cwd, ref });
      if (!rev) throw new Error(`No ArchDoc model at ${target}. Expected .archdoc/archdoc.yaml. Run archdoc init to start one.`);
      return rev.model;
    };
    const [base, head] = await Promise.all([at(sides.base), at(sides.head)]);
    warnOnErrors(base, `${sides.base}`, io);
    warnOnErrors(head, sides.head ?? "working tree", io);
    const d = diffModels(base, head);
    io.out(formatDiff(d, format, `${sides.label} → ${sides.head ?? "working tree"}`));
    return options.exitCode && !isEmptyDiff(d) ? 1 : 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

async function resolveRange(
  range: string,
  cwd: string,
): Promise<{ base: string; head?: string; label: string }> {
  const three = range.split("...");
  if (three.length === 2) {
    const [a, b] = three as [string, string];
    const base = await mergeBase(cwd, a || "HEAD", b || "HEAD");
    if (!base) throw new Error(`No common ancestor for ${a} and ${b}.`);
    return { base, head: b || "HEAD", label: `merge base with ${a || "HEAD"}` };
  }
  const two = range.split("..");
  if (two.length === 2) {
    const [a, b] = two as [string, string];
    return { base: a || "HEAD", head: b || "HEAD", label: a || "HEAD" };
  }
  return { base: range, label: range };
}

function warnOnErrors(model: Model, side: string, io: Io) {
  const errors = model.diagnostics.filter(
    (d) => d.severity === "error" && d.code !== "model/not-found",
  );
  if (errors.length)
    io.err(
      `warning: the model at ${side} has ${errors.length} error(s); the diff may be incomplete.`,
    );
}
