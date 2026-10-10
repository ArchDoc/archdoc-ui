import { execFile } from "node:child_process";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { Model } from "../model.js";
import { buildModel, type ModelSource } from "./build.js";
import { type LoadOptions, readModelSources } from "./fs.js";

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** The commit a ref names, or undefined if it doesn't exist. */
export async function resolveRef(cwd: string, ref: string): Promise<string | undefined> {
  try {
    return (
      (await git(cwd, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`)).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export async function mergeBase(cwd: string, a: string, b: string): Promise<string | undefined> {
  try {
    return (await git(cwd, "merge-base", a, b)).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the model as it was at a git ref. The model is found in the working
 * tree first (to learn where it lives), then read from the ref. A model that
 * didn't exist yet at the ref comes back empty, so a diff shows everything as
 * added.
 */
export interface SourcesAtRef {
  ref: string;
  commit: string;
  /** Display path of the root file, such as main:.archdoc/archdoc.yaml. Empty when there was no model. */
  root: string;
  sources: ModelSource[];
}

/**
 * The model's files as they were at a git ref. The model is found in the
 * working tree first (to learn where it lives), then read from the ref. A
 * model that didn't exist yet at the ref comes back with no sources.
 */
export async function readModelSourcesAtRef(
  target: string,
  ref: string,
  options: LoadOptions = {},
): Promise<SourcesAtRef> {
  const cwd = options.cwd ?? process.cwd();
  const commit = await resolveRef(cwd, ref);
  if (!commit) throw new Error(`"${ref}" is not a commit, branch, or tag in this repository.`);

  const local = await readModelSources(target, options);
  const top = (await git(cwd, "rev-parse", "--show-toplevel")).trim();
  const source = local?.source ?? resolve(cwd, target);
  const rel = relative(top, source).replace(/\\/g, "/");

  const listing = await git(
    top,
    "ls-tree",
    "-r",
    "--name-only",
    "-z",
    commit,
    "--",
    rel || ".",
  ).catch(() => "");
  const files = listing
    .split("\0")
    .filter((f) => /\.ya?ml$/.test(f) && !/(^|\/)archdoc\.lock$/.test(f))
    .filter(
      (f) =>
        !f
          .split("/")
          .some((part) => part === "node_modules" || (part.startsWith(".") && part !== ".archdoc")),
    );
  const rootFile = files.find((f) => /(^|\/)archdoc\.ya?ml$/.test(f)) ?? files[0];
  const ordered = rootFile ? [rootFile, ...files.filter((f) => f !== rootFile).sort()] : [];

  const sources = await Promise.all(
    ordered.map(async (f) => ({
      path: `${ref}:${f}`,
      text: await git(top, "show", `${commit}:${f}`),
    })),
  );
  return { ref, commit, root: rootFile ? `${ref}:${rootFile}` : "", sources };
}

/** Builds the model as it was at a git ref. See {@link readModelSourcesAtRef}. */
export async function loadModelAtRef(
  target: string,
  ref: string,
  options: LoadOptions = {},
): Promise<Model & { ref: string; commit: string }> {
  const at = await readModelSourcesAtRef(target, ref, options);
  const model = at.sources.length ? buildModel(at.sources, { root: at.root }) : buildModel([]);
  return Object.assign(model, { ref, commit: at.commit });
}

/** Files changed between a commit and the working tree (or another commit), relative to the repo root. */
export async function changedFiles(cwd: string, base: string, head?: string): Promise<string[]> {
  const args = ["diff", "--name-only", "-z", base, ...(head ? [head] : []), "--"];
  const tracked = (await git(cwd, ...args)).split("\0").filter(Boolean);
  const untracked = head
    ? []
    : (await git(cwd, "ls-files", "--others", "--exclude-standard", "-z"))
        .split("\0")
        .filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}
