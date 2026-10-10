import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import type { Model } from "../model.js";
import { buildModel, type ModelSource } from "./build.js";

export const MODEL_DIR = ".archdoc";
const ROOT_FILES = ["archdoc.yaml", "archdoc.yml"];
const IGNORED_DIRS = new Set(["node_modules", ".git"]);

export interface LoadOptions {
  /** Base for the file paths shown in diagnostics. Defaults to the working directory. */
  cwd?: string;
}

export interface LoadedModel extends Model {
  /** Directory the model files were read from, or the single file loaded. */
  source: string;
  /** Repository root that `code:` paths are relative to. */
  baseDir: string;
}

/**
 * Loads a model from disk. `target` can be a repository (with a `.archdoc/`
 * directory), a model directory (with `archdoc.yaml`), or a single model file.
 */
export async function loadModel(target = ".", options: LoadOptions = {}): Promise<LoadedModel> {
  const cwd = options.cwd ?? process.cwd();
  const absolute = resolve(cwd, target);
  const display = (p: string) => relative(cwd, p) || basename(p);

  const found = await findModel(absolute);
  if (!found) {
    const empty = buildModel([]);
    empty.diagnostics.splice(0, empty.diagnostics.length, {
      severity: "error",
      code: "model/not-found",
      message: `No ArchDoc model at ${display(absolute)}. Expected ${MODEL_DIR}/archdoc.yaml.`,
    });
    return { ...empty, source: absolute, baseDir: absolute };
  }

  const sources: ModelSource[] = await Promise.all(
    found.files.map(async (file) => ({ path: display(file), text: await readFile(file, "utf8") })),
  );
  const model = buildModel(sources, { root: display(found.root) });
  return { ...model, source: found.dir ?? found.root, baseDir: found.baseDir };
}

async function findModel(
  path: string,
): Promise<{ root: string; files: string[]; dir?: string; baseDir: string } | undefined> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return undefined;
  if (info.isFile()) return { root: path, files: [path], baseDir: process.cwd() };

  for (const [dir, baseDir] of [
    [join(path, MODEL_DIR), path],
    [path, basename(path) === MODEL_DIR ? join(path, "..") : path],
  ] as const) {
    for (const name of ROOT_FILES) {
      const root = join(dir, name);
      if (await isFile(root)) {
        const others = (await listYaml(dir)).filter((f) => f !== root).sort();
        return { root, files: [root, ...others], dir, baseDir };
      }
    }
  }
  return undefined;
}

async function listYaml(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        out.push(...(await listYaml(full)));
      }
    } else if (/\.ya?ml$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() ?? false;
}
