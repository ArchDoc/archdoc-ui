// Everything in @archdoc/core that runs without Node: no filesystem, no network.
// The explorer imports this entry point so it builds and queries the model
// with the same engine as the CLI.
export { validateJourneys } from "./check/journeys.js";
export {
  type CodeMap,
  type CodeMatch,
  filesUnder,
  type Located,
  locate,
  resolveCodeMap,
} from "./codemap/codemap.js";
export { compileGlob, literalPrefix, normalizePath } from "./codemap/glob.js";
export * from "./diagnostics.js";
export {
  type Change,
  type ChangeKind,
  countChanges,
  diffModels,
  isEmptyDiff,
  type ModelDiff,
  type RelationshipView,
  type StepChange,
} from "./diff/diff.js";
export { type BuildOptions, buildModel, type ModelSource, normalizeCode } from "./load/build.js";
export { type Resolution, Resolver } from "./load/resolve.js";
export * from "./model.js";
export {
  type AffectedJourney,
  type Impact,
  type ImpactConsumer,
  type ImpactResult,
  impact,
} from "./query/impact.js";
export * from "./query/index.js";
export { type SearchHit, search } from "./query/search.js";
export { type DiffFormat, formatDiff, summary as diffSummary } from "./report/diff-report.js";
export * from "./report/report.js";
