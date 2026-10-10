// Everything in @archdoc/core that runs without Node: no filesystem, no network.
// The explorer imports this entry point so it builds and queries the model
// with the same engine as the CLI.
export { validateJourneys } from "./check/journeys.js";
export * from "./diagnostics.js";
export { type BuildOptions, buildModel, type ModelSource, normalizeCode } from "./load/build.js";
export { type Resolution, Resolver } from "./load/resolve.js";
export * from "./model.js";
export * from "./query/index.js";
