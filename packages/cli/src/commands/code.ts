import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { showAnswer } from "@archdoc/analyzers";
import {
  filesUnder,
  hasErrors,
  type LoadedModel,
  listRepoFiles,
  loadModel,
  resolveCodeMap,
} from "@archdoc/core";
import type { Io } from "../io.js";

export interface ModelOptions {
  /** Repository, .archdoc directory, or model file. */
  model?: string;
  json?: boolean;
}

export async function load(options: ModelOptions, io: Io): Promise<LoadedModel | undefined> {
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
/**
 * `archdoc show <id>`: one thing in the model, whatever kind of ID names it:
 * an element, actor, journey, data entry,
 * Entry.field (its lineage), trace, or a sealed fact. What archdoc_show answers.
 */
export async function show(
  id: string,
  options: ModelOptions & { code?: boolean },
  io: Io,
): Promise<number> {
  const r = await showAnswer({ model: options.model, cwd: io.cwd }, { id, code: options.code });
  if (!r.ok) {
    io.err(r.text);
    return 1;
  }
  io.out(r.text);
  return r.failing ? 1 : 0;
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
