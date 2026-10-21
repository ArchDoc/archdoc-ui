import { join, relative } from "node:path";
import {
  fingerprints,
  parseSum,
  type SealStatus,
  SUM_FILE,
  type SumFile,
  sealedPaths,
  sealStatuses,
} from "@archdoc/core";
import { contextOf, loadRevision, type Snapshot, snapshot } from "./revision.js";
import { indexCode } from "./symbols.js";

/** A snapshot's archdoc.sum: where it is (relative to the repository) and its text, if there is one. */
export async function readSumFile(snap: Snapshot): Promise<{ file: string; text?: string }> {
  const file = relative(snap.baseDir, join(snap.fedDir, SUM_FILE)).replace(/\\/g, "/");
  const text = await snap.read(file);
  return text === undefined ? { file } : { file, text };
}

/** The files content seals read, read ahead, since fingerprints read synchronously. */
export async function readSealedFiles(
  snap: Snapshot,
  paths: readonly string[],
): Promise<Map<string, string | undefined>> {
  const inRepo = new Set(snap.files);
  const out = new Map<string, string | undefined>();
  for (const p of paths) if (inRepo.has(p)) out.set(p, await snap.read(p));
  return out;
}

export interface SealReport {
  /** The seal file, absolute, for writing. */
  path: string;
  /** Relative to the repository. */
  file: string;
  recorded?: SumFile | undefined;
  /** Why archdoc.sum couldn't be read, when it's there but invalid. */
  error?: string | undefined;
  statuses: SealStatus[];
}

/**
 * Every fact that points at code in the working tree, and how its code
 * compares with its seal in archdoc.sum. For `archdoc verify`, `archdoc seal`,
 * and their MCP tools.
 */
export async function sealReport(target: string, cwd: string): Promise<SealReport | undefined> {
  const rev = await loadRevision(target, { cwd });
  if (!rev) return undefined;
  const snap = rev.snapshot;
  const { file, text } = await readSumFile(snap);
  const parsed = text === undefined ? {} : parseSum(text);
  const texts = await readSealedFiles(snap, sealedPaths(rev.model));
  const current = fingerprints(rev.model, {
    files: snap.files,
    read: (p) => texts.get(p),
    index: await indexCode(contextOf(snap)),
    schemas: rev.schemas,
  });
  return {
    path: join(snap.baseDir, file),
    file,
    recorded: parsed.sum,
    error: parsed.error,
    statuses: sealStatuses(current, parsed.sum),
  };
}

/**
 * Facts a change sealed again after their code changed: in archdoc.sum at the
 * base and now, with a different fingerprint. The PR comment lists them, so a
 * reviewer sees what someone says they checked.
 */
export async function resealedSince(
  target: string,
  cwd: string,
  base: string,
): Promise<{ key: string; by?: string | undefined }[]> {
  const [now, before] = await Promise.all([
    snapshot(target, { cwd }),
    snapshot(target, { cwd, ref: base }),
  ]);
  if (!now || !before) return [];
  const [a, b] = await Promise.all([readSumFile(before), readSumFile(now)]);
  const was = a.text === undefined ? undefined : parseSum(a.text).sum;
  const is = b.text === undefined ? undefined : parseSum(b.text).sum;
  if (!was || !is) return [];
  return Object.entries(is.seals)
    .filter(([key, seal]) => was.seals[key] && was.seals[key]?.hash !== seal.hash)
    .map(([key, seal]) => ({ key, ...(seal.by ? { by: seal.by } : {}) }));
}
