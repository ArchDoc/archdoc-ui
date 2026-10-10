import type { Finding } from "../check/check.js";

export interface MarkedFinding extends Finding {
  /** True when the change being checked touched a file behind the finding. */
  introduced?: boolean | undefined;
}

const ICON = { error: "✗", warning: "!", info: "i" } as const;

/** Text or markdown for check findings, with introduced findings first when known. */
export function formatFindings(
  findings: MarkedFinding[],
  format: "text" | "markdown",
  maxEvidence = 3,
): string {
  const md = format === "markdown";
  if (findings.length === 0)
    return md ? "No drift or rule problems found." : "✓ No drift or rule problems found.";

  const groups: [string, MarkedFinding[]][] = findings.some((f) => f.introduced !== undefined)
    ? [
        ["Introduced by this change", findings.filter((f) => f.introduced)],
        ["Already there", findings.filter((f) => !f.introduced)],
      ]
    : [["", findings]];

  const out: string[] = [];
  for (const [title, list] of groups) {
    if (list.length === 0) continue;
    if (title) out.push(md ? `**${title}** (${list.length})` : `${title} (${list.length})`, "");
    for (const f of list) {
      const head = `${f.severity} ${f.code}: ${f.message}`;
      out.push(
        md
          ? `- ${f.severity === "error" ? "⛔" : f.severity === "warning" ? "⚠️" : "ℹ️"} \`${f.code}\` ${f.message}`
          : `${ICON[f.severity]} ${head}`,
      );
      const shown = f.evidence.slice(0, maxEvidence);
      for (const e of shown) out.push(md ? `  - \`${e}\`` : `    ${e}`);
      if (f.evidence.length > shown.length) {
        out.push(
          md
            ? `  - and ${f.evidence.length - shown.length} more`
            : `    … and ${f.evidence.length - shown.length} more`,
        );
      }
    }
    out.push("");
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  out.push(
    `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`,
  );
  return out.join("\n");
}
