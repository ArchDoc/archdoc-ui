import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  formatLineage,
  formatSimulation,
  hasErrors,
  type LoadedModel,
  lineage,
  loadModel,
  simulate,
} from "@archdoc/core";
import { parse } from "yaml";
import type { Io } from "../io.js";

export interface DataOptions {
  model?: string;
  json?: boolean;
}

async function load(options: DataOptions, io: Io): Promise<LoadedModel | undefined> {
  const model = await loadModel(options.model ?? ".", { cwd: io.cwd });
  if (model.diagnostics.some((d) => d.code === "model/not-found")) {
    io.err(model.diagnostics[0]?.message ?? "No model found.");
    return undefined;
  }
  if (hasErrors(model.diagnostics)) {
    io.err('warning: the model has errors, so answers may be incomplete. Run "archdoc validate".');
  }
  return model;
}

/** `archdoc lineage <entry.field>`: where a field's value comes from and goes, across repos. */
export async function lineageCommand(field: string, options: DataOptions, io: Io): Promise<number> {
  const model = await load(options, io);
  if (!model) return 1;
  const l = lineage(model, field);
  if (!l) {
    io.err(
      `No data entry for "${field}". Name a field as Entry.field, such as Refund.amount_cents or payments.Refund.amount_cents.`,
    );
    return 1;
  }
  io.out(
    options.json
      ? JSON.stringify(
          {
            ...l,
            stored: Object.fromEntries(l.stored),
            classifications: Object.fromEntries(l.classifications),
          },
          null,
          2,
        )
      : formatLineage(l),
  );
  return 0;
}

/** `archdoc simulate <journey> --sample <file>`: the path a sample takes, and the records it writes. */
export async function simulateCommand(
  journey: string,
  options: DataOptions & { sample?: string },
  io: Io,
): Promise<number> {
  const model = await load(options, io);
  if (!model) return 1;
  let sample: Record<string, unknown> = {};
  if (options.sample) {
    try {
      const parsed = parse(await readFile(resolve(io.cwd, options.sample), "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(
          "it should map data entries to records, such as { RefundRequest: { amount_cents: 400 } }",
        );
      }
      sample = parsed as Record<string, unknown>;
    } catch (err) {
      io.err(
        `Couldn't read ${options.sample}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 2;
    }
  }
  const result = simulate(model, journey, sample);
  if (!result) {
    io.err(
      `No journey "${journey}". List them with "archdoc search <words>" or "archdoc show <journey>".`,
    );
    return 1;
  }
  io.out(options.json ? JSON.stringify(result, null, 2) : formatSimulation(result));
  // Problems (a missing input, an expression that failed) fail the run, so CI can use it.
  return result.steps.some((s) => s.problems.length) ? 1 : 0;
}
