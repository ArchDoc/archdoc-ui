import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CheckResult,
  changedFiles,
  check as checkModel,
  type Finding,
  isSnippet,
  type LoadedModel,
  type MarkedFinding,
  mergeBase,
  resolveGitRef,
} from "@archdoc/core";
import { contextOf, loadRevision, type Revision } from "./revision.js";
import { analyze } from "./run.js";

export interface CheckRepositoryOptions {
  /** Repository, .archdoc directory, or model file. Defaults to ".". */
  model?: string;
  /** Directory relative paths are resolved from. */
  cwd: string;
  /** Mark the findings that the change since this ref introduced. */
  base?: string;
  /** Check this branch or commit instead of the working tree. */
  head?: string;
  /** Skip code analysis and check only the model. */
  code?: boolean;
}

export interface CheckRepositoryResult {
  model: LoadedModel;
  result: CheckResult;
  findings: MarkedFinding[];
  /** With `base`: the model at the merge base, loaded the same way, and the files changed since. */
  base?: { model: LoadedModel; ref: string; commit: string; changedFiles: string[] } | undefined;
}

/**
 * Checks a repository on disk: loads the model, runs the analyzers over the
 * repository's files, and compares them. With `base`, also checks the
 * repository as it was at the merge base with that ref, and marks a finding
 * introduced only when the base didn't have it. Shared by the CLI and the MCP
 * server.
 */
export async function checkRepository(
  options: CheckRepositoryOptions,
): Promise<CheckRepositoryResult> {
  const { cwd } = options;
  const target = options.model ?? ".";
  const head = await loadRevision(target, { cwd, ref: options.head, code: options.code });
  if (!head) {
    throw new Error(`No ArchDoc model at ${target}. Expected .archdoc/archdoc.yaml.`);
  }
  const { model } = head;
  const headObserved = options.code === false ? [] : await analyze(contextOf(head.snapshot));
  const result = await checkRevision(head, headObserved, options.code);

  if (!options.base) return { model, result, findings: result.findings };

  if (!(await resolveGitRef(model.baseDir, options.base))) {
    throw new Error(`${options.base} is not a commit, branch, or tag.`);
  }
  // What a pull request shows: the change since the merge base, not since the tip of base.
  const at = (await mergeBase(model.baseDir, options.base, options.head ?? "HEAD")) ?? options.base;
  const changed = await changedFiles(model.baseDir, at, head.snapshot.commit);
  const before = await loadRevision(target, { cwd, ref: at, code: options.code });
  if (!before) throw new Error(`No ArchDoc model at ${target}.`);
  const baseObserved = options.code === false ? [] : await analyze(contextOf(before.snapshot));
  const baseResult = await checkRevision(before, baseObserved, options.code);
  // The base's model files are named like <commit>:.archdoc/archdoc.yaml; compare without that.
  const already = new Set(baseResult.findings.map((f) => findingKey(f).replaceAll(`${at}:`, "")));
  const findings = result.findings.map((f) => ({ ...f, introduced: !already.has(findingKey(f)) }));
  return {
    model,
    result,
    findings,
    base: {
      model: before.model,
      ref: options.base,
      commit: before.snapshot.commit ?? at,
      changedFiles: changed,
    },
  };
}

/** What makes two findings the same finding, wherever the model file put it. */
function findingKey(f: Finding): string {
  return `${f.code}\u0000${f.element ?? ""}\u0000${f.rule ?? ""}\u0000${f.message}`;
}

async function checkRevision(
  rev: Revision,
  observed: Awaited<ReturnType<typeof analyze>>,
  code: boolean | undefined,
): Promise<CheckResult> {
  const snap = rev.snapshot;
  // Snippets are matched synchronously, so read the files they point at first.
  const texts = new Map<string, string | undefined>();
  const inRepo = new Set(snap.files);
  for (const e of rev.model.elements.values()) {
    for (const ref of e.code) {
      if (isSnippet(ref) && inRepo.has(ref.path) && !texts.has(ref.path)) {
        texts.set(
          ref.path,
          snap.ref === undefined
            ? readWorkingFile(snap.baseDir, ref.path)
            : await snap.read(ref.path),
        );
      }
    }
  }
  return checkModel(rev.model, {
    observed,
    files: snap.files,
    schemas: code === false ? [] : rev.schemas,
    read: (path) => (inRepo.has(path) ? texts.get(path) : undefined),
  });
}

function readWorkingFile(baseDir: string, path: string): string | undefined {
  try {
    return readFileSync(resolve(baseDir, path), "utf8");
  } catch {
    return undefined;
  }
}
