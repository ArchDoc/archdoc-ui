import {
  type ComposedLandscape,
  composeLandscape,
  type LoadedModel,
  loadModel,
  repoInfo,
} from "@archdoc/core";

/** What the explorer loads for a landscape: the composed model, as one source. */
export interface LandscapePayload {
  root: string;
  sources: { path: string; text: string }[];
  watch: boolean;
  files: string[];
  repo: Record<string, unknown>;
  landscape: {
    namespace: string;
    name?: string | undefined;
    repos: ComposedLandscape["repos"];
    domains: ComposedLandscape["domains"];
  };
}

/**
 * Loads a landscape repo's model and composes it with the models it imports.
 * Fails when the imports aren't synced, since then there's nothing to compose.
 */
export async function loadLandscape(
  target: string,
  cwd: string,
): Promise<{ model: LoadedModel; composed: ComposedLandscape }> {
  const model = await loadModel(target, { cwd });
  if (model.diagnostics.some((d) => d.code === "model/not-found")) {
    throw new Error(model.diagnostics[0]?.message ?? "No ArchDoc model found.");
  }
  if (Object.keys(model.imports).length === 0) {
    throw new Error(
      "This model imports no other repos, so there's no landscape to compose. List them under imports.",
    );
  }
  if (!model.imported?.size) {
    throw new Error("The landscape's imports aren't synced. Run archdoc sync first.");
  }
  return { model, composed: composeLandscape(model) };
}

export async function landscapePayload(
  model: LoadedModel,
  composed: ComposedLandscape,
  watch: boolean,
): Promise<LandscapePayload> {
  return {
    root: composed.root,
    sources: composed.sources,
    watch,
    files: [],
    repo: { ...(await repoInfo(model.baseDir)) },
    landscape: {
      namespace: model.namespace,
      name: model.name,
      repos: composed.repos,
      domains: composed.domains,
    },
  };
}
