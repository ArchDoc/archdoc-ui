import {
  DataRegistry,
  fieldReferences,
  type JourneyNode,
  type Model,
  type ModelDiff,
  type Simulation,
} from "@archdoc/core/browser";
import { Background, Controls, MarkerType, ReactFlow, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type DataFocus,
  dataFocus,
  type Interaction,
  journeyInteractions,
  lineageFocus,
  type StepData,
  stepData,
} from "../graph/data.js";
import { buildDiffGraph, type DiffGraph } from "../graph/diff.js";
import { buildGraph, type Graph, journeyEdges, type ViewState } from "../graph/graph.js";
import { boundaryKey, crossingOf, type Grouping } from "../graph/groups.js";
import {
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  type Point,
  type UntangledLayout,
} from "../graph/layout.js";
import { edgeTypes, type RoutedEdge } from "./edges.js";
import {
  type CardNode,
  type Emphasis,
  nodeTypes,
  type OthersNode,
  type RowTableNode,
  type Shape,
  type TableNode,
} from "./nodes.js";

export interface CanvasProps {
  model: Model;
  view: ViewState;
  /** For a landscape: how repos, teams, or domains are boxed. */
  grouping?: Grouping | undefined;
  /** A simulation of the open journey: steps it skipped are drawn faint. */
  simulation?: Simulation | undefined;
  selected?: string | undefined;
  journey?: JourneyNode | undefined;
  /** The open journey's interactions, and the one it's at. */
  interactions: readonly Interaction[];
  at: number;
  /** Node to bring into view once it's laid out. Cleared through onCentered. */
  centerOn?: string | undefined;
  onCentered: () => void;
  onSelect: (key: string | undefined) => void;
  onToggle: (elementId: string) => void;
  /** Show or hide a datastore's tables. */
  onTables: (elementId: string) => void;
  /** Show or hide a table's fields, by qualified entry. */
  onFields: (entry: string) => void;
  /** During a journey: show an open datastore's schema or its rows. */
  onStoreView: (elementId: string, view: "erd" | "rows") => void;
  /** Bring back one folded table, or every table in a datastore. */
  onShowTable: (entry: string) => void;
  onShowAll: (elementId: string) => void;
  /** Show changes against a base model. */
  compare?: { base: Model; diff: ModelDiff } | undefined;
  /**
   * A journey to light up without opening it, such as the one hovered on the
   * Overview: its boxes and the uses between them; the rest fades.
   */
  preview?: string | undefined;
  /** How the layout runs: left to right (the default), or top to bottom. */
  direction?: "RIGHT" | "DOWN" | undefined;
  /** Facts whose code changed since they were sealed, marked on their boxes. */
  recheck?: readonly { element?: string | undefined }[] | undefined;
}

export function Canvas(props: CanvasProps) {
  const { model, view, journey, interactions, at, centerOn, compare, grouping, preview } = props;
  const interaction = journey ? interactions[at] : undefined;
  // A domain is selected from the sidebar; on the canvas it's its box.
  const selected = props.selected?.startsWith("domain:")
    ? `group:domain:${props.selected.slice(7)}`
    : props.selected;
  const overlay = useMemo<DiffGraph | undefined>(
    () => (compare ? buildDiffGraph(model, compare.base, compare.diff, view) : undefined),
    [model, view, compare],
  );
  const graph = useMemo(
    () => fitActors(model, overlay?.graph ?? buildGraph(model, view)),
    [overlay, model, view],
  );
  // `source` is the graph asked for; `graph` is it as laid out, rows possibly reordered.
  const [layout, setLayout] = useState<{ source: Graph } & UntangledLayout>();
  const flow = useReactFlow();
  const [hoverEdge, setHoverEdge] = useState<string>();
  const [hoverNode, setHoverNode] = useState<string>();
  const firstFit = useRef(true);
  const pane_ = useRef<HTMLDivElement>(null);
  const direction = props.direction ?? "RIGHT";

  useEffect(() => {
    let cancelled = false;
    // Top to bottom, as the Overview lays out, rows sit closer: more of the map fits, still readable.
    const options: Record<string, string> =
      direction === "DOWN"
        ? {
            "elk.direction": "DOWN",
            "elk.layered.spacing.nodeNodeBetweenLayers": "64",
            "elk.spacing.nodeNode": "24",
          }
        : { "elk.direction": direction };
    void layoutGraph(graph, options).then((result) => {
      if (!cancelled) setLayout({ source: graph, ...result });
    });
    return () => {
      cancelled = true;
    };
  }, [graph, direction]);

  // A journey shown without opening it: the boxes its steps go between, as drawn now.
  const previewSteps = useMemo(() => {
    const j = preview ? model.journeys.get(preview) : undefined;
    if (!j || journey) return undefined;
    return journeyEdges(model, view, j.id, journeyInteractions(model, j));
  }, [model, view, preview, journey]);

  const steps = useMemo(
    () => (journey ? journeyEdges(model, view, journey.id, interactions) : []),
    [model, view, journey, interactions],
  );
  // Interactions that go from one repo (or team, or domain) to another, and the box each enters.
  const crossings = useMemo(() => {
    const out = new Map<number, string>();
    if (!journey || !grouping) return out;
    interactions.forEach((x, i) => {
      const c = crossingOf(model, grouping, x.from, x.to);
      if (c) out.set(i, boundaryKey(grouping, c.to));
    });
    return out;
  }, [model, journey, grouping, interactions]);

  // A selected data entry (or field's lineage): where it's stored, where it travels, and its tables.
  const focus = useMemo<
    (DataFocus & { entries: string[]; fields?: Set<string> | undefined }) | undefined
  >(() => {
    if (selected?.startsWith("data:")) {
      const entry = selected.slice(5);
      return { ...dataFocus(model, view, entry), entries: [entry] };
    }
    if (selected?.startsWith("field:")) return lineageFocus(model, view, selected.slice(6));
    return undefined;
  }, [model, view, selected]);
  const fieldRefs = useMemo(() => fieldReferences(model), [model]);
  // Facts to re-check per element; a closed box counts the ones inside it too.
  const recheckOf = useMemo(() => {
    const ids = (props.recheck ?? []).flatMap((f) => (f.element ? [f.element] : []));
    return (id: string, closed: boolean) =>
      ids.filter((e) => e === id || (closed && e.startsWith(`${id}.`))).length;
  }, [props.recheck]);

  // What the current interaction carries, and the records it writes: a step's
  // arrow carries its message, and its writer storing it carries what it stores.
  const current = useMemo((): StepData | undefined => {
    if (!journey || !interaction) return undefined;
    const d = stepData(model, journey, interaction.step, props.simulation);
    const writes = d.writes.filter((w) => interaction.writes.includes(w.entry));
    if (!interaction.store) return { ...d, writes };
    const ns = `${model.namespace}.`;
    return {
      writes,
      message: {
        how: "writes",
        entries: interaction.writes.map((entry) => ({
          entry,
          label: entry.startsWith(ns) ? entry.slice(ns.length) : entry,
          fields: [],
        })),
      },
    };
  }, [model, journey, interaction, props.simulation]);

  // Tables of the focused entries, the field's own (or the entry's) first.
  const focusTables = useMemo(() => {
    const out = new Map<string, "current" | "highlight">();
    if (!focus) return out;
    for (const n of graph.nodes) {
      const i = n.kind === "table" && n.table ? focus.entries.indexOf(n.table.entry) : -1;
      if (i >= 0) out.set(n.id, i === 0 ? "current" : "highlight");
    }
    // In a big schema, the tables a selected one is linked to by foreign keys.
    if (selected?.startsWith("data:")) {
      for (const e of graph.edges) {
        if (!e.reference) continue;
        if (out.get(e.source) === "current" && !out.has(e.target)) out.set(e.target, "highlight");
        if (out.get(e.target) === "current" && !out.has(e.source)) out.set(e.source, "highlight");
      }
    }
    return out;
  }, [focus, graph, selected]);

  // In tables of rows, each line: the current step's rows, the rows they point at, the rest.
  // By the laid-out graph, whose rows may be in a new order.
  const laid = layout && layout.source === graph ? layout.graph : graph;
  const lines = useMemo(() => {
    const out = new Map<string, Emphasis[]>();
    for (const n of laid.nodes) {
      if (n.kind !== "rowtable" || !n.rows) continue;
      out.set(
        n.id,
        n.rows.map((r) => (r.isNew || r.changed.size ? "current" : "dim")),
      );
    }
    for (const e of laid.edges) {
      if (!e.rows) continue;
      const from = out.get(e.source);
      const to = out.get(e.target);
      if (!from || !to) continue;
      if (from[e.rows.from] === "current" && to[e.rows.to] === "dim") to[e.rows.to] = "highlight";
      if (to[e.rows.to] === "current" && from[e.rows.from] === "dim")
        from[e.rows.from] = "highlight";
    }
    return out;
  }, [laid]);

  const emphasis = useMemo(() => {
    const map = new Map<string, Emphasis>();
    if (focus) {
      for (const k of focus.nodes) map.set(k, "highlight");
      for (const k of focus.stores) map.set(k, "current");
      for (const [k, e] of focusTables) map.set(k, e);
      return map;
    }
    if (previewSteps) {
      for (const s of previewSteps) {
        map.set(s.source, "highlight");
        map.set(s.target, "highlight");
      }
      return map;
    }
    if (journey) {
      // Tables the current step writes to are current, and the camera goes to them; tables
      // that only store what its message carries are lit, and the camera stays on the arrow.
      const written = new Set(current?.writes.map((w) => w.entry) ?? []);
      const carried = new Set(current?.message?.entries.map((e) => e.entry) ?? []);
      for (const n of graph.nodes) {
        if (n.kind === "table" && n.table && written.has(n.table.entry)) map.set(n.id, "current");
        else if (n.kind === "table" && n.table && carried.has(n.table.entry))
          map.set(n.id, "highlight");
        // A table of rows is current when the step writes one of its rows.
        if (n.kind === "rowtable") {
          const lit = lines.get(n.id);
          map.set(
            n.id,
            lit?.includes("current") ? "current" : lit?.includes("highlight") ? "highlight" : "dim",
          );
        }
      }
      for (const s of steps) {
        const current = s.at === at;
        for (const k of [s.source, s.target]) {
          if (current) map.set(k, "current");
          else if (!map.has(k)) map.set(k, "highlight");
        }
      }
    } else if (selected) {
      map.set(selected, "current");
      // A selected box lights up what's in it: a team's or domain's elements, a datastore's tables.
      const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
      for (const n of graph.nodes) {
        for (let p = n.parentId; p; p = parent.get(p)) {
          if (p === selected) map.set(n.id, "highlight");
        }
      }
      for (const e of graph.edges) {
        if (e.source === selected) map.set(e.target, "highlight");
        if (e.target === selected) map.set(e.source, "highlight");
      }
    }
    return map;
  }, [journey, steps, at, selected, graph, focus, focusTables, current, lines, previewSteps]);
  const dimming = journey !== undefined || selected !== undefined || previewSteps !== undefined;

  const nodes = useMemo<(CardNode | TableNode | RowTableNode | OthersNode)[]>(() => {
    if (!layout) return [];
    // A table without emphasis of its own looks like the datastore it's in: at full
    // strength while the datastore is lit or selected, faded only when it is.
    const inherited = (parent: string | undefined): Emphasis => {
      const e = parent ? emphasis.get(parent) : undefined;
      return e === "current" || e === "highlight" || !dimming ? "normal" : "dim";
    };
    const shortEntry = (entry: string) =>
      entry.startsWith(`${model.namespace}.`) ? entry.slice(model.namespace.length + 1) : entry;
    const references = new Map<string, Set<string>>();
    for (const e of layout.graph.edges) {
      if (!e.reference) continue;
      references.set(e.source, (references.get(e.source) ?? new Set()).add(e.reference.field));
    }
    return layout.graph.nodes.flatMap((n): (CardNode | TableNode | RowTableNode | OthersNode)[] => {
      const box = layout.boxes.get(n.id);
      if (!box) return [];
      if (n.kind === "others" && n.folded) {
        const store = n.parentId?.slice("element:".length) ?? "";
        return [
          {
            id: n.id,
            type: "others" as const,
            position: { x: box.x, y: box.y },
            parentId: n.parentId,
            width: box.width,
            height: box.height,
            selectable: false,
            draggable: false,
            zIndex: 2,
            data: {
              tables: n.folded.map((f) => ({ ...f, label: shortEntry(f.entry) })),
              emphasis: "normal" as const,
              onShow: props.onShowTable,
              onShowAll: () => props.onShowAll(store),
            },
          },
        ];
      }
      if (n.kind === "rowtable" && n.table && n.rows) {
        const t = n.table;
        return [
          {
            id: n.id,
            type: "rowtable" as const,
            position: { x: box.x, y: box.y },
            parentId: n.parentId,
            width: box.width,
            height: box.height,
            selectable: false,
            draggable: false,
            zIndex: 2,
            data: {
              table: t,
              label: shortEntry(t.entry),
              rows: n.rows,
              columns: n.columns ?? [],
              columnWidths: n.columnWidths ?? [],
              references: new Set(fieldRefs.filter((x) => x.entry === t.entry).map((x) => x.field)),
              lines: lines.get(n.id) ?? [],
              hiddenRows: n.hiddenRows,
              emphasis: emphasis.get(n.id) ?? "normal",
            },
          },
        ];
      }
      if (n.table) {
        const t = n.table;
        const prefix = `${t.entry}.`;
        return [
          {
            id: n.id,
            type: "table" as const,
            position: { x: box.x, y: box.y },
            parentId: n.parentId,
            width: box.width,
            height: box.height,
            selectable: false,
            draggable: false,
            zIndex: 2,
            data: {
              table: t,
              label: t.entry.startsWith(`${model.namespace}.`)
                ? t.entry.slice(model.namespace.length + 1)
                : t.entry,
              emphasis: emphasis.get(n.id) ?? inherited(n.parentId),
              references: references.get(n.id) ?? new Set(),
              write: (() => {
                const w = current?.writes.find((x) => x.entry === t.entry);
                return w ? { created: w.created, values: w.values, step: at } : undefined;
              })(),
              lit: focus?.fields
                ? new Set(
                    [...focus.fields]
                      .filter((f) => f.startsWith(prefix))
                      .map((f) => f.slice(prefix.length)),
                  )
                : undefined,
              onField: (field: string) => props.onSelect(`field:${t.entry}.${field}`),
              onFields: () => props.onFields(t.entry),
            },
          },
        ];
      }
      const ghost = overlay?.ghosts.has(n.id) && compare;
      const info = describe(ghost ? compare.base : model, n.id, grouping);
      const element = n.kind === "element" ? model.elements.get(n.id.slice(8)) : undefined;
      return [
        {
          id: n.id,
          type: "card" as const,
          position: { x: box.x, y: box.y },
          parentId: n.parentId,
          width: box.width,
          height: box.height,
          selectable: false,
          draggable: false,
          zIndex: n.isGroup ? 0 : 1,
          data: {
            ...info,
            hiddenChildren: n.hiddenChildren,
            isGroup: n.isGroup,
            change: overlay?.nodes.get(n.id),
            changesInside: overlay?.inside.get(n.id),
            recheck:
              n.kind === "element" ? recheckOf(n.id.slice(8), n.hiddenChildren > 0) : undefined,
            emphasis: emphasis.get(n.id) ?? (dimming && !n.isGroup ? "dim" : "normal"),
            selected: n.id === selected,
            entered: crossings.get(at) === n.id,
            stores: focus?.stores.has(n.id),
            onToggle:
              element && element.childIds.length > 0 ? () => props.onToggle(element.id) : undefined,
            onTables:
              element && Object.keys(element.spec.stores ?? {}).length > 0
                ? () => props.onTables(element.id)
                : undefined,
            tablesOpen: element ? view.tables?.has(element.id) : undefined,
            storeView:
              journey && element && view.tables?.has(element.id)
                ? view.rows?.stores.has(element.id)
                  ? ("rows" as const)
                  : ("erd" as const)
                : undefined,
            onStoreView:
              journey && element && view.tables?.has(element.id)
                ? (v: "erd" | "rows") => props.onStoreView(element.id, v)
                : undefined,
          },
        },
      ];
    });
  }, [
    layout,
    model,
    emphasis,
    dimming,
    selected,
    props.onToggle,
    props.onTables,
    props.onFields,
    props.onSelect,
    view.tables,
    overlay,
    compare,
    grouping,
    crossings,
    at,
    focus,
    current,
    fieldRefs,
    view.rows,
    props.onStoreView,
    journey,
    lines,
    props.onShowTable,
    props.onShowAll,
    recheckOf,
  ]);

  const edges = useMemo<RoutedEdge[]>(() => {
    if (!layout) return [];
    // A journey step follows the route of the relationship between the same boxes.
    const routeBetween = new Map<string, Point[]>();
    for (const e of layout.graph.edges) {
      const points = layout.routes.get(e.id);
      if (!points) continue;
      routeBetween.set(`${e.source}->${e.target}`, points);
      if (!routeBetween.has(`${e.target}->${e.source}`)) {
        routeBetween.set(`${e.target}->${e.source}`, [...points].reverse());
      }
    }
    // Interactions that share a route spread their numbers along it, so none hides another.
    const sharing = new Map<string, number[]>();
    for (const s of steps) {
      const pair = [s.source, s.target].sort().join("|");
      sharing.set(pair, [...(sharing.get(pair) ?? []), s.at]);
    }
    // A previewed journey lights the uses its steps go along, either way.
    const previewPairs = new Set(
      (previewSteps ?? []).flatMap((s) => [`${s.source}|${s.target}`, `${s.target}|${s.source}`]),
    );
    const regular: RoutedEdge[] = layout.graph.edges.map((e) => {
      if (e.reference) {
        // Between rows: lit when either row is one the current step wrote.
        const lit = e.rows
          ? lines.get(e.source)?.[e.rows.from] === "current" ||
            lines.get(e.target)?.[e.rows.to] === "current"
          : focusTables.has(e.source) ||
            focusTables.has(e.target) ||
            emphasis.get(e.source) === "current" ||
            emphasis.get(e.target) === "current";
        return {
          id: e.id,
          type: "routed" as const,
          source: e.source,
          target: e.target,
          data: { points: layout.routes.get(e.id) },
          markerEnd: arrowHead(12, "fk"),
          className: ["fk", dimming && !lit ? "is-dim" : ""].filter(Boolean).join(" "),
          label: e.id === hoverEdge ? `${e.reference.field} → ${e.reference.to}` : undefined,
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          zIndex: 3,
        };
      }
      const touches = (k: string | undefined) =>
        k !== undefined && (e.source === k || e.target === k);
      const lit = focus
        ? focus.edges.has(e.id)
        : previewSteps
          ? previewPairs.has(`${e.source}|${e.target}`)
          : !journey && (touches(selected) || touches(hoverNode));
      // A subscription names its channel and how it travels.
      const channel = e.subscription
        ? `${e.subscription.channel}${e.subscription.transport ? ` (${e.subscription.transport})` : ""}`
        : "";
      const label = [channel, ...e.relationships.map((r) => r.description)]
        .filter(Boolean)
        .join(" · ");
      const className = [
        "rel",
        e.planned ? "is-planned" : "",
        e.relationships.length > 0 &&
        e.relationships.every((r) => r.provenance?.source === "suggested")
          ? "is-suggested"
          : "",
        overlay?.edges.get(e.id) ? `change-${overlay.edges.get(e.id)}` : "",
        e.subscription ? "is-async" : "",
        lit ? "is-lit" : "",
        // A selected message or field travels along its arrows, the way it goes.
        lit && focus ? "is-flow" : "",
        lit && focus && !focus.along.has(e.id) ? "is-flow-back" : "",
        dimming && !lit ? "is-dim" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return {
        id: e.id,
        type: "routed" as const,
        source: e.source,
        target: e.target,
        data: { points: layout.routes.get(e.id) },
        markerEnd: arrowHead(16, className),
        className,
        label: e.id === hoverEdge && label ? truncate(label, 60) : undefined,
        interactionWidth: 14,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        zIndex: lit || e.id === hoverEdge ? 5 : 2,
      };
    });
    // A step inside a collapsed group has nowhere to go; the group is still highlighted.
    const journeyOverlay: RoutedEdge[] = steps
      .filter((s) => s.source !== s.target)
      .map((s) => {
        const shared = sharing.get([s.source, s.target].sort().join("|")) ?? [s.at];
        return {
          id: `step:${s.id}`,
          type: "routed" as const,
          source: s.source,
          target: s.target,
          data: {
            points: routeBetween.get(`${s.source}->${s.target}`),
            labelAt: (shared.indexOf(s.at) + 1) / (shared.length + 1),
            packet:
              s.at === at
                ? current?.message
                  ? { label: current.message.entries.map((e) => e.label).join(", ") }
                  : { label: "no message", missing: true }
                : undefined,
          },
          markerEnd: arrowHead(18, s.at === at ? "journey is-current" : "journey"),
          className: [
            "journey",
            s.at === at ? "is-current" : "",
            crossings.has(s.at) ? "is-crossing" : "",
            props.simulation && props.simulation.steps[s.step]?.ran === false ? "is-skipped" : "",
          ]
            .filter(Boolean)
            .join(" "),
          label: s.label,
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 10,
          animated: s.at === at,
          zIndex: s.at === at ? 10 : 6,
        };
      });
    // A previewed step with no use drawn between its boxes gets a line of its own.
    const previewOverlay: RoutedEdge[] = (previewSteps ?? [])
      .filter((s, i, all) => {
        if (s.source === s.target) return false;
        // One line per pair of boxes.
        return all.findIndex((x) => x.source === s.source && x.target === s.target) === i;
      })
      .filter(
        (s) =>
          !layout.graph.edges.some(
            (e) =>
              (e.source === s.source && e.target === s.target) ||
              (e.source === s.target && e.target === s.source),
          ),
      )
      .map((s) => ({
        id: `preview:${s.id}`,
        type: "routed" as const,
        source: s.source,
        target: s.target,
        data: { points: routeBetween.get(`${s.source}->${s.target}`) },
        markerEnd: arrowHead(14, "rel is-lit"),
        className: "rel is-lit is-preview",
        zIndex: 5,
      }));
    return [...regular, ...journeyOverlay, ...previewOverlay];
  }, [
    previewSteps,
    hoverNode,
    layout,
    journey,
    steps,
    at,
    selected,
    dimming,
    hoverEdge,
    overlay,
    crossings,
    focus,
    focusTables,
    current,
    emphasis,
    lines,
    props.simulation,
  ]);

  // Fit everything on the first layout; afterwards only move when asked to.
  useEffect(() => {
    if (!layout || nodes.length === 0) return;
    if (firstFit.current) {
      firstFit.current = false;
      // Fit what fits; a big map stays readable and pans instead of shrinking its labels away.
      requestAnimationFrame(() => {
        void flow
          .fitView({ padding: 0.08, duration: 0, minZoom: READABLE, maxZoom: 1 })
          .then(() => {
            // Still too wide at a readable zoom: start from the left edge, where the map begins.
            const pane = pane_.current?.getBoundingClientRect();
            const bounds = flow.getNodesBounds(flow.getNodes());
            const { y, zoom } = flow.getViewport();
            if (pane && bounds.width * zoom > pane.width) {
              void flow.setViewport({ x: 16 - bounds.x * zoom, y, zoom });
            }
          });
      });
    }
  }, [layout, nodes.length, flow]);

  useEffect(() => {
    // Wait for the layout of the current graph, or we'd fit the old size of the node.
    if (!layout || layout.source !== graph) return;
    const target = nodes.find((n) => n.id === centerOn);
    if (!target) return;
    requestAnimationFrame(() => {
      void flow.fitView({
        nodes: [{ id: target.id }],
        duration: 450,
        padding: target.data.isGroup ? 0.15 : 0.6,
        maxZoom: 1.15,
      });
      props.onCentered();
    });
  }, [centerOn, layout, graph, nodes, flow, props.onCentered]);

  // Turning focus on or off changes what's on the canvas: show all of it.
  const lastFocus = useRef(view.focus);
  useEffect(() => {
    if (!layout || layout.source !== graph || lastFocus.current === view.focus) return;
    lastFocus.current = view.focus;
    requestAnimationFrame(
      () => void flow.fitView({ padding: 0.15, duration: 450, minZoom: READABLE, maxZoom: 1.15 }),
    );
  }, [layout, graph, view.focus, flow]);

  // Regrouping moves everything: show all of it.
  const lastBy = useRef(grouping?.by);
  useEffect(() => {
    if (!layout || layout.source !== graph || lastBy.current === grouping?.by) return;
    lastBy.current = grouping?.by;
    if (centerOn) return;
    requestAnimationFrame(
      () => void flow.fitView({ padding: 0.08, duration: 450, minZoom: READABLE, maxZoom: 1 }),
    );
  }, [layout, graph, grouping?.by, centerOn, flow]);

  // Move to a selected entry's (or field's) stores, tables, and arrows, once they're laid out.
  const focusKey = focus ? selected : undefined;
  const lastFocusKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focusKey || !focus || !layout || layout.source !== graph) return;
    if (lastFocusKey.current === focusKey) return;
    const targets = [...focusTables.keys(), ...focus.stores, ...focus.nodes].filter((id) =>
      nodes.some((n) => n.id === id),
    );
    if (!targets.length) return;
    lastFocusKey.current = focusKey;
    requestAnimationFrame(() => {
      void flow.fitView({
        nodes: targets.map((id) => ({ id })),
        duration: 700,
        padding: 0.3,
        maxZoom: 1.2,
      });
    });
  }, [focusKey, focus, focusTables, layout, graph, nodes, flow]);
  useEffect(() => {
    if (!focusKey) lastFocusKey.current = undefined;
  }, [focusKey]);

  // Keep the current journey step in view: its arrow, or the rows and tables it writes.
  const written = useMemo(
    () =>
      layout && layout.source === graph
        ? graph.nodes
            .filter(
              (n) =>
                (n.kind === "rowtable" || n.kind === "table") && emphasis.get(n.id) === "current",
            )
            .map((n) => n.id)
        : undefined,
    [layout, graph, emphasis],
  );
  useEffect(() => {
    const current = steps.find((s) => s.at === at);
    if (!current || !written) return;
    // The rows or tables themselves: the step's target may be the whole datastore around them.
    const targets = written.length ? written : [current.source, current.target];
    requestAnimationFrame(() => {
      void flow.fitView({
        nodes: targets.map((id) => ({ id })),
        duration: 450,
        padding: written.length ? 0.35 : 0.5,
        maxZoom: 1.1,
      });
    });
  }, [steps, at, flow, written]);

  return (
    <ReactFlow
      ref={pane_}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, node) => {
        if (node.type === "table") {
          return props.onSelect(`data:${(node as TableNode).data.table.entry}`);
        }
        if (!node.id.startsWith("group:")) return props.onSelect(node.id);
        // A team's box selects the team; a domain's box, the domain.
        const g = grouping?.groups.get(node.id);
        if (g?.id) props.onSelect(g.by === "team" ? `actor:${g.id}` : `domain:${g.id}`);
      }}
      onNodeDoubleClick={(_, node) => {
        if (!node.id.startsWith("element:")) return;
        const el = model.elements.get(node.id.slice(8));
        // A datastore with nothing inside opens into its tables.
        if (el && el.childIds.length === 0 && Object.keys(el.spec.stores ?? {}).length) {
          props.onTables(el.id);
        } else props.onToggle(node.id.slice(8));
      }}
      onPaneClick={() => props.onSelect(undefined)}
      onEdgeMouseEnter={(_, edge) => setHoverEdge(edge.id)}
      onEdgeMouseLeave={() => setHoverEdge(undefined)}
      onNodeMouseEnter={(_, node) => setHoverNode(node.id)}
      onNodeMouseLeave={() => setHoverNode(undefined)}
      nodesConnectable={false}
      elementsSelectable={false}
      colorMode="system"
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

/**
 * How a box reads on the map: its name, one line under it, and its shape. Kind
 * is the shape (actors are pills, datastores have a lid, what lives elsewhere
 * is dashed), not a label or a color; the kind itself is in the tooltip.
 */
export function describe(model: Model, key: string, grouping?: Grouping) {
  if (key.startsWith("group:")) {
    const g = grouping?.groups.get(key);
    return {
      family: "group" as const,
      shape: "frame" as Shape,
      label: g?.label ?? key,
      kind: g?.id
        ? g.by === "team"
          ? "team"
          : "domain"
        : g?.by === "team"
          ? "no owner"
          : "domain",
      detail: g?.detail,
      status: undefined,
    };
  }
  if (key.startsWith("actor:")) {
    const a = model.actors.get(key.slice(6));
    return {
      family: "actor" as const,
      shape: "pill" as Shape,
      label: a?.spec.name ?? a?.id ?? key,
      kind: a?.spec.kind ?? "actor",
      detail: a?.spec.segment,
      status: a?.spec.status,
      suggested: a?.spec.provenance?.source === "suggested",
    };
  }
  if (key.startsWith("element:")) {
    const e = model.elements.get(key.slice(8));
    const repo = grouping?.repos.get(key.slice(8));
    if (repo) {
      return {
        family: "element" as const,
        shape: "box" as Shape,
        label: e?.spec.name ?? repo.namespace,
        kind: "repo",
        detail: e?.spec.description,
        status: e?.spec.status,
        version: repo.version ?? repo.commit?.slice(0, 7),
      };
    }
    const kind = e?.spec.kind ?? "element";
    return {
      family: "element" as const,
      shape: (kind === "datastore" ? "store" : kind === "external" ? "dashed" : "box") as Shape,
      label: e?.spec.name ?? e?.key ?? key,
      kind,
      detail: e?.spec.technology,
      status: e?.spec.status,
      suggested: e?.spec.provenance?.source === "suggested",
    };
  }
  // Another repo's element: its name there, and the repo it's in.
  const ref = key.slice("external:".length);
  const ns = ref.split(".")[0] ?? ref;
  const other = new DataRegistry(model).models.get(ns);
  const there = other?.elements.get(ref.slice(ns.length + 1));
  return {
    family: "external" as const,
    shape: (there?.spec.kind === "datastore" ? "store" : "dashed") as Shape,
    dashed: true,
    label: there?.spec.name ?? ref.slice(ns.length + 1),
    kind: there?.spec.kind ?? "element",
    detail: other?.name ?? ns,
    status: undefined,
  };
}

/** Actors are pills as wide as their names, so a row of them takes less room. */
function fitActors(model: Model, graph: Graph): Graph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.kind !== "actor" || n.size) return n;
      const a = model.actors.get(n.id.slice(6));
      const label = a?.spec.name ?? a?.id ?? n.id;
      const width = Math.round(Math.min(NODE_WIDTH + 20, Math.max(130, label.length * 10.5 + 72)));
      return { ...n, size: { width, height: NODE_HEIGHT } };
    }),
  };
}

/** The smallest zoom the map opens at, so a box's name is still at least 13px tall. */
const READABLE = 0.75;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * An arrowhead the color of its arrow. React Flow draws heads as shared SVG
 * markers that CSS on the edge doesn't reach, so each color gets its own
 * marker. The order follows styles.css, where the later rule wins.
 */
function arrowHead(size: number, className: string) {
  const has = new Set(className.split(" "));
  const color = has.has("fk")
    ? "var(--line-strong)"
    : has.has("journey")
      ? has.has("is-current")
        ? "var(--accent)"
        : "var(--muted)"
      : has.has("is-flow")
        ? "var(--accent)"
        : has.has("change-removed")
          ? "var(--removed)"
          : has.has("change-changed")
            ? "var(--changed)"
            : has.has("change-added")
              ? "var(--added)"
              : has.has("is-lit")
                ? "var(--accent)"
                : "var(--edge)";
  return { type: MarkerType.ArrowClosed, width: size, height: size, color };
}
