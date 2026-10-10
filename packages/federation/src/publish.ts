import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  createBundle,
  type Diagnostic,
  type LoadedModel,
  loadModel,
  readModelSources,
  serializeBundle,
} from "@archdoc/core";
import type { Bundle } from "@archdoc/spec";
import semver from "semver";
import { git } from "./git.js";

export interface PublishOptions {
  /** Repository, .archdoc directory, or model file. Defaults to ".". */
  model?: string;
  cwd: string;
  /** Release version, such as 5.2.0. Defaults to the release tag on HEAD. */
  version?: string;
  /** Directory to write the bundle to, relative to cwd. Defaults to dist. */
  out?: string;
  /** Build the bundle without writing it. */
  dryRun?: boolean;
}

export interface PublishResult {
  model: LoadedModel;
  /** The problems that stopped it, if it didn't publish. */
  errors: Diagnostic[];
  bundle?: Bundle;
  text?: string;
  /** Display path of the bundle file, when written. */
  path?: string;
}

/**
 * Builds a versioned bundle of the model for other repos to import: from a
 * URL (attach the file to a release), or straight from git at the release
 * tag. Refuses a model with errors, including references into other repos
 * that don't resolve.
 */
export async function publish(options: PublishOptions): Promise<PublishResult> {
  const { cwd } = options;
  const model = await loadModel(options.model ?? ".", { cwd });
  const errors = model.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) return { model, errors };

  const version = options.version ?? (await tagVersion(model.baseDir, model.namespace));
  if (options.version && !semver.valid(options.version)) {
    throw new Error(`"${options.version}" isn't a version such as 5.2.0.`);
  }
  const commit = await git(model.baseDir, "rev-parse", "HEAD")
    .then((s) => s.trim())
    .catch(() => undefined);

  // Bundle paths are relative to the model directory, like the files other repos read at a tag.
  const read = await readModelSources(model.source, { cwd: model.source });
  if (!read) throw new Error(`No ArchDoc model at ${model.source}.`);
  const imports = Object.fromEntries(
    [...(model.imported?.values() ?? [])].flatMap((d) => {
      const v = d.version ?? d.commit;
      return v ? [[d.namespace, v]] : [];
    }),
  );
  const { bundle } = createBundle(read.sources, read.root, { version, commit, imports });
  if (!bundle) throw new Error("The model doesn't build.");
  const text = serializeBundle(bundle);
  if (options.dryRun) return { model, errors: [], bundle, text };

  const outDir = resolve(cwd, options.out ?? "dist");
  const file = join(outDir, `${bundle.namespace}${version ? `@${version}` : ""}.json`);
  await mkdir(outDir, { recursive: true });
  await writeFile(file, text);
  return { model, errors: [], bundle, text, path: relative(cwd, file) || file };
}

/** The version of the release tag on HEAD, if there is one. */
async function tagVersion(repo: string, namespace: string): Promise<string | undefined> {
  const tags = await git(repo, "tag", "--points-at", "HEAD").catch(() => "");
  for (const tag of tags.split("\n")) {
    const match =
      tag.trim().match(/^v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/) ??
      tag.trim().match(new RegExp(`^${namespace}(?:@|-v)(\\d+\\.\\d+\\.\\d+(?:-[\\w.-]+)?)$`));
    if (match?.[1] && semver.valid(match[1])) return match[1];
  }
  return undefined;
}
