import { checkRepository } from "@archdoc/analyzers";
import { formatFindings, type MarkedFinding } from "@archdoc/core";
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
export function runCheck(options: CheckOptions, cwd: string) {
  return checkRepository({ model: options.model, cwd, base: options.base, code: options.code });
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
