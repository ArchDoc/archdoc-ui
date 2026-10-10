import { isAbsolute, relative, resolve } from "node:path";
import {
  filesUnder,
  formatActor,
  formatElement,
  formatImpact,
  formatJourney,
  formatLocate,
  formatSearch,
  hasErrors,
  impact as impactOf,
  impactToJSON,
  type LoadedModel,
  listRepoFiles,
  loadModel,
  locatedToJSON,
  locate as locateIn,
  resolveCodeMap,
  resolveRef,
  search as searchModel,
} from "@archdoc/core";
import type { Io } from "../io.js";

export interface ModelOptions {
  /** Repository, .archdoc directory, or model file. */
  model?: string;
  json?: boolean;
}

async function load(options: ModelOptions, io: Io): Promise<LoadedModel | undefined> {
  const model = await loadModel(options.model ?? ".", { cwd: io.cwd });
  if (model.diagnostics.some((d) => d.code === "model/not-found")) {
    io.err(model.diagnostics[0]?.message ?? "No model found.");
    return undefined;
  }
  if (hasErrors(model.diagnostics)) {
    io.err('warning: the model has errors, so answers may be incomplete. Run "archdoc validate".');
  }
  return model;
}

/** A path from the command line, relative to the repository root. */
function repoPath(model: LoadedModel, io: Io, path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(io.cwd, path);
  return relative(model.baseDir, absolute).replace(/\\/g, "/");
}

export async function search(words: string[], options: ModelOptions, io: Io): Promise<number> {
  const model = await load(options, io);
  if (!model) return 1;
  const query = words.join(" ");
  const hits = searchModel(model, query, 10);
  io.out(options.json ? JSON.stringify(hits, null, 2) : formatSearch(query, hits));
  return hits.length ? 0 : 1;
}

export async function locate(paths: string[], options: ModelOptions, io: Io): Promise<number> {
  const model = await load(options, io);
  if (!model) return 1;
  const results = paths.map((p) => locateIn(model, repoPath(model, io, p)));
  io.out(
    options.json
      ? JSON.stringify(
          results.map((r) => locatedToJSON(model, r)),
          null,
          2,
        )
      : formatLocate(model, results),
  );
  return 0;
}

export async function impact(target: string, options: ModelOptions, io: Io): Promise<number> {
  const model = await load(options, io);
  if (!model) return 1;
  // A target that looks like a file path is taken relative to where the command runs.
  const asPath = target.includes("/") || /\.[a-z]+$/i.test(target);
  let result = impactOf(model, asPath ? repoPath(model, io, target) : target);
  if (!result.ok && asPath) result = impactOf(model, target);
  if (!result.ok) {
    io.err(result.reason);
    if (result.candidates) io.err(`Did you mean: ${result.candidates.join(", ")}?`);
    return 1;
  }
  io.out(
    options.json
      ? JSON.stringify(impactToJSON(result.impact), null, 2)
      : formatImpact(model, result.impact),
  );
  return 0;
}

export async function map(options: ModelOptions & { unmapped?: boolean }, io: Io): Promise<number> {
  const model = await load(options, io);
  if (!model) return 1;
  const files = await listRepoFiles(model.baseDir);
  const codemap = resolveCodeMap(model, files);
  const top = [...model.elements.values()].filter((e) => e.depth === 0);
  const mapped = files.length - codemap.unmapped.length;

  if (options.json) {
    io.out(
      JSON.stringify(
        {
          files: files.length,
          mapped,
          elements: Object.fromEntries(
            [...model.elements.keys()].map((id) => [id, filesUnder(model, codemap, id).length]),
          ),
          unmapped: codemap.unmapped,
          stale: codemap.stale,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const lines = [`${mapped} of ${files.length} files map to an element.`, ""];
  const walk = (id: string, indent: string) => {
    const e = model.elements.get(id);
    if (!e) return;
    const n = filesUnder(model, codemap, id).length;
    const note =
      e.spec.status === "planned"
        ? " (planned)"
        : e.code.length === 0 && n === 0
          ? " (no code paths)"
          : "";
    lines.push(`${indent}${e.key}  ${n} file${n === 1 ? "" : "s"}${note}`);
    for (const c of e.childIds) walk(c, `${indent}  `);
  };
  for (const e of top) walk(e.id, "  ");
  if (codemap.stale.length) {
    lines.push("", "Code paths that match no files:");
    for (const s of codemap.stale) lines.push(`  ${s.element}: ${s.pattern}`);
  }
  if (codemap.unmapped.length) {
    lines.push(
      "",
      `${codemap.unmapped.length} unmapped file${codemap.unmapped.length === 1 ? "" : "s"}${options.unmapped ? ":" : " (list them with --unmapped)"}`,
    );
    if (options.unmapped) for (const f of codemap.unmapped) lines.push(`  ${f}`);
  }
  io.out(lines.join("\n"));
  return 0;
}

/** Prints the details of an element, actor, or journey by ID. */
export async function show(id: string, options: ModelOptions, io: Io): Promise<number> {
  const model = await load(options, io);
  if (!model) return 1;
  const journey = model.journeys.get(id);
  const sections = [
    formatElement(model, id),
    formatActor(model, id),
    journey ? formatJourney(model, journey) : undefined,
  ].filter((s): s is string => s !== undefined);

  if (sections.length === 0) {
    const r = resolveRef(model, id);
    if (r.status === "ambiguous") {
      io.err(`"${id}" is ambiguous: ${r.candidates.join(", ")}.`);
    } else {
      io.err(`No element, actor, or journey "${id}".`);
      if (r.status === "unresolved" && r.hint) io.err(r.hint);
      const near = searchModel(model, id.replace(/[._-]+/g, " "), 5);
      if (near.length) io.err(`Did you mean: ${near.map((h) => h.id).join(", ")}?`);
      io.err('Find IDs with "archdoc search <words>".');
    }
    return 1;
  }
  io.out(sections.join("\n\n"));
  return 0;
}
