import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  anchorError,
  checkTrace,
  context,
  diffModels,
  formatActor,
  formatAnchors,
  formatCheck,
  formatCode,
  formatContext,
  formatData,
  formatElement,
  formatJourney,
  formatLineage,
  formatOverview,
  formatSimulation,
  formatSum,
  formatTrace,
  getElement,
  type LoadedModel,
  lineage,
  listRepoFiles,
  loadModel,
  loadTraces,
  type MarkedFinding,
  prReport,
  readTraceSources,
  resolveRef,
  type SealStatus,
  sealSum,
  search,
  simulate,
  summarizeChange,
  traceSkeleton,
  tracesInChange,
} from "@archdoc/core";
import { parse } from "yaml";
import { checkRepository } from "./check.js";
import { formatInit, initModel } from "./init.js";
import { resealedSince, sealReport } from "./seals.js";
import { indexRepository } from "./symbols.js";

/**
 * The answers ArchDoc gives a coding agent, one per question, shared by the
 * MCP tools and the CLI commands of the same name so they never disagree:
 * where to start (context), what one thing is (show), what's wrong or stale
 * (check), and recording that facts were checked (seal).
 */
export interface Answer {
  /** False when the question couldn't be answered: no model, an unknown ID, bad input. */
  ok: boolean;
  text: string;
  /** The answer says something's wrong, such as errors check found; the CLI exits 1. */
  failing?: boolean | undefined;
}

export interface Where {
  /** Repository, .archdoc directory, or model file. Defaults to ".". */
  model?: string | undefined;
  cwd: string;
}

const NO_MODEL =
  "No ArchDoc model here. Expected .archdoc/archdoc.yaml. Run archdoc init to start one.";

async function withModel(
  where: Where,
  fn: (model: LoadedModel) => Answer | Promise<Answer>,
): Promise<Answer> {
  const model = await loadModel(where.model ?? ".", { cwd: where.cwd });
  if (model.diagnostics.some((d) => d.code === "model/not-found")) return fail(NO_MODEL);
  const errors = model.diagnostics.filter((d) => d.severity === "error").length;
  const r = await fn(model);
  return errors && r.ok
    ? {
        ...r,
        text: `${r.text}\n\nNote: the model has ${errors} error${errors === 1 ? "" : "s"}, so this may be incomplete. archdoc check lists them.`,
      }
    : r;
}

/** A path as the repository names it, from an absolute path or one relative to `from`. */
export function repoPath(model: LoadedModel, path: string, from = model.baseDir): string {
  const absolute = isAbsolute(path) ? path : resolve(from, path);
  return relative(model.baseDir, absolute).replace(/\\/g, "/");
}

export interface ContextInput {
  /** The task in a few words. */
  task?: string | undefined;
  /** Files or directories the task will change, repository-relative or absolute. */
  paths?: readonly string[] | undefined;
  /** An error: a log line, a stack trace, or wrong output. */
  error?: string | undefined;
}

/**
 * Where to start: with a task or paths, the brief (files and functions to
 * open, other code doing the same job, data, rules, journeys, tests, owners,
 * and who uses it); with an error, the journey steps it likely showed up in
 * and a trace to start from; with nothing, the overview.
 */
export function contextAnswer(where: Where, input: ContextInput): Promise<Answer> {
  return withModel(where, async (m) => {
    const task = input.task?.trim() ?? "";
    const paths = (input.paths ?? []).map((p) => repoPath(m, p, where.cwd));
    const error = input.error?.trim();
    if (!task && !paths.length && !error) return ok(formatOverview(m, 1));
    const out: string[] = [];
    if (error) {
      const files = await listRepoFiles(m.baseDir);
      const anchored = anchorError(m, error, { files, root: m.baseDir });
      out.push(formatAnchors(anchored, traceSkeleton(anchored, error)));
    }
    if (task || paths.length) {
      const index = await indexRepository(m.baseDir);
      out.push(formatContext(context(m, task, { index, paths })));
    }
    return ok(out.join("\n\n"));
  });
}

export interface ShowInput {
  /**
   * An element, actor, journey, data entry, trace, `Entry.field` (its
   * lineage), or a sealed fact (`element:<id>`, `step:<journey>#<n>`, ...).
   */
  id: string;
  /** For an element: the text of its code snippets. */
  code?: boolean | undefined;
  /**
   * For a journey: records that exist when it starts, by data entry, or a
   * JSON/YAML file of them. Runs the journey on them.
   */
  sample?: string | Record<string, unknown> | undefined;
}

const FACT = /^(element|contract|step|logic|mapping|data):/;

/** What one thing in the model is, whatever kind of ID names it. */
export function showAnswer(where: Where, input: ShowInput): Promise<Answer> {
  return withModel(where, async (m) => {
    const id = input.id.trim();
    if (FACT.test(id)) return showFact(where, id);

    const journey = m.journeys.get(id);
    if (input.sample !== undefined) {
      if (!journey) return fail(`A sample runs a journey, and "${id}" isn't one. ${known(m)}`);
      const sample = readSample(input.sample, where.cwd);
      if (typeof sample === "string") return fail(sample);
      const result = simulate(m, id, sample);
      if (!result) return fail(`No journey "${id}".`);
      return {
        ok: true,
        text: formatSimulation(result),
        failing: result.steps.some((s) => s.problems.length > 0),
      };
    }
    if (input.code) {
      const e = getElement(m, id)?.element;
      if (!e) return fail(`No element "${id}". ${hint(m, id)}`);
      return ok(formatCode(e.id, e.code, (p) => readRepoFile(m.baseDir, p)));
    }

    const sections = [
      formatElement(m, id),
      formatActor(m, id),
      journey ? formatJourney(m, journey) : undefined,
      formatData(m, id),
    ].filter((s): s is string => s !== undefined);
    if (sections.length) return ok(sections.join("\n\n"));

    // A field, as Entry.field: where its value comes from and goes.
    if (id.includes(".")) {
      const l = lineage(m, id);
      if (l) return ok(formatLineage(l));
    }
    // Traces aren't part of the model, but they have IDs too.
    const { traces } = loadTraces(await readTraceSources(where.model ?? ".", { cwd: where.cwd }));
    const trace = traces.find((t) => t.id === id);
    if (trace) {
      const files = await listRepoFiles(m.baseDir);
      const inRepo = new Set(files);
      const read = (p: string) => (inRepo.has(p) ? readRepoFile(m.baseDir, p) : undefined);
      return ok(formatTrace(checkTrace(m, trace, { files, read }).view));
    }
    return fail(`Nothing is called "${id}". ${hint(m, id)}`);
  });
}

async function showFact(where: Where, key: string): Promise<Answer> {
  const r = await sealReport(where.model ?? ".", where.cwd);
  if (!r) return fail(NO_MODEL);
  const s = r.statuses.find((x) => x.fact.key === key);
  if (!s) {
    const near = r.statuses.filter((x) => x.fact.key.startsWith(key.split("#")[0] as string));
    return fail(
      `No fact "${key}".${
        near.length
          ? ` Facts like it: ${near
              .slice(0, 6)
              .map((x) => x.fact.key)
              .join(", ")}.`
          : ""
      }`,
    );
  }
  const seal = r.recorded?.seals[key];
  return ok(
    [
      `${s.fact.label}${s.fact.location ? ` (${s.fact.location.file}:${s.fact.location.line})` : ""}`,
      `Points at ${s.fact.refs.join(", ")}`,
      s.state === "sealed"
        ? `Sealed${seal?.by ? ` by ${seal.by}` : ""}: the code matches.`
        : s.state === "changed"
          ? `Changed since it was sealed${seal?.by ? ` by ${seal.by}` : ""}:`
          : r.recorded
            ? "No one has sealed it yet."
            : `Nothing is sealed: ${r.file} doesn't exist yet.`,
      ...s.changes.map((c) => `  ${c}`),
      ...s.problems.map((p) => `  ! ${p}`),
      `Fingerprint: ${s.current.kind}, ${s.current.hash}`,
    ].join("\n"),
  );
}

export interface CheckInput {
  /** Branch or commit to compare with: findings are marked introduced or not, and the change is summed up. */
  base?: string | undefined;
  /** List every finding, not only the change's (or the first few). */
  all?: boolean | undefined;
  /** "markdown": with a base, the pull request comment. */
  format?: "text" | "markdown" | undefined;
  /** False checks the model only, without analyzing code. */
  code?: boolean | undefined;
}

export interface CheckAnswer extends Answer {
  findings: MarkedFinding[];
}

/**
 * What's wrong or stale: the model's own problems, drift from the code,
 * broken rules, facts whose sealed code changed, and traces that no longer
 * hold. With a base, also what the change does: the verdict, what blocks and
 * what to check, journeys, people to ask, and the model changes.
 */
export async function checkAnswer(where: Where, input: CheckInput = {}): Promise<CheckAnswer> {
  const checked = await checkRepository({
    model: where.model,
    cwd: where.cwd,
    base: input.base,
    code: input.code,
  });
  const { findings } = checked;
  if (!input.base || !checked.base) {
    return {
      ok: true,
      text: formatCheck(findings, { all: input.all }),
      failing: findings.some((f) => f.severity === "error"),
      findings,
    };
  }
  const base = checked.base;
  const { traces } = loadTraces(await readTraceSources(where.model ?? ".", { cwd: where.cwd }));
  const reportInput = {
    model: checked.model,
    base: base.model,
    changedFiles: base.changedFiles,
    diff: diffModels(base.model, checked.model),
    findings,
    diagrams: false,
    fixes: tracesInChange(base.changedFiles, traces),
    resealed: await resealedSince(where.model ?? ".", where.cwd, base.commit),
    label: `${input.base}...working tree`,
  };
  const introducedErrors = findings.some((f) => f.introduced && f.severity === "error");
  if (input.format === "markdown") {
    return {
      ok: true,
      text: prReport(reportInput).markdown.replace(/^<!--.*-->\n?/gm, ""),
      failing: introducedErrors,
      findings,
    };
  }
  return {
    ok: true,
    failing: introducedErrors,
    text: formatCheck(findings, {
      all: input.all,
      change: { summary: summarizeChange(reportInput), diff: reportInput.diff, base: input.base },
    }),
    findings,
  };
}

export interface SealInput {
  /** Facts to seal (keys, or element/journey/data IDs). Without any, new facts only. */
  facts?: readonly string[] | undefined;
  /** Seal every fact, changed or not. */
  all?: boolean | undefined;
  by?: string | undefined;
  dryRun?: boolean | undefined;
  /** Refuse to start an archdoc.sum without naming facts or --all (for agents). */
  requireSum?: boolean | undefined;
}

/**
 * Records that the model still describes the code these facts point at, and
 * says what's still to check, so the loop ends here.
 */
export async function sealAnswer(where: Where, input: SealInput): Promise<Answer> {
  const r = await sealReport(where.model ?? ".", where.cwd);
  if (!r) return fail(NO_MODEL);
  if (input.requireSum && !r.recorded && !r.error && !input.facts?.length && !input.all) {
    return fail(
      `This repository has no ${r.file} yet. A person starts sealing with archdoc seal --all, after checking the model describes the code.`,
    );
  }
  const { sum, sealed, unknown } = sealSum(r.statuses, {
    keys: input.facts,
    all: input.all || !!r.error,
    by: input.by,
  });
  if (unknown.length) {
    return fail(
      `Not a fact that points at code: ${unknown.join(", ")}. archdoc check names them, such as element:<id>, step:<journey>#<n>, logic:<id>, mapping:<id>, data:<id>.`,
    );
  }
  if (!input.dryRun) await writeFile(r.path, formatSum(sum));
  const out = [
    `${input.dryRun ? "Would seal" : "✓ Sealed"} ${sealed.length} fact${sealed.length === 1 ? "" : "s"} in ${r.file}${sealed.length && sealed.length <= 8 ? `: ${sealed.join(", ")}` : ""}.`,
  ];
  for (const s of r.statuses.filter((x) => x.problems.length && sealed.includes(x.fact.key))) {
    out.push(`  ! ${s.fact.label}: ${s.problems.join("; ")}`);
  }
  const left = r.statuses.filter((s) => s.state === "changed" && !sealed.includes(s.fact.key));
  if (left.length) {
    out.push(
      "",
      `${left.length} changed fact${left.length === 1 ? " is" : "s are"} still to check:`,
      ...left.flatMap(factLines),
      "",
      "Check each against the model, update it if it no longer holds, then seal it by name.",
    );
  } else {
    const total = r.statuses.length;
    const unsealed = r.statuses.filter(
      (s) => s.state === "unsealed" && !sealed.includes(s.fact.key),
    ).length;
    out.push(
      unsealed
        ? `${unsealed} new fact${unsealed === 1 ? "" : "s"} no one has sealed.`
        : `Every fact that points at code (${total}) matches its seal.`,
    );
  }
  return ok(out.join("\n"));
}

function factLines(s: SealStatus): string[] {
  return [
    `${s.fact.key}${s.fact.location ? ` (${s.fact.location.file}:${s.fact.location.line})` : ""}`,
    ...s.changes.slice(0, 8).map((c) => `  ${c}`),
    ...(s.changes.length > 8 ? [`  … and ${s.changes.length - 8} more`] : []),
  ];
}

/** Records by data entry, from an object, or a JSON or YAML file; a string says what's wrong. */
function readSample(
  sample: string | Record<string, unknown>,
  cwd: string,
): Record<string, unknown> | string {
  if (typeof sample !== "string") return sample;
  try {
    const parsed: unknown = parse(readFileSync(resolve(cwd, sample), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return `${sample} should map data entries to records, such as { RefundRequest: { amount_cents: 400 } }.`;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    return `Couldn't read ${sample}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** A file in the repository, or undefined when there's none (or it's outside it). */
export function readRepoFile(baseDir: string, path: string): string | undefined {
  const absolute = resolve(baseDir, path);
  if (relative(baseDir, absolute).startsWith("..")) return undefined;
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return undefined;
  }
}

function hint(m: LoadedModel, id: string): string {
  const r = resolveRef(m, id);
  if (r.status === "ambiguous") return `It could be ${r.candidates.join(", ")}.`;
  const near = search(m, id.replace(/[._-]+/g, " "), 5).map((h) => h.id);
  const parts = [
    r.status === "unresolved" && r.hint ? r.hint : "",
    near.length ? `Did you mean ${near.join(", ")}?` : "",
    "archdoc context finds IDs from words.",
  ];
  return parts.filter(Boolean).join(" ");
}

function known(m: LoadedModel): string {
  return `Journeys: ${[...m.journeys.keys()].join(", ") || "none"}.`;
}

function ok(text: string): Answer {
  return { ok: true, text };
}

function fail(text: string): Answer {
  return { ok: false, text };
}

export interface InitInput {
  /** The namespace; defaults to the root package's name or the directory's. */
  name?: string | undefined;
  dryRun?: boolean | undefined;
}

/**
 * A starting model for a repository without one, from its manifests, compose
 * files, imports, and schema files, every fact marked inferred; and what only
 * a person or an agent reading the code can add.
 */
export async function initAnswer(where: Where, input: InitInput = {}): Promise<Answer> {
  const root = resolve(where.cwd, where.model ?? ".");
  const r = await initModel(root, input);
  return { ok: !r.refused && !r.problems.length, text: formatInit(r) };
}
