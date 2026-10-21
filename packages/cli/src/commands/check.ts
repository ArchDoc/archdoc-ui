import { checkAnswer, checkRepository } from "@archdoc/analyzers";
import { formatAnnotations, formatFindings, type MarkedFinding } from "@archdoc/core";
import type { Io } from "../io.js";
import { verify } from "./seal.js";

export interface CheckOptions {
  model?: string;
  /** Mark findings that the change since this ref introduced, and fail only on those. */
  base?: string;
  format?: string;
  failOn?: string;
  /** Skip code analysis and check only the model. */
  code?: boolean;
  /** List every finding, not only the change's (or the first few). */
  all?: boolean;
  /** Only the facts whose sealed code changed: exits 1 while there are any. */
  seals?: boolean;
}

/** Runs analyzers and checks the model against the code and its rules. */
export function runCheck(options: CheckOptions, cwd: string) {
  return checkRepository({ model: options.model, cwd, base: options.base, code: options.code });
}

/**
 * `archdoc check`: everything wrong or stale (the model's own problems,
 * drift from the code, rules, sealed facts whose code changed, traces), and
 * with --base, what the change does. The text is what archdoc_check answers.
 */
export async function check(options: CheckOptions, io: Io): Promise<number> {
  if (options.seals) {
    return verify(
      { model: options.model, format: options.format === "json" ? "json" : "text" },
      io,
    );
  }
  const format = options.format ?? "text";
  if (!["text", "markdown", "json", "github"].includes(format)) {
    io.err("--format must be text, markdown, json, or github.");
    return 2;
  }
  const failOn = options.failOn ?? "error";
  if (!["error", "warning", "never"].includes(failOn)) {
    io.err("--fail-on must be error, warning, or never.");
    return 2;
  }
  let findings: MarkedFinding[];
  try {
    if (format === "text") {
      const answer = await checkAnswer(
        { model: options.model, cwd: io.cwd },
        { base: options.base, all: options.all, code: options.code },
      );
      findings = answer.findings;
      io.out(answer.text);
    } else {
      findings = (await runCheck(options, io.cwd)).findings;
      if (format === "github") {
        // Workflow commands put the findings on the diff; the text keeps the log readable.
        const annotations = formatAnnotations(findings);
        if (annotations) io.out(annotations);
        io.out(formatFindings(findings, "text"));
      } else {
        io.out(
          format === "json"
            ? JSON.stringify(findings, null, 2)
            : formatFindings(findings, format as "markdown"),
        );
      }
    }
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const counted = options.base ? findings.filter((f) => f.introduced) : findings;
  const failing = counted.filter(
    (f) => f.severity === "error" || (failOn === "warning" && f.severity === "warning"),
  );
  return failOn !== "never" && failing.length > 0 ? 1 : 0;
}
