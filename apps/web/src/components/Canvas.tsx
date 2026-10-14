import {
  fieldReferences,
  type JourneyNode,
  type Model,
  type ModelDiff,
  type Simulation,
} from "@archdoc/core/browser";
import { Background, Controls, MarkerType, MiniMap, ReactFlow, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type DataFocus, dataFocus, lineageFocus, stepData } from "../graph/data.js";
import { buildDiffGraph, type DiffGraph } from "../graph/diff.js";
import { buildGraph, type Graph, journeyEdges, type ViewState } from "../graph/graph.js";
import { boundaryKey, crossingOf, type Grouping } from "../graph/groups.js";
import { layoutGraph, type Point, type UntangledLayout } from "../graph/layout.js";
import { edgeTypes, type RoutedEdge } from "./edges.js";
import {
  type CardNode,
  type Emphasis,
  nodeTypes,
  type OthersNode,
  type RowTableNode,
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
  step: number;
  /** Node to bring into view once it's laid out. Cleared through onCentered. */
  centerOn?: string | undefined;
  onCentered: () => void;
  onSelect: (key: string | undefined) => void;
  onToggle: (elementId: string) => void;
  /** Show or hide a datastore's tables. */
  onTables: (elementId: string) => void;
  /** During a journey: show an open datastore's schema or its rows. */
  onStoreView: (elementId: string, view: "erd" | "rows") => void;
  /** Bring back one folded table, or every table in a datastore. */
  onShowTable: (entry: string) => void;
  onShowAll: (elementId: string) => void;
  /** Show changes against a base model. */
  compare?: { base: Model; diff: ModelDiff } | undefined;
}

export function Canvas(props: CanvasProps) {
  const { model, view, journey, step, centerOn, compare, grouping } = props;
  // A domain is selected from the sidebar; on the canvas it's its box.
  const selected = props.selected?.startsWith("domain:")
    ? `group:domain:${props.selected.slice(7)}`
    : props.selected;
  const overlay = useMemo<DiffGraph | undefined>(
    () => (compare ? buildDiffGraph(model, compare.base, compare.diff, view) : undefined),
    [model, view, compare],
  );
  const graph = useMemo(() => overlay?.graph ?? buildGraph(model, view), [overlay, model, view]);
  // `source` is the graph asked for; `graph` is it as laid out, rows possibly reordered.
  const [layout, setLayout] = useState<{ source: Graph } & UntangledLayout>();
  const flow = useReactFlow();
  const [hoverEdge, setHoverEdge] = useState<string>();
  const firstFit = useRef(true);

  useEffect(() => {
    let cancelled = false;
    void layoutGraph(graph).then((result) => {
      if (!cancelled) setLayout({ source: graph, ...result });
    });
    return () => {
      cancelled = true;
    };
  }, [graph]);

  const steps = useMemo(
    () => (journey ? journeyEdges(model, view, journey) : []),
    [model, view, journey],
  );
  // Steps that go from one repo (or team, or domain) to another, and the box each one enters.
  const crossings = useMemo(() => {
    const out = new Map<number, string>();
    if (!journey || !grouping) return out;
    for (const s of journey.steps) {
      const c = s.from && s.to ? crossingOf(model, grouping, s.from, s.to) : undefined;
      if (c) out.set(s.index, boundaryKey(grouping, c.to));
    }
    return out;
  }, [model, journey, grouping]);

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

  // What the current journey step sends, and the records it writes.
  const current = useMemo(
    () => (journey ? stepData(model, journey, step, props.simulation) : undefined),
    [model, journey, step, props.simulation],
  );

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
    if (journey) {
      // Tables the current step writes to, or the message it carries is stored in.
      const touched = new Set([
        ...(current?.writes.map((w) => w.entry) ?? []),
        ...(current?.message?.entries.map((e) => e.entry) ?? []),
      ]);
      for (const n of graph.nodes) {
        if (n.kind === "table" && n.table && touched.has(n.table.entry)) map.set(n.id, "current");
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
        const current = s.step === step;
        for (const k of [s.source, s.target]) {
          if (current) map.set(k, "current");
          else if (!map.has(k)) map.set(k, "highlight");
        }
      }
    } else if (selected) {
      map.set(selected, "current");
      if (selected.startsWith("group:")) {
        // A selected team or domain lights up what's in it.
        const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
        for (const n of graph.nodes) {
          for (let p = n.parentId; p; p = parent.get(p)) {
            if (p === selected) map.set(n.id, "highlight");
          }
        }
      }
      for (const e of graph.edges) {
        if (e.source === selected) map.set(e.target, "highlight");
        if (e.target === selected) map.set(e.source, "highlight");
      }
    }
    return map;
  }, [journey, steps, step, selected, graph, focus, focusTables, current, lines]);
  const dimming = journey !== undefined || selected !== undefined;

  const nodes = useMemo<(CardNode | TableNode | RowTableNode | OthersNode)[]>(() => {
    if (!layout) return [];
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
              emphasis: emphasis.get(n.id) ?? (dimming ? "dim" : "normal"),
              references: references.get(n.id) ?? new Set(),
              write: (() => {
                const w = current?.writes.find((x) => x.entry === t.entry);
                return w ? { created: w.created, values: w.values, step } : undefined;
              })(),
              lit: focus?.fields
                ? new Set(
                    [...focus.fields]
                      .filter((f) => f.startsWith(prefix))
                      .map((f) => f.slice(prefix.length)),
                  )
                : undefined,
              onField: (field: string) => props.onSelect(`field:${t.entry}.${field}`),
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
            containsChanges: overlay?.containsChanges.has(n.id),
            emphasis: emphasis.get(n.id) ?? (dimming && !n.isGroup ? "dim" : "normal"),
            selected: n.id === selected,
            entered: crossings.get(step) === n.id,
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
    props.onSelect,
    view.tables,
    overlay,
    compare,
    grouping,
    crossings,
    step,
    focus,
    current,
    fieldRefs,
    view.rows,
    props.onStoreView,
    journey,
    lines,
    props.onShowTable,
    props.onShowAll,
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
    // Steps that share a route spread their numbers along it, so none hides another.
    const sharing = new Map<string, number[]>();
    for (const s of steps) {
      const pair = [s.source, s.target].sort().join("|");
      sharing.set(pair, [...(sharing.get(pair) ?? []), s.step]);
    }
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
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          className: ["fk", dimming && !lit ? "is-dim" : ""].filter(Boolean).join(" "),
          label: e.id === hoverEdge ? `${e.reference.field} → ${e.reference.to}` : undefined,
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          zIndex: 3,
        };
      }
      const lit = focus
        ? focus.edges.has(e.id)
        : !journey && selected !== undefined && (e.source === selected || e.target === selected);
      const label = e.relationships
        .map((r) => r.description)
        .filter(Boolean)
        .join(" · ");
      return {
        id: e.id,
        type: "routed" as const,
        source: e.source,
        target: e.target,
        data: { points: layout.routes.get(e.id) },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: [
          "rel",
          e.planned ? "is-planned" : "",
          e.relationships.length > 0 &&
          e.relationships.every((r) => r.provenance?.source === "suggested")
            ? "is-suggested"
            : "",
          overlay?.edges.get(e.id) ? `change-${overlay.edges.get(e.id)}` : "",
          lit ? "is-lit" : "",
          // A selected message or field travels along its arrows.
          lit && focus ? "is-flow" : "",
          dimming && !lit ? "is-dim" : "",
        ]
          .filter(Boolean)
          .join(" "),
        label: e.id === hoverEdge && label ? truncate(label, 60) : undefined,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        zIndex: lit || e.id === hoverEdge ? 5 : 2,
      };
    });
    // A step inside a collapsed group has nowhere to go; the group is still highlighted.
    const journeyOverlay: RoutedEdge[] = steps
      .filter((s) => s.source !== s.target)
      .map((s) => {
        const shared = sharing.get([s.source, s.target].sort().join("|")) ?? [s.step];
        return {
          id: `step:${s.id}`,
          type: "routed" as const,
          source: s.source,
          target: s.target,
          data: {
            points: routeBetween.get(`${s.source}->${s.target}`),
            labelAt: (shared.indexOf(s.step) + 1) / (shared.length + 1),
            packet:
              s.step === step
                ? current?.message
                  ? { label: current.message.entries.map((e) => e.label).join(", ") }
                  : { label: "no message", missing: true }
                : undefined,
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          className: [
            "journey",
            s.step === step ? "is-current" : "",
            crossings.has(s.step) ? "is-crossing" : "",
            props.simulation && props.simulation.steps[s.step]?.ran === false ? "is-skipped" : "",
          ]
            .filter(Boolean)
            .join(" "),
          label: String(s.step + 1),
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 10,
          animated: s.step === step,
          zIndex: s.step === step ? 10 : 6,
        };
      });
    return [...regular, ...journeyOverlay];
  }, [
    layout,
    journey,
    steps,
    step,
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
      requestAnimationFrame(() => void flow.fitView({ padding: 0.12, duration: 0 }));
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
    requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 450, maxZoom: 1.15 }));
  }, [layout, graph, view.focus, flow]);

  // Regrouping moves everything: show all of it.
  const lastBy = useRef(grouping?.by);
  useEffect(() => {
    if (!layout || layout.source !== graph || lastBy.current === grouping?.by) return;
    lastBy.current = grouping?.by;
    if (centerOn) return;
    requestAnimationFrame(() => void flow.fitView({ padding: 0.12, duration: 450 }));
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
    const current = steps.find((s) => s.step === step);
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
  }, [steps, step, flow, written]);

  return (
    <ReactFlow
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
      nodesConnectable={false}
      elementsSelectable={false}
      colorMode="system"
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable position="bottom-right" className="minimap" />
    </ReactFlow>
  );
}

/** Label, kind, and secondary line for a node key. */
export function describe(model: Model, key: string, grouping?: Grouping) {
  if (key.startsWith("group:")) {
    const g = grouping?.groups.get(key);
    return {
      family: "group" as const,
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
      label: a?.spec.name ?? a?.id ?? key,
      kind: a?.spec.kind ?? "actor",
      detail: a?.spec.segment ?? a?.spec.description,
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
        label: e?.spec.name ?? repo.namespace,
        kind: "repo",
        detail: e?.spec.description,
        status: e?.spec.status,
        version: repo.version ?? repo.commit?.slice(0, 7),
      };
    }
    return {
      family: "element" as const,
      label: e?.spec.name ?? e?.key ?? key,
      kind: e?.spec.kind ?? "element",
      detail: e?.spec.technology ?? e?.spec.description,
      status: e?.spec.status,
      suggested: e?.spec.provenance?.source === "suggested",
    };
  }
  const ref = key.slice("external:".length);
  return {
    family: "external" as const,
    label: ref,
    kind: "external",
    detail: "In another repo",
    status: undefined,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
