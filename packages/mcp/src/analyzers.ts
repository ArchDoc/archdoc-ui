import { builtinAnalyzers } from "@archdoc/analyzers";

/** Names of the analyzers an archdoc_check tool would run. */
export const analyzerNames = builtinAnalyzers.map((a) => a.name);
