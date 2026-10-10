import type { JourneyNode, Model } from "@archdoc/core/browser";
import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildGraph, type Graph, journeyEdges, type ViewState } from "../graph/graph.js";
import { type Box, layoutGraph } from "../graph/layout.js";
import { type CardNode, type Emphasis, nodeTypes } from "./nodes.js";

export interface CanvasProps {
  model: Model;
  view: ViewState;
  selected?: string | undefined;
  journey?: JourneyNode | undefined;
  step: number;
  /** Node to bring into view once it's laid out. Cleared through onCentered. */
  centerOn?: string | undefined;
  onCentered: () => void;
  onSelect: (key: string | undefined) => void;
  onToggle: (elementId: string) => void;
}

export function Canvas(props: CanvasProps) {
  const { model, view, selected, journey, step, centerOn } = props;
  const graph = useMemo(() => buildGraph(model, view), [model, view]);
  const [layout, setLayout] = useState<{ graph: Graph; boxes: Map<string, Box> }>();
  const flow = useReactFlow();
  const [hoverEdge, setHoverEdge] = useState<string>();
  const firstFit = useRef(true);

  useEffect(() => {
    let cancelled = false;
    void layoutGraph(graph).then((boxes) => {
      if (!cancelled) setLayout({ graph, boxes });
    });
    return () => {
      cancelled = true;
    };
  }, [graph]);

  const steps = useMemo(
    () => (journey ? journeyEdges(model, view, journey) : []),
    [model, view, journey],
  );

  const emphasis = useMemo(() => {
    const map = new Map<string, Emphasis>();
    if (journey) {
      for (const s of steps) {
        const current = s.step === step;
        for (const k of [s.source, s.target]) {
          if (current) map.set(k, "current");
          else if (!map.has(k)) map.set(k, "highlight");
        }
      }
    } else if (selected) {
      map.set(selected, "current");
      for (const e of graph.edges) {
        if (e.source === selected) map.set(e.target, "highlight");
        if (e.target === selected) map.set(e.source, "highlight");
      }
    }
    return map;
  }, [journey, steps, step, selected, graph]);
  const dimming = journey !== undefined || selected !== undefined;

  const nodes = useMemo<CardNode[]>(() => {
    if (!layout) return [];
    return layout.graph.nodes.flatMap((n) => {
      const box = layout.boxes.get(n.id);
      if (!box) return [];
      const info = describe(model, n.id);
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
            emphasis: emphasis.get(n.id) ?? (dimming && !n.isGroup ? "dim" : "normal"),
            selected: n.id === selected,
            onToggle:
              element && element.childIds.length > 0 ? () => props.onToggle(element.id) : undefined,
          },
        },
      ];
    });
  }, [layout, model, emphasis, dimming, selected, props.onToggle]);

  const edges = useMemo<Edge[]>(() => {
    if (!layout) return [];
    const regular: Edge[] = layout.graph.edges.map((e) => {
      const lit =
        !journey && selected !== undefined && (e.source === selected || e.target === selected);
      const label = e.relationships
        .map((r) => r.description)
        .filter(Boolean)
        .join(" · ");
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: [
          "rel",
          e.planned ? "is-planned" : "",
          lit ? "is-lit" : "",
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
    const journeyOverlay: Edge[] = steps
      .filter((s) => s.source !== s.target)
      .map((s) => ({
        id: `step:${s.id}`,
        source: s.source,
        target: s.target,
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        className: ["journey", s.step === step ? "is-current" : ""].join(" "),
        label: String(s.step + 1),
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 10,
        animated: s.step === step,
        zIndex: s.step === step ? 10 : 6,
      }));
    return [...regular, ...journeyOverlay];
  }, [layout, journey, steps, step, selected, dimming, hoverEdge]);

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
    if (!layout || layout.graph !== graph) return;
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
    if (!layout || layout.graph !== graph || lastFocus.current === view.focus) return;
    lastFocus.current = view.focus;
    requestAnimationFrame(() => void flow.fitView({ padding: 0.15, duration: 450, maxZoom: 1.15 }));
  }, [layout, graph, view.focus, flow]);

  // Keep the current journey step in view.
  useEffect(() => {
    const current = steps.find((s) => s.step === step);
    if (!current) return;
    requestAnimationFrame(() => {
      void flow.fitView({
        nodes: [{ id: current.source }, { id: current.target }],
        duration: 450,
        padding: 0.5,
        maxZoom: 1.1,
      });
    });
  }, [steps, step, flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => props.onSelect(node.id)}
      onNodeDoubleClick={(_, node) => {
        if (node.id.startsWith("element:")) props.onToggle(node.id.slice(8));
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
export function describe(model: Model, key: string) {
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
