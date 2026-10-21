import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  anchorError,
  checkTrace,
  type Diagnostic,
  formatAnchors,
  formatTrace,
  formatTraceChecks,
  formatTraceList,
  type LoadedModel,
  listRepoFiles,
  loadTraces,
  readTraceSources,
  type Trace,
  type TraceCheck,
  traceSkeleton,
} from "@archdoc/core";
import type { Io } from "../io.js";
import { load, type ModelOptions, readRepoFile } from "./code.js";

export interface TraceCheckOptions extends ModelOptions {
  format?: string;
}

/** The repository's traces, or the files named. */
async function readTraces(
  files: readonly string[],
  options: ModelOptions,
  io: Io,
): Promise<{ traces: Trace[]; problems: Diagnostic[] }> {
  const sources = files.length
    ? await Promise.all(
        files.map(async (f) => ({
          path: relative(io.cwd, resolve(io.cwd, f)) || f,
          text: await readFile(resolve(io.cwd, f), "utf8"),
        })),
      )
    : await readTraceSources(options.model ?? ".", { cwd: io.cwd });
  const { traces, diagnostics } = loadTraces(sources);
  return { traces, problems: diagnostics };
}

/** Checks traces against the model and the code: every trace in .archdoc/traces/, or the files named. */
export async function runTraceCheck(
  model: LoadedModel,
  traces: readonly Trace[],
): Promise<TraceCheck[]> {
  const files = await listRepoFiles(model.baseDir);
  const inRepo = new Set(files);
  const read = (path: string) => (inRepo.has(path) ? readRepoFile(model.baseDir, path) : undefined);
  return traces.map((t) => checkTrace(model, t, { files, read }));
}

export async function traceCheck(
  files: string[],
  options: TraceCheckOptions,
  io: Io,
): Promise<number> {
  const format = options.format ?? (options.json ? "json" : "text");
  if (!["text", "json"].includes(format)) {
    io.err("--format must be text or json.");
    return 2;
  }
  const model = await load(options, io);
  if (!model) return 2;
  let read: Awaited<ReturnType<typeof readTraces>>;
  try {
    read = await readTraces(files, options, io);
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const checks = await runTraceCheck(model, read.traces);
  io.out(
    format === "json"
      ? JSON.stringify(
          {
            problems: read.problems,
            traces: checks.map((c) => ({
              id: c.trace.id,
              file: c.trace.file,
              findings: c.findings,
              view: c.view,
            })),
          },
          null,
          2,
        )
      : formatTraceChecks(checks, read.problems),
  );
  const failed =
    read.problems.some((d) => d.severity === "error") ||
    checks.some((c) => c.findings.some((f) => f.severity === "error"));
  return failed ? 1 : 0;
}

export async function traceList(options: ModelOptions, io: Io): Promise<number> {
  const model = await load(options, io);
  if (!model) return 2;
  const { traces, problems } = await readTraces([], options, io);
  for (const d of problems) io.err(`${d.severity} ${d.code} ${d.message}`);
  io.out(
    options.json
      ? JSON.stringify(
          traces.map((t) => ({
            id: t.id,
            title: t.spec.title,
            expands: t.spec.expands,
            file: t.file,
          })),
          null,
          2,
        )
      : formatTraceList(traces),
  );
  return 0;
}

/** A trace, resolved against the model, by its ID or file. */
export async function findTrace(
  model: LoadedModel,
  id: string,
  options: ModelOptions,
  io: Io,
): Promise<TraceCheck | undefined> {
  const asFile = /\.ya?ml$/.test(id);
  const { traces } = await readTraces(asFile ? [id] : [], options, io);
  const trace = asFile ? traces[0] : traces.find((t) => t.id === id);
  if (!trace) return undefined;
  return (await runTraceCheck(model, [trace]))[0];
}

export async function traceShow(id: string, options: ModelOptions, io: Io): Promise<number> {
  const model = await load(options, io);
  if (!model) return 2;
  const found = await findTrace(model, id, options, io).catch(() => undefined);
  if (!found) {
    io.err(`No trace "${id}" in .archdoc/traces/. List them with "archdoc trace list".`);
    return 1;
  }
  io.out(options.json ? JSON.stringify(found.view, null, 2) : formatTrace(found.view));
  return 0;
}

export interface TraceAnchorOptions extends ModelOptions {
  file?: string;
  limit?: string;
  /** False leaves out the suggested trace. */
  skeleton?: boolean;
}

/** Where an error belongs: ranked journey steps, and a trace to start from. */
export async function traceAnchor(
  words: string[],
  options: TraceAnchorOptions,
  io: Io,
  stdin: () => Promise<string> = readStdin,
): Promise<number> {
  let text: string;
  try {
    text = options.file
      ? await readFile(resolve(io.cwd, options.file), "utf8")
      : words.length === 1 && words[0] === "-"
        ? await stdin()
        : words.join(" ");
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
  if (!text.trim()) {
    io.err("Give the error: archdoc trace anchor <text>, --file log.txt, or - to read stdin.");
    return 2;
  }
  const model = await load(options, io);
  if (!model) return 2;
  const files = await listRepoFiles(model.baseDir);
  const limit = options.limit ? Number(options.limit) : undefined;
  const result = anchorError(model, text, { files, root: model.baseDir, limit });
  const skeleton = options.skeleton === false ? undefined : traceSkeleton(result, text);
  io.out(
    options.json
      ? JSON.stringify({ ...result, skeleton }, null, 2)
      : formatAnchors(result, skeleton),
  );
  return result.anchors.length || result.elements.length ? 0 : 1;
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
