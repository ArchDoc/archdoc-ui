import {
  buildModel,
  type LandscapeDomain,
  type LandscapeRepo,
  type Model,
  type ModelSource,
} from "@archdoc/core/browser";
import { useCallback, useEffect, useState } from "react";

/** What `archdoc view` serves at /api/model. */
export interface ModelPayload {
  root: string;
  sources: ModelSource[];
  /** True when the server watches the files and sends change events. */
  watch: boolean;
  /** Repository files, relative to the repository root, for code mapping. */
  files?: string[];
  repo?: RepoLinks;
  /** With `archdoc view --base <ref>`: the model's files at that ref. */
  base?: { ref: string; commit: string; root: string; sources: ModelSource[] };
  /** A composed landscape (`archdoc view --landscape`, `archdoc landscape build`): its repos and domains. */
  landscape?: LandscapeInfo;
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
      watch: boolean;
      files: string[];
      repo: RepoLinks;
      /** The model at the base ref, for the before/after view. */
      base?: { ref: string; model: Model } | undefined;
      loadedAt: number;
      reloads: number;
    };

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
      const model = buildModel(payload.sources, { root: payload.root });
      setState((prev) => ({
        status: "ready",
        model,
        watch: payload.watch,
        files: payload.files ?? [],
        repo: payload.repo ?? {},
        base: payload.base && {
          ref: payload.base.ref,
          model: payload.base.sources.length
            ? buildModel(payload.base.sources, { root: payload.base.root })
            : buildModel([]),
        },
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
