// Everything in @archdoc/core that runs without Node: no filesystem, no network.
// The explorer imports this entry point so it builds and queries the model
// with the same engine as the CLI.

export {
  type CheckOptions,
  type CheckResult,
  check,
  type Finding,
  type ObservedEdge,
  observedEdges,
} from "./check/check.js";
export { validateJourneys } from "./check/journeys.js";
export { evidenceOf, type ObservedDependency } from "./check/observed.js";
export {
  evaluateRules,
  type RuleEdge,
  type RuleViolation,
  selectorMatcher,
} from "./check/rules.js";
export {
  type CodeMap,
  type CodeMatch,
  filesUnder,
  type Located,
  locate,
  resolveCodeMap,
} from "./codemap/codemap.js";
export { compileGlob, literalPrefix, normalizePath } from "./codemap/glob.js";
export {
  compile as compileCel,
  evaluate as evaluateCel,
  type FieldRef,
  SIMULATED_NOW,
} from "./data/cel.js";
export {
  type NewSensitiveFlow,
  type NewSensitiveStore,
  sensitiveDataChanges,
} from "./data/changes.js";
export { checkData } from "./data/check.js";
export { type DataFlow, type DataStore, dataFlows, dataStores } from "./data/flows.js";
export {
  type FieldId,
  type Lineage,
  type LineageEdge,
  lineage,
  lineageEdges,
} from "./data/lineage.js";
export { checkLogic, outcomesOf } from "./data/logic.js";
export {
  checkReferences,
  type FieldReference,
  fieldReferences,
  referenceFromSchema,
  resolveReference,
} from "./data/references.js";
export { DataRegistry, type Owned, type StoredIn } from "./data/registry.js";
export {
  classifiedFields,
  type DataResolution,
  type Lifecycle,
  parseChange,
  parseStates,
  qualifyData,
  resolveData,
  splitField,
} from "./data/resolve.js";
export { type DataRuleViolation, evaluateDataRules } from "./data/rules.js";
export {
  applySchemas,
  type ImportedField,
  type ImportedSchema,
  normalizeType,
  parseSourceRef,
  schemaDrift,
} from "./data/schemas.js";
export {
  type DataRecord,
  type RecordEvent,
  type SimulatedDecision,
  type SimulatedStep,
  type Simulation,
  simulate,
} from "./data/simulate.js";
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
export {
  type BundleMeta,
  createBundle,
  modelFromBundle,
  parseBundle,
  serializeBundle,
} from "./federation/bundle.js";
export {
  consumersElsewhere,
  type Elsewhere,
  otherModels,
  type RemoteConsumer,
  type RemoteJourney,
} from "./federation/consumers.js";
export {
  type FederationInput,
  federate,
  lookupImported,
  type VendoredBundle,
} from "./federation/federate.js";
export {
  type ComposedLandscape,
  composeLandscape,
  type LandscapeDomain,
  type LandscapeRepo,
} from "./federation/landscape.js";
export {
  type BuildOptions,
  buildModel,
  contractName,
  LANDSCAPE,
  type ModelSource,
  normalizeCode,
} from "./load/build.js";
export { type Resolution, Resolver } from "./load/resolve.js";
export * from "./model.js";
export { insertIntoMap } from "./propose/insert.js";
export { type ProposalEdit, type ProposalPlan, planProposal } from "./propose/propose.js";
export {
  type AffectedJourney,
  type Impact,
  type ImpactConsumer,
  type ImpactResult,
  impact,
} from "./query/impact.js";
export * from "./query/index.js";
export { type SearchHit, search } from "./query/search.js";
export { formatFindings, type MarkedFinding } from "./report/check-report.js";
export { type DiffFormat, formatDiff, summary as diffSummary } from "./report/diff-report.js";
export {
  CHANGE_LEGEND,
  type ChangeDiagramInput,
  changeDiagram,
  type JourneyDiagramInput,
  journeyDiagram,
} from "./report/mermaid.js";
export { type PrReport, type PrReportInput, prReport, REPORT_MARKER } from "./report/pr-report.js";
export * from "./report/report.js";
