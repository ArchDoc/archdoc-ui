import type { SealStatus } from "../seal/seal.js";

/**
 * What `archdoc check --seals` prints: the facts whose code changed since they were
 * sealed, with what changed and where each fact is in the model, then the
 * facts no one has sealed, then how many still hold.
 */
export function formatSealStatus(
  statuses: SealStatus[],
  options: { file: string; hasSum: boolean; error?: string | undefined },
): string {
  if (options.error) {
    return `✗ ${options.file} isn't a valid seal file (${options.error}). Run archdoc seal --all to write it again.`;
  }
  if (!options.hasSum) {
    return [
      `This repository has no ${options.file} yet, so nothing is sealed.`,
      `Once the model describes the code, run archdoc seal --all to seal ${statuses.length} fact${statuses.length === 1 ? "" : "s"}. From then on, archdoc check says when the code under one of them changes.`,
    ].join("\n");
  }
  const changed = statuses.filter((s) => s.state === "changed");
  const unsealed = statuses.filter((s) => s.state === "unsealed");
  const sealed = statuses.filter((s) => s.state === "sealed");
  const out: string[] = [];
  const where = (s: SealStatus) =>
    s.fact.location ? ` (${s.fact.location.file}:${s.fact.location.line})` : "";
  if (changed.length) {
    out.push(
      `${changed.length} fact${changed.length === 1 ? "" : "s"} to check: the code changed since ${changed.length === 1 ? "it was" : "they were"} sealed.`,
      "",
    );
    for (const s of changed) {
      out.push(`${s.fact.label}${where(s)}`);
      out.push(`  points at ${s.fact.refs.join(", ")}`);
      for (const c of s.changes.slice(0, 12)) out.push(`  ${c}`);
      if (s.changes.length > 12) out.push(`  … and ${s.changes.length - 12} more`);
      for (const p of s.problems) out.push(`  ! ${p}`);
      out.push(`  → archdoc seal ${s.fact.key}`, "");
    }
  }
  if (unsealed.length) {
    out.push(
      `${unsealed.length} fact${unsealed.length === 1 ? "" : "s"} no one has sealed:`,
      "",
      ...unsealed.map((s) => `${s.fact.label}${where(s)} · ${s.fact.refs.join(", ")}`),
      "",
      `Check that the model describes ${unsealed.length === 1 ? "its code" : "their code"}, then run archdoc seal (it seals new facts and leaves changed ones flagged).`,
      "",
    );
  }
  if (changed.length) {
    out.push(
      "For each fact: read what changed, update the model if it no longer describes the code, then seal it. Sealing says you checked; it doesn't change the model.",
    );
  }
  out.push(
    `${changed.length || unsealed.length ? "" : "✓ "}${sealed.length} of ${statuses.length} fact${statuses.length === 1 ? "" : "s"} still match${sealed.length === 1 ? "es" : ""} ${sealed.length === 1 ? "its" : "their"} seal.`,
  );
  return out.join("\n");
}
