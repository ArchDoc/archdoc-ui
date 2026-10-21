import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  type Diagnostic,
  formatTraceList,
  loadTraces,
  readTraceSources,
  type Trace,
} from "@archdoc/core";
import type { Io } from "../io.js";
import { load, type ModelOptions } from "./code.js";

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

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
