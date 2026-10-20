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
  findSnippet,
  formatCode,
  isSnippet,
  resolveSnippets,
  type Snippet,
  type SnippetPlace,
  snippetKey,
  snippetLabel,
} from "./codemap/snippet.js";
export { type BranchOutcome, type JourneyItem, journeyBranches } from "./data/branches.js";
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
export {
  type DataFlow,
  type DataStore,
  dataFlows,
  dataStores,
  type StepMessage,
  type StepStore,
  type Subscription,
  stepMessage,
  stepStores,
  subscriptionOf,
} from "./data/flows.js";
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
  bundleSchemas,
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
  type CodeIndex,
  fileStem,
  filesNamed,
  type IndexedImport,
  type IndexedSource,
  type IndexedSymbol,
  isTestFile,
  pointAt,
  type RankedFile,
  rankFiles,
  type SymbolKind,
} from "./query/code-index.js";
export {
  type ContextBrief,
  type ContextCallSite,
  type ContextInputs,
  type ContextJourney,
  type ContextSameJob,
  type ContextStart,
  context,
} from "./query/context.js";
export {
  type EvalCase,
  type EvalCommit,
  type EvalReport,
  evaluate,
  isEvalSource,
  subjectQuery,
} from "./query/eval.js";
export {
  type AffectedJourney,
  type Impact,
  type ImpactConsumer,
  type ImpactResult,
  impact,
  rulesMentioning,
} from "./query/impact.js";
export * from "./query/index.js";
export { type SearchHit, search } from "./query/search.js";
export { queryTerms, sameWord, splitIdentifier } from "./query/terms.js";
export { formatAnnotations, formatFindings, type MarkedFinding } from "./report/check-report.js";
export { formatContext, formatEval } from "./report/context-report.js";
export { type DiffFormat, formatDiff, summary as diffSummary } from "./report/diff-report.js";
export {
  CHANGE_LEGEND,
  type ChangeDiagramInput,
  changeDiagram,
  type JourneyDiagramInput,
  journeyDiagram,
} from "./report/mermaid.js";
export {
  type Ask,
  type ChangeSummary,
  type Concern,
  type PrReport,
  type PrReportInput,
  prReport,
  REPORT_MARKER,
  renderPrComment,
  stepRange,
  summarizeChange,
  VERDICT_MARKER,
  type Verdict,
} from "./report/pr-report.js";
export * from "./report/report.js";
export {
  formatAnchors,
  formatTrace,
  formatTraceChecks,
  formatTraceList,
} from "./report/trace-report.js";
export {
  type AnchorCandidate,
  type AnchorElement,
  type AnchorOptions,
  type AnchorResult,
  anchorError,
  describeEvidence,
  type ErrorEvidence,
  traceSkeleton,
} from "./trace/anchor.js";
export { type TraceInChange, tracesInChange } from "./trace/change.js";
export {
  type CheckTraceOptions,
  checkTrace,
  resolveAnchor,
  type TraceAnchorView,
  type TraceCheck,
  type TraceCodeView,
  type TraceFinding,
  type TraceStepView,
  type TraceView,
} from "./trace/check.js";
export {
  classifyHop,
  type HopKind,
  resolveTraceEnd,
  type TraceEnd,
  type TraceHop,
} from "./trace/hops.js";
export {
  loadTraces,
  type ParsedTraces,
  parseExpands,
  parseTrace,
  type Trace,
  type TraceCodeRef,
  type TraceSpec,
  traceCodeLabel,
  traceCodeRefs,
  traceEvidenceOf,
  traceRoleOf,
} from "./trace/trace.js";
