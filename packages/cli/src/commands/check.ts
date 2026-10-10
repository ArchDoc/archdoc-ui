import { analyze, contextFor } from "@archdoc/analyzers";
import {
  changedFiles,
  check as checkModel,
  formatFindings,
  listRepoFiles,
  loadModel,
  type MarkedFinding,
  resolveGitRef,
} from "@archdoc/core";
import type { Io } from "../io.js";

export interface CheckOptions {
  model?: string;
  /** Mark findings that the change since this ref introduced, and fail only on those. */
  base?: string;
  format?: string;
  failOn?: string;
  /** Skip code analysis and check only the model. */
  code?: boolean;
}

/** Runs analyzers and checks the model against the code and its rules. */
export async function runCheck(options: CheckOptions, cwd: string) {
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
      throw new Error(`--base ${options.base} is not a commit, branch, or tag.`);
    }
    const changed = new Set(await changedFiles(model.baseDir, options.base));
    const modelChanged = model.files.some((f) =>
      changed.has(relativeToRepo(f, cwd, model.baseDir)),
    );
    findings = findings.map((f) => ({
      ...f,
      introduced:
        f.files.some((file) => changed.has(relativeToRepo(file, cwd, model.baseDir))) ||
        // Rule and model findings come from the model itself.
        (modelChanged &&
          (f.code.startsWith("rule/") ||
            f.code.startsWith("model/") ||
            f.code.startsWith("journey/"))),
    }));
  }
  return { model, result, findings };
}

export async function check(options: CheckOptions, io: Io): Promise<number> {
  const format = options.format ?? "text";
  if (!["text", "markdown", "json"].includes(format)) {
    io.err("--format must be text, markdown, or json.");
    return 2;
  }
  const failOn = options.failOn ?? "error";
  if (!["error", "warning", "never"].includes(failOn)) {
    io.err("--fail-on must be error, warning, or never.");
    return 2;
  }
  let findings: MarkedFinding[];
  try {
    findings = (await runCheck(options, io.cwd)).findings;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }

  io.out(
    format === "json"
      ? JSON.stringify(findings, null, 2)
      : formatFindings(findings, format as "text" | "markdown"),
  );
  const counted = options.base ? findings.filter((f) => f.introduced) : findings;
  const failing = counted.filter(
    (f) => f.severity === "error" || (failOn === "warning" && f.severity === "warning"),
  );
  return failOn !== "never" && failing.length > 0 ? 1 : 0;
}

/** Diagnostic paths are relative to where the command ran; git paths to the repository root. */
function relativeToRepo(path: string, cwd: string, baseDir: string): string {
  const abs = path.startsWith("/") ? path : `${cwd}/${path}`;
  const norm = abs.split("/").reduce<string[]>((acc, part) => {
    if (part === "..") acc.pop();
    else if (part && part !== ".") acc.push(part);
    return acc;
  }, []);
  const base = baseDir.split("/").filter(Boolean);
  return norm.slice(base.length).join("/");
}
