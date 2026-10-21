import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { contextAnswer, indexRepository } from "@archdoc/analyzers";
import {
  context as contextOf,
  evaluate,
  formatContext,
  formatEval,
  hasErrors,
  type LoadedModel,
  loadModel,
  recentCommits,
  resolveGitRef,
} from "@archdoc/core";
import type { Io } from "../io.js";
import { readStdin } from "./trace.js";

export interface ContextOptions {
  model?: string;
  format?: string;
  json?: boolean;
  /** A file with the error to place, or - for stdin. */
  error?: string;
}

async function load(model: string | undefined, io: Io): Promise<LoadedModel | undefined> {
  const m = await loadModel(model ?? ".", { cwd: io.cwd });
  if (m.diagnostics.some((d) => d.code === "model/not-found")) {
    io.err(m.diagnostics[0]?.message ?? "No model found.");
    return undefined;
  }
  if (hasErrors(m.diagnostics)) {
    io.err('warning: the model has errors, so answers may be incomplete. Run "archdoc validate".');
  }
  return m;
}

function formatOf(options: ContextOptions, io: Io): "text" | "json" | undefined {
  const format = options.json ? "json" : (options.format ?? "text");
  if (format !== "text" && format !== "json") {
    io.err("--format must be text or json.");
    return undefined;
  }
  return format;
}

/**
 * `archdoc context <words…|paths…>`: where to start a task. Arguments that
 * are paths (they contain a slash, or exist) are taken relative to where the
 * command runs; the rest are the task in words.
 */
export async function context(
  args: string[],
  options: ContextOptions,
  io: Io,
  stdin: () => Promise<string> = readStdin,
): Promise<number> {
  const format = formatOf(options, io);
  if (!format) return 2;
  // An error to place, or nothing (the overview): what archdoc_context answers.
  if (options.error !== undefined || !args.length) {
    let error: string | undefined;
    try {
      if (options.error !== undefined) {
        error =
          options.error === "-"
            ? await stdin()
            : await readFile(resolve(io.cwd, options.error), "utf8");
      }
    } catch (err) {
      io.err(err instanceof Error ? err.message : String(err));
      return 2;
    }
    const words = args.filter(
      (a) => !(a.includes("/") || a.includes("\\") || existsSync(resolve(io.cwd, a))),
    );
    const r = await contextAnswer(
      { model: options.model, cwd: io.cwd },
      { task: words.join(" "), paths: args.filter((a) => !words.includes(a)), error },
    );
    (r.ok ? io.out : io.err)(r.text);
    return r.ok ? 0 : 1;
  }
  const model = await load(options.model, io);
  if (!model) return 1;
  const words: string[] = [];
  const paths: string[] = [];
  for (const arg of args) {
    const absolute = isAbsolute(arg) ? arg : resolve(io.cwd, arg);
    if (arg.includes("/") || arg.includes("\\") || existsSync(absolute)) {
      paths.push(relative(model.baseDir, absolute).replace(/\\/g, "/"));
    } else {
      words.push(arg);
    }
  }
  const index = await indexRepository(model.baseDir);
  const brief = contextOf(model, words.join(" "), { index, paths });
  io.out(format === "json" ? JSON.stringify(brief, null, 2) : formatContext(brief));
  return brief.start.length ? 0 : 1;
}

export interface EvalOptions extends ContextOptions {
  commits?: string;
  minRecall?: string;
  verbose?: boolean;
}

/**
 * `archdoc eval [ref]`: replays recent commits through `context` and reports
 * how many of the files they changed the brief pointed at. Read-only: it
 * reads the history with git log, and the model and code as they are now.
 */
export async function evalCommand(
  ref: string | undefined,
  options: EvalOptions,
  io: Io,
): Promise<number> {
  const format = formatOf(options, io);
  if (!format) return 2;
  const count = Number(options.commits ?? 50);
  if (!Number.isInteger(count) || count < 1) {
    io.err("--commits must be a positive whole number.");
    return 2;
  }
  const min = options.minRecall === undefined ? undefined : Number(options.minRecall);
  if (min !== undefined && !(min >= 0 && min <= 1)) {
    io.err("--min-recall must be a number from 0 to 1, such as 0.5.");
    return 2;
  }
  const model = await load(options.model, io);
  if (!model) return 1;
  const at = ref ?? "HEAD";
  if (!(await resolveGitRef(model.baseDir, at))) {
    io.err(`${at} is not a commit, branch, or tag.`);
    return 2;
  }
  const [commits, index] = await Promise.all([
    recentCommits(model.baseDir, at, count),
    indexRepository(model.baseDir),
  ]);
  const report = evaluate(model, index, commits);
  io.out(format === "json" ? JSON.stringify(report, null, 2) : formatEval(report, options.verbose));
  if (min !== undefined && report.recall < min) {
    io.err(
      `Recall ${Math.round(report.recall * 100)}% is below --min-recall ${Math.round(min * 100)}%.`,
    );
    return 1;
  }
  return 0;
}
