import type { SourceLocation } from "../diagnostics.js";
import type { Model } from "../model.js";

/** A part of the model format that works but may change before it's stable (docs/experimental.md). */
export interface ExperimentalUse {
  feature: "imports" | "landscape" | "domains" | "org rules" | "mappings" | "logic" | "decisions";
  /** How many the model has, such as 2 imports or 3 journey steps that decide. */
  count: number;
  /** The first place it's written, when the model knows. */
  location?: SourceLocation | undefined;
}

/**
 * The experimental parts of the format this model uses: imports and the
 * landscape (sharing models across repos), domains and org rules (landscape
 * repos), mappings, logic, and journey steps that decide. Only what this
 * repo's own files write counts, not what other repos' models bring in.
 */
export function experimentalUses(model: Model): ExperimentalUse[] {
  const own = (l: SourceLocation | undefined) => !l || model.files.includes(l.file);
  const first = <T extends { location?: SourceLocation | undefined }>(xs: T[]) =>
    xs.find((x) => x.location)?.location;
  const out: ExperimentalUse[] = [];
  const add = (feature: ExperimentalUse["feature"], count: number, location?: SourceLocation) => {
    if (count) out.push({ feature, count, location });
  };

  const imports = Object.keys(model.imports);
  add("imports", imports.length, imports[0] ? model.importLocations?.get(imports[0]) : undefined);
  add("landscape", model.landscapeImport ? 1 : 0);
  const domains = [...(model.domains?.values() ?? [])].filter((d) => own(d.location));
  add("domains", domains.length, first(domains));
  add("org rules", model.rules.filter((r) => r.scope === "org").length);
  const mappings = [...model.mappings.values()].filter((m) => own(m.location));
  add("mappings", mappings.length, first(mappings));
  const logic = [...model.logic.values()].filter((l) => own(l.location));
  add("logic", logic.length, first(logic));
  const deciding = [...model.journeys.values()]
    .filter((j) => own(j.location))
    .flatMap((j) => j.steps.filter((s) => s.spec.decides || s.spec.branches));
  add("decisions", deciding.length, first(deciding));
  return out;
}

/** "imports (2), logic (1) at model.yaml:40", for a one-line note. */
export function formatExperimentalUses(uses: ExperimentalUse[]): string {
  return uses
    .map(
      (u) =>
        `${u.feature} (${u.count})${u.location ? ` at ${u.location.file}:${u.location.line}` : ""}`,
    )
    .join(", ");
}
