import {
  buildModel,
  DataRegistry,
  formatDiagnostic,
  lineage,
  type Model,
  resolveCodeMap,
  type Simulation,
  type SnippetPlace,
  simulate,
} from "@archdoc/core/browser";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "./components/Canvas.js";
import { Details } from "./components/Details.js";
import { Sidebar } from "./components/Sidebar.js";
import {
  dataPlaces,
  type Interaction,
  interactionRows,
  journeyInteractions,
  journeyInvolvement,
  journeyStores,
  sampleSkeleton,
  stepData,
} from "./graph/data.js";
import { ancestorsOf, defaultExpanded, journeyExpansion } from "./graph/graph.js";
import {
  boundaryLabel,
  crossingOf,
  type GroupBy,
  type Grouping,
  groupLandscape,
} from "./graph/groups.js";
import { type Compare, compareModels } from "./model/compare.js";
import {
  type Pair,
  type Refs,
  readHash,
  useCompared,
  useRefs,
  writeHash,
} from "./model/useCompare.js";
import { type LandscapeInfo, type RepoLinks, useModel } from "./model/useModel.js";

export function App() {
  const state = useModel();
  const samples = useMemo(
    () => (state.status === "ready" ? samplesFor(state.model, state.samples) : []),
    [state],
  );
  const refs = useRefs();
  const [initial] = useState(readHash);
  const [tab, setTab] = useState<Tab>(initial.tab ?? "explore");
  const [chosen, setChosen] = useState<Pair | undefined>(initial.pair);
  const preset = state.status === "ready" ? state.base : undefined;
  // `archdoc view --base` picks the base until someone picks another.
  const presetRef = preset?.ref ?? refs?.base;
  const pair = useMemo<Pair | undefined>(
    () => chosen ?? (presetRef ? { base: presetRef } : undefined),
    [chosen, presetRef],
  );
  const compared = useCompared(pair, preset);
  const sources = state.status === "ready" ? state.sources : undefined;
  const compare = useMemo<Compare | undefined>(() => {
    if (!pair || compared.status !== "ready") return undefined;
    // The model's files alone, as the base was built, so only what they change shows.
    const head =
      compared.head ??
      (sources?.sources.length ? buildModel(sources.sources, { root: sources.root }) : undefined);
    return head ? compareModels(pair.base, compared.base, pair.head, head) : undefined;
  }, [pair, compared, sources]);
  useEffect(() => writeHash(tab, chosen), [tab, chosen]);

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
  const changes: ChangesControl | undefined =
    preset || refs?.branches.length
      ? {
          refs,
          pair,
          onPair: setChosen,
          compare,
          note:
            compared.status === "loading"
              ? `Reading the model at ${[pair?.base, pair?.head].filter(Boolean).join(" and ")}…`
              : compared.status === "error"
                ? compared.message
                : pair
                  ? undefined
                  : "Pick a branch to compare with.",
        }
      : undefined;
  return (
    <ReactFlowProvider>
      <Explorer
        // A branch's model replaces the working tree's while the Changes tab shows it.
        model={
          tab === "changes" && compared.status === "ready" && compared.head
            ? compared.head
            : state.model
        }
        watch={state.watch}
        reloads={state.reloads}
        files={state.files}
        snippets={state.snippets}
        repo={state.repo}
        tab={changes ? tab : "explore"}
        onTab={setTab}
        changes={changes}
        landscape={state.landscape}
        samples={samples}
      />
    </ReactFlowProvider>
  );
}

type Tab = "explore" | "changes";

/** What the Changes tab compares and how to pick it. */
interface ChangesControl {
  /** Undefined on a static host, where only the base the page was built with exists. */
  refs?: Refs | undefined;
  pair?: Pair | undefined;
  onPair: (pair: Pair) => void;
  compare?: Compare | undefined;
  /** Why there's nothing to show yet. */
  note?: string | undefined;
}

interface ExplorerProps {
  model: Model;
  watch: boolean;
  reloads: number;
  files: string[];
  snippets: Record<string, SnippetPlace>;
  repo: RepoLinks;
  tab: Tab;
  onTab: (tab: Tab) => void;
  changes?: ChangesControl | undefined;
  landscape?: LandscapeInfo | undefined;
  samples: { path: string; text: string }[];
}

function Explorer({
  model,
  watch,
  reloads,
  files,
  snippets,
  repo,
  tab,
  onTab,
  changes,
  landscape,
  samples,
}: ExplorerProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("repo");
  // The last simulation, with its sample, so it reruns when the model reloads.
  // What the open journey runs on: its own sample, example data, or a sample edited in the panel.
  const [simRun, setSimRun] = useState<{
    journey: string;
    sample: Record<string, unknown>;
    label: string;
  }>();
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(model));
  // Datastores opened to show their tables, and those showing a journey's rows instead.
  const [tables, setTables] = useState<ReadonlySet<string>>(() => new Set());
  const [rowStores, setRowStores] = useState<ReadonlySet<string>>(() => new Set());
  // Tables showing their fields, by qualified entry; the rest show only their names.
  const [openFields, setOpenFields] = useState<ReadonlySet<string>>(() => new Set());
  // During a journey, datastores showing every table, and tables brought back one at a time.
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());
  const [extra, setExtra] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string>();
  const [focused, setFocused] = useState(false);
  const [journeyId, setJourneyId] = useState<string>();
  // The interaction the journey is at: a step's arrow, or its writer storing what it wrote.
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [centerOn, setCenterOn] = useState<string>();
  const [query, setQuery] = useState("");
  const [panelWidth, setPanelWidth] = usePanelWidth();
  const search = useRef<HTMLInputElement>(null);

  const journey = journeyId ? model.journeys.get(journeyId) : undefined;
  const interactions = useMemo(
    () => (journey ? journeyInteractions(model, journey) : []),
    [model, journey],
  );
  const interaction: Interaction | undefined = interactions[at];
  const step = interaction?.step ?? 0;
  const simulation = useMemo<Simulation | undefined>(
    () =>
      simRun && journey && simRun.journey === journey.id
        ? simulate(model, journey.id, simRun.sample)
        : undefined,
    [model, journey, simRun],
  );
  // The canvas shows what changed only on the Changes tab.
  const compare = tab === "changes" ? changes?.compare : undefined;
  const code = useMemo(
    () => ({ codemap: resolveCodeMap(model, files), repo, files: new Set(files), snippets }),
    [model, files, repo, snippets],
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
  // The rows the journey has at the current step, for stores showing rows.
  const rows = useMemo(
    () =>
      journey && rowStores.size
        ? interactionRows(model, journey, interactions, at, simulation)
        : undefined,
    [model, journey, interactions, at, simulation, rowStores],
  );
  // What the journey uses; the rest of its datastores folds away.
  const involved = useMemo(
    () => (journey ? journeyInvolvement(model, journey, rows) : undefined),
    [model, journey, rows],
  );
  const view = useMemo(
    () => ({
      expanded,
      focus: focused && !journey ? selected : undefined,
      grouping,
      tables,
      openFields,
      rows: rows && { stores: rowStores, data: rows },
      involved,
      showAll,
      extra,
    }),
    [
      expanded,
      focused,
      journey,
      selected,
      grouping,
      tables,
      openFields,
      rows,
      rowStores,
      involved,
      showAll,
      extra,
    ],
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
        // A field's lineage lights up fields: open the tables it goes through.
        if (key.startsWith("field:")) {
          setOpenFields((prev) =>
            entries.every((e) => prev.has(e)) ? prev : new Set([...prev, ...entries]),
          );
        }
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

  // Show an open datastore's schema or the journey's rows, and bring it into view.
  const storeView = useCallback((id: string, v: "erd" | "rows") => {
    setRowStores((prev) => {
      const next = new Set(prev);
      if (v === "rows") next.add(id);
      else next.delete(id);
      return next;
    });
    setCenterOn(`element:${id}`);
  }, []);
  const journeyStoreIds = useMemo(
    () => (journey ? journeyStores(model, journey).filter((id) => tables.has(id)) : []),
    [model, journey, tables],
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

  const toggleFields = useCallback((entry: string) => {
    setOpenFields((prev) => {
      const next = new Set(prev);
      if (next.has(entry)) next.delete(entry);
      else next.add(entry);
      return next;
    });
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
      setAt(0);
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
      setShowAll(new Set());
      setExtra(new Set());
      // A sample named after the journey (samples/<journey>*.json) runs right away; else example data.
      const named = matchingSample(samples, id);
      setSimRun(
        named
          ? { journey: id, ...named }
          : { journey: id, sample: sampleSkeleton(model, j), label: "Example data" },
      );
    },
    [model, samples],
  );

  const count = interactions.length;
  const go = useCallback((n: number) => setAt(Math.max(0, Math.min(count - 1, n))), [count]);

  useEffect(() => {
    if (!playing) return;
    if (at >= count - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setAt((s) => s + 1), 1800);
    return () => clearTimeout(t);
  }, [playing, at, count]);

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
        go(at + 1);
      } else if (!typing && journey && e.key === "ArrowLeft") {
        go(at - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [journey, at, go, select]);

  const crossing =
    grouping && interaction
      ? crossingOf(model, grouping, interaction.from, interaction.to)
      : undefined;
  // What the current interaction carries: the step's message, or what its writer stores.
  const carries = useMemo(() => {
    if (!journey || !interaction) return [];
    if (interaction.store) return interaction.writes;
    return stepData(model, journey, interaction.step).message?.entries.map((e) => e.entry) ?? [];
  }, [model, journey, interaction]);
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
        {changes ? (
          <div className="tabs" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === "explore"}
              onClick={() => onTab("explore")}
            >
              Explore
            </button>
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === "changes"}
              onClick={() => onTab("changes")}
              title={
                changes.pair
                  ? `What changes ${changes.pair.head ?? "the working tree"} makes to the model since ${changes.pair.base}`
                  : "Compare the model on two branches"
              }
            >
              Changes
              {changes.compare ? (
                <span
                  className={`tab-count${changes.compare.groups.breaks.some((b) => b.kind === "error") ? " has-breaks" : ""}`}
                >
                  {changes.compare.count}
                </span>
              ) : null}
            </button>
          </div>
        ) : null}
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
          {tab === "changes" && changes ? <PairPicker changes={changes} /> : null}
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
        changesNote={tab === "changes" ? changes?.note : undefined}
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
            interactions={interactions}
            at={at}
            centerOn={centerOn}
            onCentered={() => setCenterOn(undefined)}
            onSelect={select}
            onToggle={toggle}
            onTables={toggleTables}
            onFields={toggleFields}
            onStoreView={storeView}
            onShowTable={(entry) => setExtra((prev) => new Set([...prev, entry]))}
            onShowAll={(id) => setShowAll((prev) => new Set([...prev, id]))}
            compare={compare}
          />
        }
        {journey && interaction ? (
          <JourneyCard
            model={model}
            name={journey.spec.name ?? journey.id}
            steps={journey.steps.length}
            interactions={interactions}
            at={at}
            carries={carries}
            simulation={simulation}
            data={simRun?.journey === journey.id ? simRun.label : undefined}
            crossing={
              crossing && grouping
                ? `Crosses from ${boundaryLabel(grouping, crossing.from)} to ${boundaryLabel(grouping, crossing.to)}`
                : undefined
            }
            playing={playing}
            onGo={(n) => {
              setPlaying(false);
              go(n);
            }}
            onPlay={() => {
              if (at >= count - 1) setAt(0);
              setPlaying((p) => !p);
            }}
            onClose={() => select(undefined)}
            stores={journeyStoreIds.map((id) => ({
              id,
              name: model.elements.get(id)?.spec.name ?? id,
              view: rowStores.has(id) ? ("rows" as const) : ("erd" as const),
              all: showAll.has(id),
            }))}
            onStore={(id) => setCenterOn(`element:${id}`)}
            onStoreView={storeView}
            onShowAll={(id, on) => {
              setShowAll((prev) => {
                const next = new Set(prev);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              });
              if (!on) setExtra(new Set());
            }}
          />
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
            go(
              Math.max(
                0,
                interactions.findIndex((x) => x.step === n),
              ),
            );
          }}
          onFocus={setFocused}
          onToggle={toggle}
          code={code}
          compare={compare}
          landscape={landscape}
          samples={samples}
          simulation={simulation}
          onSimulate={(sample, label) => {
            if (!journey) return;
            setSimRun(
              sample
                ? { journey: journey.id, sample, label }
                : {
                    journey: journey.id,
                    sample: sampleSkeleton(model, journey),
                    label: "Example data",
                  },
            );
            setPlaying(false);
          }}
        />
      </aside>
    </div>
  );
}

interface JourneyCardProps {
  model: Model;
  name: string;
  /** How many steps the journey has. */
  steps: number;
  interactions: readonly Interaction[];
  at: number;
  /** Qualified entries the current interaction carries. */
  carries: string[];
  simulation?: Simulation | undefined;
  /** What the journey runs on: "Example data", or a sample's path. */
  data?: string | undefined;
  crossing?: string | undefined;
  playing: boolean;
  onGo: (at: number) => void;
  onPlay: () => void;
  onClose: () => void;
  /** Datastores the journey writes to, with their tables open. */
  stores: { id: string; name: string; view: "erd" | "rows"; all: boolean }[];
  onStore: (id: string) => void;
  onStoreView: (id: string, view: "erd" | "rows") => void;
  onShowAll: (id: string, on: boolean) => void;
}

/**
 * The open journey: what the current interaction does, first and largest;
 * then who it goes between and what it carries; then the controls. How
 * datastores are shown sits apart, at the bottom.
 */
function JourneyCard(props: JourneyCardProps) {
  const { model, interactions, at } = props;
  const x = interactions[at] as Interaction;
  const last = at >= interactions.length - 1;
  const ns = `${model.namespace}.`;
  const short = (e: string) => (e.startsWith(ns) ? e.slice(ns.length) : e);
  const name = (t: Interaction["from"]) =>
    t.type === "external"
      ? t.ref
      : ((t.type === "element" ? model.elements.get(t.id)?.spec.name : undefined) ?? t.id);
  const action =
    x.action ?? (props.carries.length ? `Sends ${props.carries.map(short).join(", ")}` : "");
  return (
    <section className="journey-card" aria-label="Journey">
      <header className="journey-card-head">
        <span className="journey-card-name">{props.name}</span>
        <span className="journey-card-count">
          Step {x.label} of {props.steps}
        </span>
        <button
          type="button"
          className="journey-card-close"
          aria-label="Close the journey"
          title="Close"
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <ol className="journey-progress" aria-hidden="true">
        {interactions.map((y, i) => (
          <li
            key={y.label}
            className={i < at ? "is-done" : i === at ? "is-current" : undefined}
            title={`${y.label}. ${y.action ?? ""}`}
          />
        ))}
      </ol>
      <p className="journey-card-action" aria-live="polite">
        {action}
      </p>
      <p className="journey-card-path">
        <span className="step-path">
          {name(x.from)} → {name(x.to)}
        </span>
        {props.carries.map((e) => (
          <span key={e} className="journey-card-chip">
            {short(e)}
          </span>
        ))}
      </p>
      {props.simulation ? <StepData simulation={props.simulation} interaction={x} /> : null}
      {props.crossing ? <p className="journey-card-note">{props.crossing}</p> : null}
      <div className="journey-card-controls">
        <button
          type="button"
          className="btn"
          onClick={() => props.onGo(at - 1)}
          disabled={at === 0}
        >
          ← Back
        </button>
        <button type="button" className="btn primary" onClick={props.onPlay}>
          {props.playing ? "Pause" : last ? "Replay" : "Play"}
        </button>
        <button type="button" className="btn" onClick={() => props.onGo(at + 1)} disabled={last}>
          Next →
        </button>
      </div>
      {props.stores.length || props.data ? (
        <footer className="journey-card-view">
          {props.data ? (
            <span
              className="journey-card-data-source"
              title="Change it in the details panel, under Simulate"
            >
              {props.data}
            </span>
          ) : null}
          {props.stores.map((st) => (
            <fieldset
              key={st.id}
              className="journey-store"
              aria-label={`${st.name}: schema or rows`}
            >
              <button
                type="button"
                className="link"
                title="Show it"
                onClick={() => props.onStore(st.id)}
              >
                {st.name}
              </button>
              <span className="store-view">
                {(["erd", "rows"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={st.view === v ? "is-on" : undefined}
                    aria-pressed={st.view === v}
                    onClick={() => props.onStoreView(st.id, v)}
                  >
                    {v === "erd" ? "ERD" : "Rows"}
                  </button>
                ))}
              </span>
              <label className="journey-store-all">
                <input
                  type="checkbox"
                  checked={st.all}
                  onChange={(e) => props.onShowAll(st.id, e.currentTarget.checked)}
                />{" "}
                All tables
              </label>
            </fieldset>
          ))}
        </footer>
      ) : null}
    </section>
  );
}

/** What the current interaction does to the data, in the simulation. */
function StepData({
  simulation,
  interaction,
}: {
  simulation: Simulation;
  interaction: Interaction;
}) {
  const s = simulation.steps[interaction.step];
  if (!s) return null;
  if (!s.ran) return <p className="journey-card-data is-skipped">Skipped: {s.skipped}</p>;
  // A step's arrow says what it decided; the writer storing it says what it wrote.
  const parts = [
    s.decision && !interaction.store ? `decides ${s.decision.outcome ?? "nothing"}` : "",
    ...s.events
      .filter((e) => e.kind !== "sent" && interaction.writes.includes(e.entry))
      .map(
        (e) =>
          `${e.kind === "created" ? "+" : "~"} ${e.entry.split(".").slice(-1)[0]}${e.tables[0] ? ` → ${e.tables[0].table}` : ""}`,
      ),
  ].filter(Boolean);
  return parts.length ? <p className="journey-card-data">{parts.join(" · ")}</p> : null;
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

/** The parsed sample whose file is named after a journey, such as samples/order-to-cash.json. */
export function matchingSample(
  samples: { path: string; text: string }[],
  journey: string,
): { sample: Record<string, unknown>; label: string } | undefined {
  const s = samples.find((x) => (x.path.split("/").pop() ?? "").startsWith(journey));
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(s.text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { sample: parsed as Record<string, unknown>, label: s.path }
      : undefined;
  } catch {
    return undefined;
  }
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

const WORKING_TREE = "";

/** The two versions the Changes tab compares: a base, and a branch or the working tree. */
function PairPicker({ changes }: { changes: ChangesControl }) {
  const { refs, pair } = changes;
  if (!refs?.branches.length) {
    // A static page compares only what it was built with.
    return pair ? (
      <span className="pair">
        <span className="pair-ref">{pair.base}</span> →{" "}
        <span className="pair-ref">{pair.head ?? "this version"}</span>
      </span>
    ) : null;
  }
  const options = (extra: string | undefined) =>
    [...(extra && !refs.branches.includes(extra) ? [extra] : []), ...refs.branches].map((b) => (
      <option key={b} value={b}>
        {b}
      </option>
    ));
  return (
    <fieldset className="pair">
      <legend>Compare</legend>
      <label>
        <span className="sr-only">Base</span>
        <select
          value={pair?.base ?? ""}
          onChange={(e) => changes.onPair({ base: e.target.value, head: pair?.head })}
          title="The version the changes are since"
        >
          {pair ? null : <option value="">Pick a base…</option>}
          {options(pair?.base)}
        </select>
      </label>
      <span aria-hidden="true">→</span>
      <label>
        <span className="sr-only">Head</span>
        <select
          value={pair?.head ?? WORKING_TREE}
          disabled={!pair}
          onChange={(e) =>
            pair && changes.onPair({ base: pair.base, head: e.target.value || undefined })
          }
          title="The version with the changes"
        >
          <option value={WORKING_TREE}>
            Working tree{refs.current ? ` (${refs.current})` : ""}
          </option>
          {options(pair?.head)}
        </select>
      </label>
    </fieldset>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="splash">
      <p>{children}</p>
    </div>
  );
}

/**
 * The samples for this model: any in a samples/ directory, and the
 * <journey>.sample.json files named after one of its journeys (a folder of
 * single-file models keeps each model's samples next to it).
 */
export function samplesFor(
  model: Model,
  samples: { path: string; text: string }[],
): { path: string; text: string }[] {
  return samples.filter((s) => {
    if (/(^|\/)samples\//.test(s.path)) return true;
    const name = s.path.split("/").pop() ?? "";
    return [...model.journeys.keys()].some((j) => name.startsWith(`${j}.`));
  });
}
