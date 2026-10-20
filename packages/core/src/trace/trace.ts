import {
  type TraceCodeSpec,
  type TraceFile,
  TraceFileSchema,
  type TraceStepSpec,
} from "@archdoc/spec";
import type { Diagnostic, SourceLocation } from "../diagnostics.js";
import { schemaDiagnostics } from "../load/build.js";
import { parseYaml, type YamlPath } from "../load/yaml.js";

/** A trace as written, without the editor fields. */
export type TraceSpec = Omit<TraceFile, "$schema" | "archdoc">;

/**
 * A trace: the path one failing request took, read from
 * `.archdoc/traces/<id>.yaml`. Never part of the model.
 */
export interface Trace {
  id: string;
  /** The file it was read from, as given to {@link parseTrace}. */
  file: string;
  spec: TraceSpec;
  /** Where things are written, by dotted path such as `expands` or `steps.1.from`. */
  locations: Record<string, SourceLocation>;
}

export interface ParsedTraces {
  traces: Trace[];
  /** YAML and schema problems, and duplicate IDs. */
  diagnostics: Diagnostic[];
}

/** One code reference in a trace, with `path:line` read apart. */
export interface TraceCodeRef {
  path: string;
  /** One line or a range, as written (`42` or `40-88`). */
  lines?: string | undefined;
  symbol?: string | undefined;
  description?: string | undefined;
}

/** Parses one trace file. Returns no trace when the YAML or the schema doesn't hold. */
export function parseTrace(
  file: string,
  text: string,
): { trace?: Trace | undefined; diagnostics: Diagnostic[] } {
  const { parsed, diagnostics } = parseYaml(file, text);
  if (!parsed) return { diagnostics };
  if (parsed.value === null || typeof parsed.value !== "object") {
    return {
      diagnostics: [
        ...diagnostics,
        {
          severity: "error",
          code: "trace/not-a-trace",
          message: 'A trace file needs "trace", "title", "symptom", and "steps".',
          location: { file, line: 1, column: 1 },
        },
      ],
    };
  }
  const result = TraceFileSchema.safeParse(parsed.value);
  if (!result.success) {
    return { diagnostics: [...diagnostics, ...schemaDiagnostics(result.error, parsed)] };
  }
  const { $schema: _s, archdoc: _a, ...spec } = result.data;
  const locations: Record<string, SourceLocation> = {};
  const at = (path: YamlPath) => {
    locations[path.join(".")] = parsed.locate(path);
  };
  for (const key of ["trace", "expands", "actor", "works-in", "works-in.element", "works-in.code"])
    at(key.split("."));
  for (const [i, step] of spec.steps.entries()) {
    at(["steps", i]);
    for (const key of ["from", "to", "code"] as const)
      if (step[key] !== undefined) at(["steps", i, key]);
    if (step.missing) at(["steps", i, "missing", "to"]);
  }
  return { trace: { id: spec.trace, file, spec, locations }, diagnostics };
}

/** Parses trace files (the CLI reads them), and reports two traces with the same ID. */
export function loadTraces(sources: readonly { path: string; text: string }[]): ParsedTraces {
  const traces: Trace[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, Trace>();
  for (const source of sources) {
    const r = parseTrace(source.path, source.text);
    diagnostics.push(...r.diagnostics);
    if (!r.trace) continue;
    const before = seen.get(r.trace.id);
    if (before) {
      diagnostics.push({
        severity: "error",
        code: "trace/duplicate",
        message: `Trace "${r.trace.id}" is also in ${before.file}.`,
        location: r.trace.locations.trace,
      });
      continue;
    }
    seen.set(r.trace.id, r.trace);
    traces.push(r.trace);
  }
  return { traces, diagnostics };
}

/** A trace's `expands`, read apart: the journey (maybe namespaced) and the 1-based step. */
export function parseExpands(expands: string): { journey: string; step: number } | undefined {
  const m = /^(.+)#(\d+)$/.exec(expands);
  if (!m) return undefined;
  return { journey: m[1] as string, step: Number(m[2]) };
}

/**
 * The code references in a trace's `code:`: `path`, `path:line`,
 * `path:40-88`, `path:line:column`, or `{ path, lines, symbol }`.
 */
export function traceCodeRefs(code: TraceCodeSpec | undefined): TraceCodeRef[] {
  if (code === undefined) return [];
  const list = Array.isArray(code) ? code : [code];
  return list.map((c) => {
    if (typeof c !== "string") {
      return {
        path: c.path,
        lines: c.lines === undefined ? undefined : String(c.lines),
        symbol: c.symbol,
        description: c.description,
      };
    }
    const range = /^(.+?):(\d+)-(\d+)$/.exec(c);
    if (range) return { path: range[1] as string, lines: `${range[2]}-${range[3]}` };
    const line = /^(.+?):(\d+)(?::\d+)?$/.exec(c);
    if (line) return { path: line[1] as string, lines: line[2] };
    return { path: c };
  });
}

/** A code reference as people write it: path:42 or path:40-88 (symbol). */
export function traceCodeLabel(ref: TraceCodeRef): string {
  return `${ref.path}${ref.lines ? `:${ref.lines}` : ""}${ref.symbol ? ` (${ref.symbol})` : ""}`;
}

/** The step's role, with the default. */
export function traceRoleOf(step: TraceStepSpec) {
  return step.role ?? "ok";
}

/** The step's evidence, with the default. */
export function traceEvidenceOf(step: TraceStepSpec) {
  return step.evidence ?? "inferred";
}
