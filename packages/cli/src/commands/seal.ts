import { sealAnswer, sealReport } from "@archdoc/analyzers";
import { formatSealStatus } from "@archdoc/core";
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
      io.err(`No ArchDoc model at ${options.model ?? "."}. Expected .archdoc/archdoc.yaml. Run archdoc init to start one.`);
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
 * or until --all. Says what's still to check.
 */
export async function seal(facts: string[], options: SealCommandOptions, io: Io): Promise<number> {
  try {
    const r = await sealAnswer({ model: options.model, cwd: io.cwd }, { ...options, facts });
    if (!r.ok) {
      io.err(r.text);
      return r.text.startsWith("No ArchDoc model") ? 2 : 1;
    }
    io.out(r.text);
    return 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
