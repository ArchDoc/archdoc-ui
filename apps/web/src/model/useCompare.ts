import { buildModel, type Model, type ModelSource } from "@archdoc/core/browser";
import { useEffect, useMemo, useState } from "react";
import type { ChangeFindings } from "./compare.js";
import { type ModelPayload, modelOf, type RepoLinks } from "./useModel.js";

/** The branches `archdoc view` can compare. Undefined on a static host, which has no git. */
export interface Refs {
  current?: string | undefined;
  branches: string[];
  /** The --base the server started with. */
  base?: string | undefined;
}

export function useRefs(): Refs | undefined {
  const [refs, setRefs] = useState<Refs>();
  useEffect(() => {
    let cancelled = false;
    fetch("api/refs", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<Refs>) : undefined))
      .then((r) => {
        if (!cancelled && r && Array.isArray(r.branches)) setRefs(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return refs;
}

/** Which two versions the Changes tab compares. No head means the working tree. */
export interface Pair {
  base: string;
  head?: string | undefined;
}

export type Compared =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      base: Model;
      head?: Head | undefined;
      /** What the server found comparing them with the code. */
      change?: ChangeFindings | undefined;
    };

/** A branch as the Changes tab shows it: its model, and the files and samples at its commit. */
export interface Head {
  ref: string;
  model: Model;
  files: string[];
  snippets: NonNullable<ModelPayload["snippets"]>;
  repo: RepoLinks;
  samples: { path: string; text: string }[];
}

interface Sources extends Partial<ModelPayload> {
  ref: string;
  root: string;
  sources: ModelSource[];
}

/** The model at each side of the pair, read from git by the view server. */
export function useCompared(
  pair: Pair | undefined,
  preset: { ref: string; model: Model; change?: ChangeFindings | undefined } | undefined,
): Compared {
  const [state, setState] = useState<Compared>(IDLE);
  // What the page loaded with needs no request, so it also works on a static host.
  const fromPreset = !!pair && !pair.head && pair.base === preset?.ref;
  useEffect(() => {
    if (!pair || fromPreset) return;
    let cancelled = false;
    setState({ status: "loading" });
    const query = new URLSearchParams({
      base: pair.base,
      ...(pair.head ? { head: pair.head } : {}),
    });
    fetch(`api/compare?${query}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          base?: Sources;
          head?: Sources;
          change?: ChangeFindings;
        };
        if (!res.ok || !body.base)
          throw new Error(body.error ?? `The server answered ${res.status}.`);
        return {
          base: build(body.base),
          head: body.head && head(body.head),
          change: body.change,
        };
      })
      .then(
        (models) => !cancelled && setState({ status: "ready", ...models }),
        (err: unknown) =>
          !cancelled &&
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, [pair, fromPreset]);
  const presetModel = fromPreset ? preset : undefined;
  const ready = useMemo<Compared | undefined>(
    () => presetModel && { status: "ready", base: presetModel.model, change: presetModel.change },
    [presetModel],
  );
  if (!pair) return IDLE;
  return ready ?? state;
}

const IDLE: Compared = { status: "idle" };

function head(p: Sources): Head {
  return {
    ref: p.ref,
    model: modelOf(p),
    files: p.files ?? [],
    snippets: p.snippets ?? {},
    repo: p.repo ?? {},
    samples: p.samples ?? [],
  };
}

function build(s: Sources): Model {
  return s.sources.length ? modelOf(s) : buildModel([]);
}

/** The explorer's tabs. */
export type Tab = "overview" | "journeys" | "data" | "changes";

/** What the address says to open. */
export interface HashState {
  tab?: Tab | undefined;
  pair?: Pair | undefined;
  /** The open journey on the Journeys tab. */
  journey?: string | undefined;
  /** The selected entry or field on the Data tab, as data:<entry> or field:<entry.field>. */
  data?: string | undefined;
}

/**
 * What the address opens, such as #changes=main...feature (so a link opens the
 * same comparison), #journeys=request-refund, or #data=payments.Refund.
 */
export function readHash(hash = window.location.hash): HashState {
  const parts = hash.replace(/^#/, "").split("&").filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf("=");
    const name = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? "" : decodeURIComponent(part.slice(eq + 1));
    if (name === "changes") {
      const [base, head] = value.split("...");
      return { tab: "changes", pair: base ? { base, head: head || undefined } : undefined };
    }
    if (name === "journeys") return { tab: "journeys", journey: value || undefined };
    if (name === "data") {
      const data = value
        ? value.split(".").length > 2
          ? `field:${value}`
          : `data:${value}`
        : undefined;
      return { tab: "data", data };
    }
    if (name === "overview") return { tab: "overview" };
  }
  return {};
}

/** The address for what's open; the Overview has none. */
export function hashOf(state: HashState): string {
  const pair = state.pair;
  switch (state.tab) {
    case "changes":
      return `#changes${pair ? `=${encodeURIComponent(pair.base)}${pair.head ? `...${encodeURIComponent(pair.head)}` : ""}` : ""}`;
    case "journeys":
      return `#journeys${state.journey ? `=${encodeURIComponent(state.journey)}` : ""}`;
    case "data": {
      const entry = state.data?.replace(/^(data|field):/, "");
      return `#data${entry ? `=${encodeURIComponent(entry)}` : ""}`;
    }
    default:
      return "";
  }
}

export function writeHash(state: HashState) {
  const hash = hashOf(state);
  if (window.location.hash === hash) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
}
