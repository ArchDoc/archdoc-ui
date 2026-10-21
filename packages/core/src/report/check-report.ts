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
      for (const d of f.details ?? []) out.push(md ? `  - ${d}` : `    ${d}`);
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

/**
 * GitHub Actions workflow commands that put findings on the diff, at the line
 * they're about: the code line for a dependency the model doesn't declare,
 * the model line for the rest. With `introducedOnly`, only what the change
 * introduced.
 */
export function formatAnnotations(findings: MarkedFinding[], introducedOnly = true): string {
  const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = (s: string) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const lines: string[] = [];
  for (const f of findings) {
    if (introducedOnly && f.introduced === false) continue;
    if (f.severity === "info") continue;
    // Evidence reads like packages/web/src/x.ts:12 (@archdoc/cli).
    const evidence = f.evidence[0]?.match(/^([^\s:]+):(\d+)/);
    const [file, line] =
      f.code === "drift/undeclared-dependency" && evidence
        ? [evidence[1], Number(evidence[2])]
        : f.location
          ? [f.location.file, f.location.line]
          : evidence
            ? [evidence[1], Number(evidence[2])]
            : [f.files[0], undefined];
    const props = [
      file ? `file=${prop(file)}` : "",
      line ? `line=${line}` : "",
      `title=${prop(`ArchDoc ${f.rule ? `rule ${f.rule}` : f.code}`)}`,
    ].filter(Boolean);
    lines.push(`::${f.severity} ${props.join(",")}::${esc(f.message)}`);
  }
  return lines.join("\n");
}
