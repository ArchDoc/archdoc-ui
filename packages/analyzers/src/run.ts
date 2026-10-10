import type { Analyzer, AnalyzerContext, ObservedDependency } from "./api.js";
import { manifests } from "./manifests.js";
import { tsImports } from "./ts-imports.js";

export const builtinAnalyzers: Analyzer[] = [manifests, tsImports];

/** Runs analyzers and returns everything they observed, sorted for stable output. */
export async function analyze(
  ctx: AnalyzerContext,
  analyzers: Analyzer[] = builtinAnalyzers,
): Promise<ObservedDependency[]> {
  const results = await Promise.all(analyzers.map((a) => a.analyze(ctx)));
  return results
    .flat()
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from) || (a.line ?? 0) - (b.line ?? 0) || a.to.localeCompare(b.to),
    );
}
