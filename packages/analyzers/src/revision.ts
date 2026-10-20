import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  applySchemas,
  buildModel,
  changedFiles,
  federate,
  federationDir,
  type ImportedSchema,
  type LoadedModel,
  listFilesAtRef,
  listRepoFiles,
  type ModelSource,
  readFederationInput,
  readFileAtRef,
  readModelSources,
  readModelSourcesAtRef,
} from "@archdoc/core";
import type { AnalyzerContext } from "./api.js";
import { importSchemas } from "./schemas/index.js";

/** One version of a repository's model: the working tree, or a commit. */
export interface Snapshot {
  /** The ref it was read at; undefined for the working tree. */
  ref?: string | undefined;
  commit?: string | undefined;
  /** Display path of the root model file. Empty when there was no model. */
  root: string;
  sources: ModelSource[];
  /** The model directory (or single file) in the working tree. */
  source: string;
  /** Directory repository paths are relative to. */
  baseDir: string;
  /** Repository files, relative to `baseDir`. */
  files: string[];
  /** Where archdoc.lock and vendor/ are. */
  fedDir: string;
  /** Reads a repository file by its path relative to `baseDir`. */
  read(path: string): Promise<string | undefined>;
}

export interface SnapshotOptions {
  cwd: string;
  /** A branch, tag, or commit. Omit for the working tree. */
  ref?: string | undefined;
}

/**
 * The model's files and the repository's files at a ref, or in the working
 * tree. Undefined when there's no model in the working tree to say where it
 * lives.
 */
export async function snapshot(
  target: string,
  options: SnapshotOptions,
): Promise<Snapshot | undefined> {
  const { cwd, ref } = options;
  const local = await readModelSources(target, { cwd });
  if (!local) return undefined;
  const fedDir = await federationDir(local.source);
  if (ref === undefined) {
    return {
      root: local.root,
      sources: local.sources,
      source: local.source,
      baseDir: local.baseDir,
      files: await listRepoFiles(local.baseDir),
      fedDir,
      read: (path) => readFile(join(local.baseDir, path), "utf8").catch(() => undefined),
    };
  }
  const at = await readModelSourcesAtRef(target, ref, { cwd });
  // Files that read the same at the commit as on disk come from disk; git shows the rest.
  const differs = new Set(await changedFiles(local.baseDir, at.commit));
  const onDisk = (path: string) =>
    readFile(join(local.baseDir, path), "utf8").catch(() => undefined);
  return {
    ref,
    commit: at.commit,
    root: at.root,
    sources: at.sources,
    source: local.source,
    baseDir: local.baseDir,
    files: await listFilesAtRef(local.baseDir, at.commit),
    fedDir,
    read: (path) =>
      differs.has(path) ? readFileAtRef(local.baseDir, at.commit, path) : onDisk(path),
  };
}

export interface Revision {
  snapshot: Snapshot;
  /** The model as every surface sees it: other repos' models and schema sources included. */
  model: LoadedModel;
  /** What the data entries' schema sources say, errors included. */
  schemas: ImportedSchema[];
}

export interface LoadRevisionOptions extends SnapshotOptions {
  /** Skip reading schema sources. */
  code?: boolean | undefined;
}

/**
 * Builds the model at a ref (or in the working tree) the same way for every
 * surface: the model files, other repos' models pinned in archdoc.lock at that
 * commit, and the fields data entries' schema sources fill in. Comparing two
 * revisions loaded this way shows what the change did, and nothing that only
 * one side happened to read.
 */
export async function loadRevision(
  target: string,
  options: LoadRevisionOptions,
): Promise<Revision | undefined> {
  const snap = await snapshot(target, options);
  if (!snap) return undefined;
  return revisionOf(snap, options);
}

/** Builds a {@link Revision} from a snapshot already read. */
export async function revisionOf(
  snap: Snapshot,
  options: { cwd: string; code?: boolean | undefined },
): Promise<Revision> {
  const built = snap.sources.length
    ? buildModel(snap.sources, { root: snap.root })
    : buildModel([]);
  const model: LoadedModel = { ...built, source: snap.source, baseDir: snap.baseDir };
  // Absolute paths under baseDir, as readFederationInput asks for them.
  const readAbs = (file: string) => {
    const rel = relative(snap.baseDir, file).replace(/\\/g, "/");
    return rel.startsWith("..") ? Promise.resolve(undefined) : snap.read(rel);
  };
  const federation = await readFederationInput(snap.fedDir, options.cwd, readAbs);
  if (
    Object.keys(model.imports).length > 0 ||
    model.landscapeImport ||
    federation.lock ||
    federation.lockError
  ) {
    federate(model, federation);
  }
  const schemas = options.code === false ? [] : await importSchemas(contextOf(snap), model);
  applySchemas(model, schemas);
  return { snapshot: snap, model, schemas };
}

/** An analyzer context that reads a snapshot's files. */
export function contextOf(snap: Snapshot): AnalyzerContext {
  return {
    baseDir: snap.baseDir,
    files: snap.files,
    read: async (path) => {
      const text = await snap.read(path);
      if (text === undefined) throw new Error(`Can't read ${path}.`);
      return text;
    },
  };
}
