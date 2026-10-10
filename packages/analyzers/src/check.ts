import { isAbsolute, relative, resolve } from "node:path";
import {
  type CheckResult,
  changedFiles,
  check as checkModel,
  type LoadedModel,
  listRepoFiles,
  loadModel,
  type MarkedFinding,
  resolveGitRef,
} from "@archdoc/core";
import { contextFor } from "./api.js";
import { analyze } from "./run.js";

export interface CheckRepositoryOptions {
  /** Repository, .archdoc directory, or model file. Defaults to ".". */
  model?: string;
  /** Directory relative paths are resolved from. */
  cwd: string;
  /** Mark the findings that the change since this ref introduced. */
  base?: string;
  /** Skip code analysis and check only the model. */
  code?: boolean;
}

export interface CheckRepositoryResult {
  model: LoadedModel;
  result: CheckResult;
  findings: MarkedFinding[];
}

/**
 * Checks a repository on disk: loads the model, runs the analyzers over the
 * repository's files, and compares them. With `base`, marks the findings the
 * change since that ref introduced. Shared by the CLI and the MCP server.
 */
export async function checkRepository(
  options: CheckRepositoryOptions,
): Promise<CheckRepositoryResult> {
  const { cwd } = options;
  const model = await loadModel(options.model ?? ".", { cwd });
  if (model.diagnostics.some((d) => d.code === "model/not-found")) {
    throw new Error(model.diagnostics[0]?.message ?? "No model found.");
  }
  const files = await listRepoFiles(model.baseDir);
  const observed = options.code === false ? [] : await analyze(contextFor(model.baseDir, files));
  const result = checkModel(model, { observed, files });

  let findings: MarkedFinding[] = result.findings;
  if (options.base) {
    if (!(await resolveGitRef(model.baseDir, options.base))) {
      throw new Error(`${options.base} is not a commit, branch, or tag.`);
    }
    const changed = new Set(await changedFiles(model.baseDir, options.base));
    // Diagnostic paths are relative to cwd; git paths are relative to the repository root.
    const repoPath = (p: string) =>
      relative(model.baseDir, isAbsolute(p) ? p : resolve(cwd, p)).replace(/\\/g, "/");
    // The model's own files, archdoc.lock, and the vendored bundles of other repos' models.
    const modelDir = repoPath(model.source);
    const inModel = (file: string) =>
      file === modelDir ||
      file.startsWith(`${modelDir}/`) ||
      model.files.some((f) => repoPath(f) === file);
    const modelChanged = [...changed].some(inModel);
    findings = findings.map((f) => ({
      ...f,
      introduced:
        f.files.some((file) => changed.has(repoPath(file))) ||
        // Rule, model, and cross-repo findings come from the model and what it imports.
        (modelChanged && /^(rule|model|journey|ref|import)\//.test(f.code)),
    }));
  }
  return { model, result, findings };
}
