import {
  DataRegistry,
  diffModels,
  formatDiagnostic,
  lineage,
  type Model,
  type ModelDiff,
  prReport,
  resolveCodeMap,
  type Simulation,
  simulate,
} from "@archdoc/core/browser";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "./components/Canvas.js";
import { Details } from "./components/Details.js";
import { Sidebar } from "./components/Sidebar.js";
import { dataPlaces, journeyStores } from "./graph/data.js";
import { ancestorsOf, defaultExpanded, journeyExpansion } from "./graph/graph.js";
import {
  boundaryLabel,
  crossingOf,
  type GroupBy,
  type Grouping,
  groupLandscape,
} from "./graph/groups.js";
import { type LandscapeInfo, type RepoLinks, useModel } from "./model/useModel.js";

export function App() {
  const state = useModel();
  if (state.status === "loading") return <Splash>Loading the model…</Splash>;
  if (state.status === "error") {
    return (
      <Splash>
        <strong>Couldn't load the model.</strong> {state.message}
        <br />
        Start the explorer with <code>archdoc view</code> from your repository.
      </Splash>
    );
  }
  return (
    <ReactFlowProvider>
      <Explorer
        model={state.model}
        watch={state.watch}
        reloads={state.reloads}
        files={state.files}
        repo={state.repo}
        base={state.base}
        landscape={state.landscape}
        samples={state.samples}
      />
    </ReactFlowProvider>
  );
}

interface ExplorerProps {
  model: Model;
  watch: boolean;
  reloads: number;
  files: string[];
  repo: RepoLinks;
  base?: { ref: string; model: Model } | undefined;
  landscape?: LandscapeInfo | undefined;
  samples: { path: string; text: string }[];
}

/** What the explorer needs to show changes against a base. */
export interface Compare {
  ref: string;
  base: Model;
  diff: ModelDiff;
  /** IDs of journeys the changes affect. */
  journeys: Set<string>;
}

function Explorer({ model, watch, reloads, files, repo, base, landscape, samples }: ExplorerProps) {
  const [compareOn, setCompareOn] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>("repo");
  // The last simulation, with its sample, so it reruns when the model reloads.
  const [simRun, setSimRun] = useState<{ journey: string; sample: Record<string, unknown> }>();
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(model));
  // Datastores opened to show their tables.
  const [tables, setTables] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string>();
  const [focused, setFocused] = useState(false);
  const [journeyId, setJourneyId] = useState<string>();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [centerOn, setCenterOn] = useState<string>();
  const [query, setQuery] = useState("");
  const [panelWidth, setPanelWidth] = usePanelWidth();
  const search = useRef<HTMLInputElement>(null);

  const journey = journeyId ? model.journeys.get(journeyId) : undefined;
  const simulation = useMemo<Simulation | undefined>(
    () =>
      simRun && journey && simRun.journey === journey.id
        ? simulate(model, journey.id, simRun.sample)
        : undefined,
    [model, journey, simRun],
  );
  const compare = useMemo<Compare | undefined>(() => {
    if (!base || !compareOn) return undefined;
    const diff = diffModels(base.model, model);
    const affected = prReport({ model, changedFiles: [], diff, findings: [] }).journeys;
    return { ref: base.ref, base: base.model, diff, journeys: new Set(affected.map((j) => j.id)) };
  }, [base, compareOn, model]);
  const code = useMemo(
    () => ({ codemap: resolveCodeMap(model, files), repo, files: new Set(files) }),
    [model, files, repo],
  );

  // After a live reload, drop references to things that no longer exist.
  useEffect(() => {
    setExpanded((prev) => new Set([...prev].filter((id) => model.elements.has(id))));
    setTables((prev) => new Set([...prev].filter((id) => model.elements.has(id))));
    setSelected((prev) => (prev && exists(model, prev, landscape) ? prev : undefined));
    setSimRun((prev) => (prev && model.journeys.has(prev.journey) ? prev : undefined));
    setJourneyId((prev) => (prev && model.journeys.has(prev) ? prev : undefined));
  }, [model, landscape]);

  const grouping = useMemo<Grouping | undefined>(
    () => (landscape ? groupLandscape(model, landscape, groupBy) : undefined),
    [model, landscape, groupBy],
  );
  const view = useMemo(
    () => ({ expanded, focus: focused && !journey ? selected : undefined, grouping, tables }),
    [expanded, focused, journey, selected, grouping, tables],
  );

  const select = useCallback(
    (key: string | undefined) => {
      setJourneyId(undefined);
      setPlaying(false);
      setSelected(key);
      if (!key) {
        setFocused(false);
        return;
      }
      if (key.startsWith("element:")) {
        const hidden = ancestorsOf(model, key.slice(8));
        setExpanded((prev) =>
          hidden.every((a) => prev.has(a)) ? prev : new Set([...prev, ...hidden]),
        );
      }
      if (key.startsWith("data:") || key.startsWith("field:")) {
        // Open what the data goes through: the boxes it travels between, and its stores' tables.
        const entries = key.startsWith("data:")
          ? [key.slice(5)]
          : (lineageEntries(model, key.slice(6)) ?? []);
        const places = entries.map((e) => dataPlaces(model, e));
        const stores = places.flatMap((p) => p.stores);
        const open = [...stores, ...places.flatMap((p) => p.ends)].flatMap((id) =>
          ancestorsOf(model, id),
        );
        setExpanded((prev) =>
          open.every((a) => prev.has(a)) ? prev : new Set([...prev, ...open]),
        );
        setTables((prev) =>
          stores.every((id) => prev.has(id)) ? prev : new Set([...prev, ...stores]),
        );
        return;
      }
      if (key.startsWith("domain:")) {
        // A domain is a box only when grouping by domain.
        setGroupBy("domain");
        setCenterOn(`group:domain:${key.slice(7)}`);
        return;
      }
      setCenterOn(key);
    },
    [model],
  );

  const toggleTables = useCallback((id: string) => {
    setTables((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setCenterOn(`element:${id}`);
  }, []);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Bring the opened (or closed) element into view once it's laid out again.
    setCenterOn(`element:${id}`);
  }, []);

  const openJourney = useCallback(
    (id: string) => {
      const j = model.journeys.get(id);
      if (!j) return;
      setSelected(undefined);
      setFocused(false);
      setJourneyId(id);
      setStep(0);
      setPlaying(false);
      // Open the tables the journey writes to, so its data can be watched changing.
      const stores = journeyStores(model, j);
      setExpanded(
        (prev) =>
          new Set([
            ...prev,
            ...journeyExpansion(model, j),
            ...stores.flatMap((id) => ancestorsOf(model, id)),
          ]),
      );
      setTables((prev) => new Set([...prev, ...stores]));
    },
    [model],
  );

  const stepCount = journey?.steps.length ?? 0;
  const go = useCallback(
    (n: number) => setStep(Math.max(0, Math.min(stepCount - 1, n))),
    [stepCount],
  );

  useEffect(() => {
    if (!playing) return;
    if (step >= stepCount - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 1800);
    return () => clearTimeout(t);
  }, [playing, step, stepCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      } else if (!typing && e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (!typing && e.key === "Escape") {
        select(undefined);
      } else if (!typing && journey && e.key === "ArrowRight") {
        go(step + 1);
      } else if (!typing && journey && e.key === "ArrowLeft") {
        go(step - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [journey, step, go, select]);

  const currentStep = journey?.steps[step];
  const crossing =
    grouping && currentStep?.from && currentStep.to
      ? crossingOf(model, grouping, currentStep.from, currentStep.to)
      : undefined;
  const errors = model.diagnostics.filter((d) => d.severity === "error");
  const warnings = model.diagnostics.filter((d) => d.severity === "warning");

  return (
    <div className="app" style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}>
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={20} height={20} />
          <span>ArchDoc</span>
          <span className="model-name">{model.name ?? model.namespace}</span>
        </div>
        <div className="topbar-right">
          {landscape ? (
            <fieldset className="segmented" aria-label="Group the landscape by">
              <legend>Group by</legend>
              {(["repo", "team", "domain"] as const).map((by) => (
                <button
                  key={by}
                  type="button"
                  className={`btn${groupBy === by ? " is-on" : ""}`}
                  aria-pressed={groupBy === by}
                  disabled={by === "domain" && landscape.domains.length === 0}
                  title={
                    by === "domain" && landscape.domains.length === 0
                      ? "The landscape defines no domains"
                      : undefined
                  }
                  onClick={() => setGroupBy(by)}
                >
                  {by === "repo" ? "Repo" : by === "team" ? "Team" : "Domain"}
                </button>
              ))}
            </fieldset>
          ) : null}
          {base ? (
            <button
              type="button"
              className={`btn compare-toggle${compareOn ? " is-on" : ""}`}
              aria-pressed={compareOn}
              onClick={() => setCompareOn((on) => !on)}
              title={`Show what changed in the model since ${base.ref}`}
            >
              Changes since {base.ref}
            </button>
          ) : null}
          {watch ? (
            <span
              className="live"
              title="Watching the model files. Changes appear here automatically."
            >
              <span className="live-dot" key={reloads} /> Live
            </span>
          ) : null}
        </div>
      </header>

      {errors.length || warnings.length ? (
        <details className={`diagnostics${errors.length ? " has-errors" : ""}`}>
          <summary>
            {errors.length ? `${errors.length} error${errors.length === 1 ? "" : "s"}` : ""}
            {errors.length && warnings.length ? ", " : ""}
            {warnings.length ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}{" "}
            in the model{errors.length ? ". What you see may be incomplete." : "."}
          </summary>
          <ul>
            {model.diagnostics.map((d) => (
              <li key={formatDiagnostic(d)} className={`sev-${d.severity}`}>
                <code>{formatDiagnostic(d)}</code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Sidebar
        ref={search}
        model={model}
        query={query}
        onQuery={setQuery}
        expanded={expanded}
        selected={selected}
        journeyId={journeyId}
        onSelect={select}
        onToggle={toggle}
        onJourney={openJourney}
        compare={compare}
        landscape={landscape}
        onGroupBy={setGroupBy}
      />

      <main className="canvas" aria-label="Architecture diagram">
        {
          <Canvas
            model={model}
            grouping={grouping}
            simulation={simulation}
            view={view}
            selected={selected}
            journey={journey}
            step={step}
            centerOn={centerOn}
            onCentered={() => setCenterOn(undefined)}
            onSelect={select}
            onToggle={toggle}
            onTables={toggleTables}
            compare={compare}
          />
        }
        {journey && currentStep ? (
          <section className="journey-bar" aria-label="Journey steps">
            <div className="journey-bar-title">
              <strong>{journey.spec.name ?? journey.id}</strong>
              <span>
                Step {step + 1} of {stepCount}
              </span>
            </div>
            <p className="journey-bar-step">
              <span className="step-path">
                {currentStep.spec.from} → {currentStep.spec.to}
              </span>
              {currentStep.spec.action ? <span> {currentStep.spec.action}</span> : null}
            </p>
            {simulation ? <StepData simulation={simulation} step={step} /> : null}
            {crossing ? (
              <p className="journey-bar-crossing">
                Crosses from {boundaryLabel(grouping as Grouping, crossing.from)} to{" "}
                {boundaryLabel(grouping as Grouping, crossing.to)}
              </p>
            ) : null}
            <div className="journey-bar-controls">
              <button
                type="button"
                className="btn"
                onClick={() => go(step - 1)}
                disabled={step === 0}
              >
                ← Back
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  if (step >= stepCount - 1) setStep(0);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? "Pause" : step >= stepCount - 1 ? "Replay" : "Play"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => go(step + 1)}
                disabled={step >= stepCount - 1}
              >
                Next →
              </button>
              <button type="button" className="btn ghost" onClick={() => select(undefined)}>
                Close
              </button>
            </div>
          </section>
        ) : null}
      </main>

      <aside className="panel" aria-label="Details">
        <ResizeHandle width={panelWidth} onResize={setPanelWidth} />
        <Details
          model={model}
          selected={selected}
          journey={journey}
          step={step}
          focused={focused}
          expanded={expanded}
          onSelect={select}
          onJourney={openJourney}
          onStep={(n) => {
            setPlaying(false);
            go(n);
          }}
          onFocus={setFocused}
          onToggle={toggle}
          code={code}
          compare={compare}
          landscape={landscape}
          samples={samples}
          simulation={simulation}
          onSimulate={(sample) => {
            setSimRun(sample && journey ? { journey: journey.id, sample } : undefined);
            setPlaying(false);
          }}
        />
      </aside>
    </div>
  );
}

/** What the current step does to the data, in the simulation. */
function StepData({ simulation, step }: { simulation: Simulation; step: number }) {
  const s = simulation.steps[step];
  if (!s) return null;
  if (!s.ran) return <p className="journey-bar-data is-skipped">Skipped: {s.skipped}</p>;
  const parts = [
    s.decision ? `decides ${s.decision.outcome ?? "nothing"}` : "",
    ...s.events
      .filter((e) => e.kind !== "sent")
      .map(
        (e) =>
          `${e.kind === "created" ? "+" : "~"} ${e.entry.split(".").slice(-1)[0]}${e.tables[0] ? ` → ${e.tables[0].table}` : ""}`,
      ),
  ].filter(Boolean);
  return parts.length ? <p className="journey-bar-data">{parts.join(" · ")}</p> : null;
}

function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const start = useRef<{ x: number; w: number } | undefined>(undefined);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable, draggable window splitter; <hr> can't be one.
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details panel"
      aria-valuenow={width}
      aria-valuemin={MIN_PANEL}
      aria-valuemax={MAX_PANEL}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.w + (start.current.x - e.clientX));
      }}
      onPointerUp={() => {
        start.current = undefined;
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width + 24);
        if (e.key === "ArrowRight") onResize(width - 24);
      }}
    />
  );
}

const MIN_PANEL = 280;
const MAX_PANEL = 720;
const PANEL_KEY = "archdoc:panel-width";

function usePanelWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(PANEL_KEY));
      if (saved >= MIN_PANEL && saved <= MAX_PANEL) return saved;
    } catch {
      // Storage can be unavailable; the default is fine.
    }
    return 360;
  });
  const set = useCallback((w: number) => {
    const clamped = Math.round(Math.max(MIN_PANEL, Math.min(MAX_PANEL, w)));
    setWidth(clamped);
    try {
      localStorage.setItem(PANEL_KEY, String(clamped));
    } catch {
      // Ignore: the width just won't be remembered.
    }
  }, []);
  return [width, set];
}

/** The entries a field's lineage goes through. */
function lineageEntries(model: Model, ref: string): string[] | undefined {
  const l = lineage(model, ref);
  if (!l) return undefined;
  return [
    ...new Set([
      l.field.entry,
      ...[...l.upstream, ...l.downstream].flatMap((e) => [
        e.to.entry,
        ...e.from.map((f) => f.entry),
      ]),
    ]),
  ];
}

function exists(model: Model, key: string, landscape?: LandscapeInfo): boolean {
  if (key.startsWith("data:")) return !!new DataRegistry(model).entry(key.slice(5));
  if (key.startsWith("field:")) return lineage(model, key.slice(6)) !== undefined;
  if (key.startsWith("domain:")) return !!landscape?.domains.some((d) => d.id === key.slice(7));
  if (key.startsWith("actor:")) return model.actors.has(key.slice(6));
  if (key.startsWith("element:")) return model.elements.has(key.slice(8));
  return model.relationships.some(
    (r) => r.to.type === "external" && `external:${r.to.ref}` === key,
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="splash">
      <p>{children}</p>
    </div>
  );
}
