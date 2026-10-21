import { writeFile } from "node:fs/promises";
import { sealReport } from "@archdoc/analyzers";
import { formatSealStatus, formatSum, sealSum } from "@archdoc/core";
import type { Io } from "../io.js";

export interface VerifyOptions {
  model?: string;
  format?: string;
}

/**
 * `archdoc verify`: the model facts whose code changed since they were sealed
 * (and what changed), and the facts no one has sealed. Exits 1 when there are
 * any, so an agent or CI knows the model needs a look.
 */
export async function verify(options: VerifyOptions, io: Io): Promise<number> {
  try {
    const r = await sealReport(options.model ?? ".", io.cwd);
    if (!r) {
      io.err(`No ArchDoc model at ${options.model ?? "."}. Expected .archdoc/archdoc.yaml.`);
      return 2;
    }
    if (options.format === "json") {
      io.out(
        JSON.stringify(
          {
            file: r.file,
            sealed: r.recorded !== undefined,
            error: r.error,
            facts: r.statuses.map((s) => ({
              key: s.fact.key,
              label: s.fact.label,
              state: s.state,
              refs: s.fact.refs,
              location: s.fact.location,
              changes: s.changes,
              problems: s.problems,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      io.out(formatSealStatus(r.statuses, { file: r.file, hasSum: !!r.recorded, error: r.error }));
    }
    if (r.error) return 2;
    return r.recorded && r.statuses.some((s) => s.state !== "sealed") ? 1 : 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

export interface SealCommandOptions {
  model?: string;
  all?: boolean;
  by?: string;
  dryRun?: boolean;
}

/**
 * `archdoc seal [facts…]`: records that the model still describes the code
 * these facts point at. Without facts, seals the ones no one has sealed and
 * drops the ones that left the model; changed facts stay flagged until named,
 * or until --all.
 */
export async function seal(facts: string[], options: SealCommandOptions, io: Io): Promise<number> {
  try {
    const r = await sealReport(options.model ?? ".", io.cwd);
    if (!r) {
      io.err(`No ArchDoc model at ${options.model ?? "."}. Expected .archdoc/archdoc.yaml.`);
      return 2;
    }
    const { sum, sealed, unknown } = sealSum(r.statuses, {
      keys: facts,
      all: options.all || !!r.error,
      by: options.by,
    });
    if (unknown.length) {
      io.err(
        `Not a fact that points at code: ${unknown.join(", ")}. archdoc verify lists them, such as element:<id>, step:<journey>#<n>, logic:<id>, mapping:<id>, data:<id>.`,
      );
      return 1;
    }
    const still = r.statuses.filter(
      (s) => s.state === "changed" && !sealed.includes(s.fact.key),
    ).length;
    if (!options.dryRun) await writeFile(r.path, formatSum(sum));
    io.out(
      `${options.dryRun ? "Would seal" : "✓ Sealed"} ${sealed.length} fact${sealed.length === 1 ? "" : "s"} in ${r.file}${sealed.length && sealed.length <= 8 ? `: ${sealed.join(", ")}` : ""}.`,
    );
    for (const s of r.statuses.filter((x) => x.problems.length && sealed.includes(x.fact.key))) {
      io.out(`  ! ${s.fact.label}: ${s.problems.join("; ")}`);
    }
    if (still) {
      io.out(
        `  ${still} changed fact${still === 1 ? " is" : "s are"} still flagged. Check ${still === 1 ? "it" : "them"} with archdoc verify, then seal ${still === 1 ? "it" : "them"} by name.`,
      );
    }
    return 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
