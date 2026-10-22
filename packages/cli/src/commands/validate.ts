import {
  experimentalUses,
  formatDiagnostic,
  formatExperimentalUses,
  hasErrors,
  loadModel,
} from "@archdoc/core";
import type { Io } from "../io.js";

export interface ValidateOptions {
  json?: boolean;
  /** Treat warnings as failures. */
  strict?: boolean;
}

export async function validate(target: string, options: ValidateOptions, io: Io): Promise<number> {
  const model = await loadModel(target, { cwd: io.cwd });
  // Experimental parts of the format are a note, not a warning: using one on purpose isn't a problem.
  const experimental = experimentalUses(model);
  const failed =
    hasErrors(model.diagnostics) ||
    (options.strict === true && model.diagnostics.some((d) => d.severity === "warning"));

  if (options.json) {
    io.out(
      JSON.stringify(
        {
          ok: !failed,
          namespace: model.namespace,
          files: model.files,
          counts: {
            actors: model.actors.size,
            elements: model.elements.size,
            relationships: model.relationships.length,
            journeys: model.journeys.size,
          },
          diagnostics: model.diagnostics,
          experimental,
        },
        null,
        2,
      ),
    );
    return failed ? 1 : 0;
  }

  for (const d of model.diagnostics) io.err(formatDiagnostic(d));
  const count = (s: string) => model.diagnostics.filter((d) => d.severity === s).length;
  const errors = count("error");
  const warnings = count("warning");
  const problems = [
    errors ? `${errors} error${errors === 1 ? "" : "s"}` : "",
    warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  if (failed) {
    io.err(`\n✗ ${problems || "failed"}`);
  } else {
    const summary = [
      plural(model.actors.size, "actor"),
      plural(model.elements.size, "element"),
      plural(model.relationships.length, "relationship"),
      plural(model.journeys.size, "journey"),
    ].join(", ");
    io.out(
      `${model.diagnostics.length ? "\n" : ""}✓ ${model.namespace}: ${summary} in ${plural(model.files.length, "file")}${problems ? ` (${problems})` : ""}`,
    );
  }
  if (experimental.length) {
    io.err(
      `note: uses experimental parts of the format, which may change before they're stable: ${formatExperimentalUses(experimental)}. See https://github.com/ArchDoc/archdoc/blob/main/docs/experimental.md`,
    );
  }
  return failed ? 1 : 0;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
