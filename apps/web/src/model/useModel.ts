import {
  applySchemas,
  buildModel,
  federate,
  type ImportedSchema,
  type LandscapeDomain,
  type LandscapeRepo,
  type Model,
  type ModelSource,
  type SnippetPlace,
} from "@archdoc/core/browser";
import { useCallback, useEffect, useState } from "react";
import type { ChangeFindings } from "./compare.js";

/** What `archdoc view` serves at /api/model. */
export interface ModelPayload {
  root: string;
  sources: ModelSource[];
  /** True when the server watches the files and sends change events. */
  watch: boolean;
  /** Repository files, relative to the repository root, for code mapping. */
  files?: string[];
  /** Where each code snippet is, by snippetKey, so a symbol links to its lines. */
  snippets?: Record<string, SnippetPlace>;
  repo?: RepoLinks;
  /** With `archdoc view --base <ref>`: the model at the merge base with that ref, read like this one. */
  base?: { ref: string; commit?: string; root: string; sources: ModelSource[] } & Partial<
    Pick<ModelPayload, "schemas" | "federation">
  >;
  /** With a base: what the change introduced, found with the code, as `archdoc report` finds it. */
  change?: ChangeFindings;
  /** A composed landscape (`archdoc view --landscape`, `archdoc landscape build`): its repos and domains. */
  landscape?: LandscapeInfo;
  /** Other repos' models, as archdoc.lock pins them. */
  federation?: {
    lockPath: string;
    lock?: unknown;
    lockError?: string | undefined;
    bundles: {
      key: string;
      path: string;
      text?: string | undefined;
      integrity?: string | undefined;
    }[];
  };
  /** Sample records for simulating journeys. */
  samples?: { path: string; text: string }[];
  /** Bug traces beside the model (.archdoc/traces/*.yaml), for the trace view. Never part of the model. */
  traces?: { path: string; text: string }[];
  /** With an archdoc.sum: the facts whose code changed since they were sealed, and new ones. */
  seals?: SealsInfo | undefined;
  /** What data entries' schema sources say, to fill in what the model leaves out. */
  schemas?: ImportedSchema[];
}

/** A model fact to re-check, as `archdoc check --seals` lists it. */
export interface RecheckFact {
  key: string;
  label: string;
  state: "changed" | "unsealed";
  element?: string | undefined;
  refs: string[];
  changes: string[];
  location?: { file: string; line: number } | undefined;
}

export interface SealsInfo {
  file: string;
  error?: string | undefined;
  /** Facts that point at code, sealed or not. */
  total: number;
  facts: RecheckFact[];
}

export interface LandscapeInfo {
  namespace: string;
  name?: string | undefined;
  repos: LandscapeRepo[];
  domains: LandscapeDomain[];
}

/** Where code links point. */
export interface RepoLinks {
  /** Web URL of the repository, such as https://github.com/org/repo. */
  webUrl?: string;
  branch?: string;
  commit?: string;
  /** Absolute path of the repository on this machine, for editor links. */
  root?: string;
}

export type ModelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      model: Model;
      /** The model's own files, to compare them with another version's. */
      sources: { root: string; sources: ModelSource[] };
      watch: boolean;
      files: string[];
      snippets: Record<string, SnippetPlace>;
      repo: RepoLinks;
      /** The model at the base ref, for the before/after view. */
      base?: { ref: string; model: Model; change?: ChangeFindings | undefined } | undefined;
      /** Set when the model is a composed landscape. */
      landscape?: LandscapeInfo | undefined;
      samples: { path: string; text: string }[];
      traces: { path: string; text: string }[];
      seals?: SealsInfo | undefined;
      loadedAt: number;
      reloads: number;
    };

/**
 * Builds the model from what the server sends, as the CLI does: its files,
 * then what schema sources say, then other repos' models.
 */
export function modelOf(
  payload: Pick<ModelPayload, "root" | "sources" | "schemas" | "federation">,
): Model {
  const model = buildModel(payload.sources, { root: payload.root });
  applySchemas(model, payload.schemas ?? []);
  const fed = payload.federation;
  if (
    fed &&
    (fed.lock || fed.lockError || Object.keys(model.imports).length || model.landscapeImport)
  ) {
    federate(model, {
      lockPath: fed.lockPath,
      lock: fed.lock as Parameters<typeof federate>[1]["lock"],
      lockError: fed.lockError,
      bundles: new Map(fed.bundles.map(({ key, ...b }) => [key, b])),
    });
  }
  return model;
}

/**
 * Loads the model files from the CLI and builds the model in the browser with
 * the same engine the CLI uses. With `archdoc view --watch`, rebuilds whenever
 * a file changes.
 */
export function useModel(): ModelState {
  const [state, setState] = useState<ModelState>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      // Relative, so the same build works under archdoc view and on a static host at any path.
      const res = await fetch("api/model", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `The server answered ${res.status}.`);
      }
      const payload = (await res.json()) as ModelPayload;
      const model = modelOf(payload);
      setState((prev) => ({
        status: "ready",
        model,
        sources: { root: payload.root, sources: payload.sources },
        watch: payload.watch,
        files: payload.files ?? [],
        snippets: payload.snippets ?? {},
        repo: payload.repo ?? {},
        base: payload.base && {
          ref: payload.base.ref,
          model: payload.base.sources.length ? modelOf(payload.base) : buildModel([]),
          change: payload.change,
        },
        landscape: payload.landscape,
        samples: payload.samples ?? [],
        traces: payload.traces ?? [],
        seals: payload.seals,
        loadedAt: Date.now(),
        reloads: prev.status === "ready" ? prev.reloads + 1 : 0,
      }));
      return payload.watch;
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }, []);

  useEffect(() => {
    let events: EventSource | undefined;
    let cancelled = false;
    void load().then((watch) => {
      if (!watch || cancelled) return;
      events = new EventSource("api/events");
      events.addEventListener("change", () => void load());
    });
    return () => {
      cancelled = true;
      events?.close();
    };
  }, [load]);

  return state;
}
