import {
  DataRegistry,
  formatDiagnostic,
  type JourneyNode,
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
import { Lanes } from "./components/Lanes.js";
import { Overview } from "./components/Overview.js";
import type { PayloadEntry } from "./components/Payload.js";
import { ChangesList, DataList, dataGroups, JourneyList, SearchBox } from "./components/Sidebar.js";
import { type SampleChoice, StepPanel } from "./components/StepPanel.js";
import { TraceList, TraceStepPanel, TraceStory } from "./components/Traces.js";
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
import { type GroupBy, type Grouping, groupLandscape } from "./graph/groups.js";
import { type Compare, compareModels } from "./model/compare.js";
import { matchingSample, parseSample, sampleName, samplesFor } from "./model/samples.js";
import { journeyLanes, journeysByImportance } from "./model/stories.js";
import { firstCause, readTraces } from "./model/traces.js";
import {
  type HashState,
  type Pair,
  type Refs,
  readHash,
  type Tab,
  useCompared,
  useRefs,
  writeHash,
} from "./model/useCompare.js";
import { type LandscapeInfo, type RepoLinks, type SealsInfo, useModel } from "./model/useModel.js";

export function App() {
  const state = useModel();
  const refs = useRefs();
  const [initial] = useState<HashState>(() => readHash());
  const [tab, setTab] = useState<Tab>(initial.tab ?? "overview");
  const [chosen, setChosen] = useState<Pair | undefined>(initial.pair);
  const preset = state.status === "ready" ? state.base : undefined;
  // `archdoc view --base` picks the base until someone picks another.
  const presetRef = preset?.ref ?? refs?.base;
  const pair = useMemo<Pair | undefined>(
    () => chosen ?? (presetRef ? { base: presetRef } : undefined),
    [chosen, presetRef],
  );
  const compared = useCompared(pair, preset);
  // A branch replaces the working tree while the Changes tab shows it: its model, files, and samples.
  const branch = tab === "changes" && compared.status === "ready" ? compared.head : undefined;
  const shown = branch ?? (state.status === "ready" ? state : undefined);
  const samples = useMemo(() => (shown ? samplesFor(shown.model, shown.samples) : []), [shown]);
  const headModel =
    compared.status === "ready"
      ? (compared.head ?? (state.status === "ready" ? state : undefined))?.model
      : undefined;
  const compare = useMemo<Compare | undefined>(() => {
    if (!pair || compared.status !== "ready" || !headModel) return undefined;
    // Both revisions read the same way, with what the server found in the code.
    return compareModels(pair.base, compared.base, pair.head, headModel, compared.change);
  }, [pair, compared, headModel]);

  if (state.status === "loading") return <Splash>Loading the model…</Splash>;
  if (state.status === "error" || !shown) {
    return (
      <Splash>
        <strong>Couldn't load the model.</strong> {state.status === "error" ? state.message : ""}
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
        model={shown.model}
        watch={state.watch}
        reloads={state.reloads}
        files={shown.files}
        snippets={shown.snippets}
        repo={shown.repo}
        tab={
          (tab === "changes" && !changes) || (tab === "traces" && !shown.traces.length)
            ? "overview"
            : tab
        }
        onTab={setTab}
        initial={initial}
        pair={chosen}
        changes={changes}
        landscape={state.landscape}
        samples={samples}
        traces={shown.traces}
        seals={branch ? undefined : state.seals}
      />
    </ReactFlowProvider>
  );
}

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
  /** What the address asked for when the page opened. */
  initial: HashState;
  /** The pair someone picked, for the address. */
  pair?: Pair | undefined;
  changes?: ChangesControl | undefined;
  landscape?: LandscapeInfo | undefined;
  samples: { path: string; text: string }[];
  /** Trace files beside the model. */
  traces: { path: string; text: string }[];
  /** The working tree's facts to re-check, when the repository keeps an archdoc.sum. */
  seals?: SealsInfo | undefined;
}

const EXAMPLE = "";

function Explorer({
  model,
  watch,
  reloads,
  files,
  snippets,
  repo,
  tab,
  onTab,
  initial,
  pair,
  changes,
  landscape,
  samples,
  traces,
  seals,
}: ExplorerProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("repo");
  // What the open journey runs on: example data ("") or a sample's path, so it reruns when the model reloads.
  const [sample, setSample] = useState<{ journey: string; key: string }>();
  // Boxes opened by hand, and boxes closed by hand that something else opened (by context).
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(model));
  const [closed, setClosed] = useState<{ context: string; ids: ReadonlySet<string> }>();
  // Datastores opened to show their tables, and those showing a journey's rows instead.
  const [tables, setTables] = useState<ReadonlySet<string>>(() => new Set());
  const [rowStores, setRowStores] = useState<ReadonlySet<string>>(() => new Set());
  // Tables showing their fields, by qualified entry; the rest show only their names.
  const [openFields, setOpenFields] = useState<ReadonlySet<string>>(() => new Set());
  // During a journey, datastores showing every table, and tables brought back one at a time.
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());
  const [extra, setExtra] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string | undefined>(initial.data);
  const [focused, setFocused] = useState(false);
  const [journeyId, setJourneyId] = useState<string | undefined>(initial.journey);
  // The interaction the journey is at: a step's arrow, or its writer storing what it wrote.
  const [at, setAt] = useState(0);
  const [onMap, setOnMap] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [centerOn, setCenterOn] = useState<string>();
  const [panelWidth, setPanelWidth] = usePanelWidth();
  const search = useRef<HTMLInputElement>(null);
  // The open trace, and the hop selected in it.
  const [traceId, setTraceId] = useState<string | undefined>(initial.trace);
  const [traceAt, setTraceAt] = useState<number>();
  const traceState = useMemo(() => readTraces(model, traces, files), [model, traces, files]);
  const traceCheck = traceState.checks.find((c) => c.view.id === traceId) ?? traceState.checks[0];
  const traceStep = traceCheck
    ? Math.min(traceAt ?? firstCause(traceCheck.view), traceCheck.view.steps.length - 1)
    : 0;
  const openTrace = useCallback(
    (id: string) => {
      onTab("traces");
      setSelected(undefined);
      setTraceId(id);
      setTraceAt(undefined);
    },
    [onTab],
  );

  const journey = journeyId ? model.journeys.get(journeyId) : undefined;
  const interactions = useMemo(
    () => (journey ? journeyInteractions(model, journey) : []),
    [model, journey],
  );
  const interaction: Interaction | undefined = interactions[at];
  const run = useMemo(() => {
    if (!journey) return undefined;
    const key = sample?.journey === journey.id ? sample.key : defaultSample(samples, journey.id);
    const file = samples.find((s) => s.path === key);
    const records = file ? parseSample(file) : undefined;
    return {
      key: records ? key : EXAMPLE,
      records: records ?? sampleSkeleton(model, journey),
    };
  }, [journey, sample, samples, model]);
  const simulation = useMemo<Simulation | undefined>(
    () => (journey && run ? simulate(model, journey.id, run.records) : undefined),
    [model, journey, run],
  );
  // The map shows what changed only on the Changes tab.
  const compare = tab === "changes" ? changes?.compare : undefined;
  const code = useMemo(
    () => ({ codemap: resolveCodeMap(model, files), repo, files: new Set(files), snippets }),
    [model, files, repo, snippets],
  );
  const journeyOnMap = tab === "journeys" && onMap && journey ? journey : undefined;

  useEffect(
    () =>
      writeHash({
        tab,
        pair,
        journey: tab === "journeys" ? journeyId : undefined,
        trace: tab === "traces" ? traceCheck?.view.id : undefined,
        data:
          tab === "data" && (selected?.startsWith("data:") || selected?.startsWith("field:"))
            ? selected
            : undefined,
      }),
    [tab, pair, journeyId, selected, traceCheck],
  );

  // After a live reload, drop references to things that no longer exist.
  useEffect(() => {
    setExpanded((prev) => new Set([...prev].filter((id) => model.elements.has(id))));
    setTables((prev) => new Set([...prev].filter((id) => model.elements.has(id))));
    setSelected((prev) => (prev && exists(model, prev, landscape) ? prev : undefined));
    setJourneyId((prev) => (prev && model.journeys.has(prev) ? prev : undefined));
  }, [model, landscape]);

  // The Journeys tab always has a journey open: the most important one, to start.
  useEffect(() => {
    if (tab !== "journeys" || journeyId) return;
    const first = journeysByImportance(model)[0];
    if (first) setJourneyId(first.id);
  }, [tab, journeyId, model]);
  useEffect(() => {
    if (at >= interactions.length && interactions.length) setAt(0);
  }, [at, interactions.length]);

  const grouping = useMemo<Grouping | undefined>(
    () => (landscape ? groupLandscape(model, landscape, groupBy) : undefined),
    [model, landscape, groupBy],
  );

  // What opens on its own: a journey's boxes and stores on the map, a data entry's places.
  const context = journeyOnMap
    ? `journey:${journeyOnMap.id}`
    : tab === "data" && selected
      ? selected
      : "";
  const auto = useMemo(() => {
    const out = {
      expanded: new Set<string>(),
      tables: new Set<string>(),
      fields: new Set<string>(),
    };
    if (journeyOnMap) {
      const stores = journeyStores(model, journeyOnMap);
      for (const id of journeyExpansion(model, journeyOnMap)) out.expanded.add(id);
      for (const id of stores.flatMap((s) => ancestorsOf(model, s))) out.expanded.add(id);
      for (const id of stores) out.tables.add(id);
    } else if (
      tab === "data" &&
      (selected?.startsWith("data:") || selected?.startsWith("field:"))
    ) {
      // Open what the data goes through: the boxes it travels between, and its stores' tables.
      const entries = selected.startsWith("data:")
        ? [selected.slice(5)]
        : (lineageEntries(model, selected.slice(6)) ?? []);
      const places = entries.map((e) => dataPlaces(model, e));
      const stores = places.flatMap((p) => p.stores);
      for (const id of [...stores, ...places.flatMap((p) => p.ends)].flatMap((id) =>
        ancestorsOf(model, id),
      ))
        out.expanded.add(id);
      for (const id of stores) out.tables.add(id);
      // A field's lineage lights up fields: open the tables it goes through.
      if (selected.startsWith("field:")) for (const e of entries) out.fields.add(e);
    }
    return out;
  }, [model, journeyOnMap, tab, selected]);
  const shut = closed?.context === context ? closed.ids : undefined;
  const effective = useMemo(() => {
    const merge = (mine: ReadonlySet<string>, theirs: ReadonlySet<string>, prefix: string) =>
      new Set([...mine, ...theirs].filter((id) => !shut?.has(`${prefix}${id}`)));
    return {
      expanded: merge(expanded, auto.expanded, "e:"),
      tables: merge(tables, auto.tables, "t:"),
      fields: new Set([...openFields, ...auto.fields]),
    };
  }, [expanded, tables, openFields, auto, shut]);

  // The rows the journey has at the current step, for stores showing rows.
  const rows = useMemo(
    () =>
      journeyOnMap && rowStores.size
        ? interactionRows(model, journeyOnMap, interactions, at, simulation)
        : undefined,
    [model, journeyOnMap, interactions, at, simulation, rowStores],
  );
  // What the journey uses; the rest of its datastores folds away.
  const involved = useMemo(
    () => (journeyOnMap ? journeyInvolvement(model, journeyOnMap, rows) : undefined),
    [model, journeyOnMap, rows],
  );
  const view = useMemo(
    () => ({
      expanded: effective.expanded,
      focus: focused && !journeyOnMap ? selected : undefined,
      grouping,
      tables: effective.tables,
      openFields: effective.fields,
      rows: rows && { stores: rowStores, data: rows },
      involved,
      showAll,
      extra,
    }),
    [
      effective,
      focused,
      journeyOnMap,
      selected,
      grouping,
      rows,
      rowStores,
      involved,
      showAll,
      extra,
    ],
  );

  const openJourney = useCallback(
    (id: string) => {
      if (!model.journeys.has(id)) return;
      onTab("journeys");
      setSelected(undefined);
      setFocused(false);
      setJourneyId(id);
      setAt(0);
      setShowAll(new Set());
      setExtra(new Set());
    },
    [model, onTab],
  );

  const select = useCallback(
    (key: string | undefined) => {
      setSelected(key);
      if (!key) {
        setFocused(false);
        return;
      }
      if (key.startsWith("journey:")) {
        setSelected(undefined);
        openJourney(key.slice(8));
        return;
      }
      if (key.startsWith("data:") || key.startsWith("field:")) {
        if (tab !== "data") onTab("data");
        return;
      }
      if (key.startsWith("element:")) {
        const hidden = ancestorsOf(model, key.slice(8));
        setExpanded((prev) =>
          hidden.every((a) => prev.has(a)) ? prev : new Set([...prev, ...hidden]),
        );
      }
      if (key.startsWith("domain:")) {
        // A domain is a box only when grouping by domain.
        setGroupBy("domain");
        setCenterOn(`group:domain:${key.slice(7)}`);
        return;
      }
      setCenterOn(key);
    },
    [model, tab, onTab, openJourney],
  );

  // A box clicked on the map is already in view: select it without moving the map.
  const selectHere = useCallback(
    (key: string | undefined) => {
      if (
        key?.startsWith("element:") ||
        key?.startsWith("actor:") ||
        key?.startsWith("external:")
      ) {
        setSelected(key);
        return;
      }
      select(key);
    },
    [select],
  );

  const pick = useCallback(
    (key: string) => {
      // Search: a box on the Journeys tab is shown on the Overview's map.
      if ((tab === "journeys" || tab === "traces") && /^(element|actor|domain):/.test(key))
        onTab("overview");
      select(key);
    },
    [tab, onTab, select],
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

  /** Opens or closes a box, or a datastore's tables, whoever opened it. */
  const flip = useCallback(
    (prefix: "e:" | "t:", id: string) => {
      const open = (prefix === "e:" ? effective.expanded : effective.tables).has(id);
      const change = (prev: ReadonlySet<string>) => {
        const next = new Set(prev);
        if (open) next.delete(id);
        else next.add(id);
        return next;
      };
      if (prefix === "e:") setExpanded(change);
      else setTables(change);
      setClosed((prev) => {
        const ids = new Set(prev?.context === context ? prev.ids : []);
        if (open) ids.add(`${prefix}${id}`);
        else ids.delete(`${prefix}${id}`);
        return { context, ids };
      });
      // Bring the opened (or closed) element into view once it's laid out again.
      setCenterOn(`element:${id}`);
    },
    [effective, context],
  );
  const toggle = useCallback((id: string) => flip("e:", id), [flip]);
  const toggleTables = useCallback((id: string) => flip("t:", id), [flip]);
  const toggleFields = useCallback((entry: string) => {
    setOpenFields((prev) => {
      const next = new Set(prev);
      if (next.has(entry)) next.delete(entry);
      else next.add(entry);
      return next;
    });
  }, []);

  const count = interactions.length;
  const go = useCallback((n: number) => setAt(Math.max(0, Math.min(count - 1, n))), [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      } else if (!typing && e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (!typing && e.key === "Escape") {
        select(undefined);
      } else if (!typing && tab === "journeys" && journey && e.key === "ArrowRight") {
        go(at + 1);
      } else if (!typing && tab === "journeys" && journey && e.key === "ArrowLeft") {
        go(at - 1);
      } else if (!typing && tab === "traces" && traceCheck && /^Arrow(Right|Left)$/.test(e.key)) {
        const last = traceCheck.view.steps.length - 1;
        setTraceAt(Math.max(0, Math.min(last, traceStep + (e.key === "ArrowRight" ? 1 : -1))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, journey, at, go, select, traceCheck, traceStep]);

  const lanes = useMemo(
    () => (journey ? journeyLanes(model, journey, interactions, landscape) : undefined),
    [model, journey, interactions, landscape],
  );
  const payload = useMemo(
    () => (journey && interaction ? payloadOf(model, journey, interaction, simulation) : []),
    [model, journey, interaction, simulation],
  );
  const sampleChoices = useMemo<SampleChoice[]>(
    () => [
      { key: EXAMPLE, label: "Example data", title: "Example values for each field, by its type" },
      ...samples
        .filter((s) => parseSample(s) !== undefined)
        .map((s) => ({ key: s.path, label: sampleName(s.path), title: s.path })),
    ],
    [samples],
  );
  const journeyStoreIds = useMemo(
    () =>
      journeyOnMap
        ? journeyStores(model, journeyOnMap).filter((id) => effective.tables.has(id))
        : [],
    [model, journeyOnMap, effective.tables],
  );
  const hasData = useMemo(() => dataGroups(model).length > 0, [model]);
  const errors = model.diagnostics.filter((d) => d.severity === "error");
  const warnings = model.diagnostics.filter((d) => d.severity === "warning");

  const details = selected ? (
    <Details
      model={model}
      selected={selected}
      focused={focused}
      expanded={effective.expanded}
      onSelect={select}
      onJourney={openJourney}
      onFocus={setFocused}
      onToggle={toggle}
      code={code}
      compare={compare}
      landscape={landscape}
      recheck={seals?.facts}
    />
  ) : null;
  const canvas = (
    <Canvas
      key={tab}
      model={model}
      grouping={grouping}
      simulation={journeyOnMap ? simulation : undefined}
      view={view}
      selected={selected}
      journey={journeyOnMap}
      interactions={journeyOnMap ? interactions : []}
      at={at}
      centerOn={centerOn}
      onCentered={() => setCenterOn(undefined)}
      onSelect={selectHere}
      onToggle={toggle}
      onTables={toggleTables}
      onFields={toggleFields}
      onStoreView={storeView}
      onShowTable={(entry) => setExtra((prev) => new Set([...prev, entry]))}
      onShowAll={(id) => setShowAll((prev) => new Set([...prev, id]))}
      compare={compare}
      preview={tab === "overview" ? preview : undefined}
      recheck={seals?.facts}
      direction={journeyOnMap ? "RIGHT" : "DOWN"}
    />
  );

  let side: React.ReactNode;
  let main: React.ReactNode = canvas;
  let panel: React.ReactNode = details;
  if (tab === "overview") {
    side = (
      <Overview
        model={model}
        landscape={landscape}
        affected={changes?.compare?.journeys}
        seals={seals}
        onJourney={openJourney}
        onPreview={setPreview}
        onSelect={select}
      />
    );
  } else if (tab === "journeys") {
    side = (
      <JourneyList
        model={model}
        journeyId={journeyId}
        onJourney={openJourney}
        affected={changes?.compare?.journeys}
        landscape={landscape}
      />
    );
    main = journey ? (
      <section className="story" aria-label="Journey">
        <header className="story-head">
          <div className="story-title">
            <h1>{journey.spec.goal || journey.spec.name || journey.id}</h1>
            <p className="muted">
              {journey.spec.name ?? journey.id} ·{" "}
              {model.actors.get(journey.spec.actor)?.spec.name ?? journey.spec.actor} ·{" "}
              <span className={`importance importance-${journey.spec.importance ?? "normal"}`}>
                {journey.spec.importance ?? "normal"}
              </span>
            </p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={onMap}
              onChange={(e) => setOnMap(e.currentTarget.checked)}
            />{" "}
            Show on map
          </label>
        </header>
        <div className="story-body">
          {onMap ? (
            canvas
          ) : lanes ? (
            <Lanes data={lanes} at={at} onAt={go} simulation={simulation} />
          ) : null}
        </div>
      </section>
    ) : (
      <p className="empty-main">No journeys yet. A journey says how an actor reaches a goal.</p>
    );
    panel =
      details && selected ? (
        <>
          <button type="button" className="link back" onClick={() => select(undefined)}>
            ← Back to the step
          </button>
          {details}
        </>
      ) : journey ? (
        <StepPanel
          model={model}
          journey={journey}
          interactions={interactions}
          at={at}
          onAt={go}
          payload={payload}
          simulation={simulation}
          samples={sampleChoices}
          sample={run?.key}
          onSample={(key) => setSample({ journey: journey.id, key })}
          code={code}
          landscape={landscape}
          onSelect={select}
          stores={
            journeyOnMap
              ? journeyStoreIds.map((id) => ({
                  id,
                  name: model.elements.get(id)?.spec.name ?? id,
                  view: rowStores.has(id) ? ("rows" as const) : ("erd" as const),
                  all: showAll.has(id),
                }))
              : undefined
          }
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
      ) : null;
  } else if (tab === "traces") {
    side = (
      <TraceList
        checks={traceState.checks}
        problems={traceState.problems}
        traceId={traceCheck?.view.id}
        onTrace={openTrace}
      />
    );
    main = traceCheck ? (
      <TraceStory
        model={model}
        check={traceCheck}
        at={traceStep}
        onAt={setTraceAt}
        landscape={landscape}
      />
    ) : (
      <p className="empty-main">The traces here couldn't be read.</p>
    );
    panel =
      details && selected ? (
        <>
          <button type="button" className="link back" onClick={() => select(undefined)}>
            ← Back to the trace
          </button>
          {details}
        </>
      ) : traceCheck ? (
        <TraceStepPanel
          model={model}
          check={traceCheck}
          at={traceStep}
          onAt={setTraceAt}
          code={code}
        />
      ) : null;
  } else if (tab === "data") {
    side = <DataList model={model} selected={selected} onSelect={select} />;
    panel = details ?? (
      <div className="details">
        <p className="lede">
          Pick an entry to see its fields, where it's stored, and where it goes. Pick a field to
          follow its value from table to table.
        </p>
      </div>
    );
  } else {
    side = (
      <ChangesList
        compare={changes?.compare}
        note={changes?.note}
        selected={selected}
        journeyId={journeyId}
        onSelect={select}
        onJourney={openJourney}
      />
    );
  }

  const tabs: { id: Tab; label: string; title?: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "journeys", label: "Journeys" },
    ...(traces.length
      ? [
          {
            id: "traces" as const,
            label: "Traces",
            title: "Bugs followed through the system: the path a failing request took",
          },
        ]
      : []),
    ...(hasData ? [{ id: "data" as const, label: "Data" }] : []),
    ...(changes
      ? [
          {
            id: "changes" as const,
            label: "Changes",
            title: changes.pair
              ? `What changes ${changes.pair.head ?? "the working tree"} makes to the model since ${changes.pair.base}`
              : "Compare the model on two branches",
          },
        ]
      : []),
  ];

  return (
    <div
      className={`app tab-${tab}${panel ? " has-panel" : ""}`}
      style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}
    >
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={20} height={20} />
          <span className="brand-name">ArchDoc</span>
          <span className="model-name">{landscape?.name ?? model.name ?? model.namespace}</span>
        </div>
        <div className="tabs" role="tablist" aria-label="View">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              title={t.title}
            >
              {t.label}
              {t.id === "changes" && changes?.compare ? (
                <span
                  className={`tab-count${changes.compare.summary.blocking.length ? " has-breaks" : ""}`}
                >
                  {changes.compare.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="topbar-right">
          {landscape && tab !== "journeys" ? (
            <fieldset className="segmented" aria-label="Group the landscape by">
              <legend>Group by</legend>
              {(["repo", "team", "domain"] as const).map((by) => (
                <button
                  key={by}
                  type="button"
                  className={groupBy === by ? "is-on" : undefined}
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
          <SearchBox ref={search} model={model} onPick={pick} />
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

      <aside className="side" aria-label={tab === "overview" ? "Overview" : "List"}>
        {side}
      </aside>
      <main className="main" aria-label={tab === "journeys" ? "Journey" : "Map"}>
        {main}
      </main>
      {panel ? (
        <aside className="panel" aria-label="Details">
          <ResizeHandle width={panelWidth} onResize={setPanelWidth} />
          {selected && tab !== "journeys" && tab !== "traces" ? (
            <button
              type="button"
              className="panel-close"
              aria-label="Close the details"
              title="Close"
              onClick={() => select(undefined)}
            >
              ×
            </button>
          ) : null}
          {panel}
        </aside>
      ) : null}
    </div>
  );
}

/** The sample a journey runs on first: one named after it, else example data. */
function defaultSample(samples: { path: string; text: string }[], journey: string): string {
  return matchingSample(samples, journey)?.path ?? EXAMPLE;
}

/** What an interaction carries, or for a writer storing it, what it writes: with the simulated records. */
function payloadOf(
  model: Model,
  journey: JourneyNode,
  x: Interaction,
  simulation: Simulation | undefined,
): PayloadEntry[] {
  const d = stepData(model, journey, x.step, simulation);
  if (!x.store) return d.message?.entries ?? [];
  const registry = new DataRegistry(model);
  const ns = `${model.namespace}.`;
  return d.writes
    .filter((w) => x.writes.includes(w.entry))
    .map((w) => {
      const node = registry.entry(w.entry)?.node;
      return {
        entry: w.entry,
        label: w.entry.startsWith(ns) ? w.entry.slice(ns.length) : w.entry,
        kind: node?.spec.kind,
        fields: Object.entries(node?.spec.fields ?? {}).map(([name, f]) => ({
          name,
          type: f.type,
          classification: f.classification,
        })),
        record: w.record,
        changed: new Set(w.values.keys()),
      };
    });
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
    return 380;
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
