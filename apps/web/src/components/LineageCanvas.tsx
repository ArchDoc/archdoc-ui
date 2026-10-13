import type { Model } from "@archdoc/core/browser";
import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { lineageGraph } from "../graph/data.js";
import { type Box, layoutGraph } from "../graph/layout.js";
import { type CardNode, nodeTypes } from "./nodes.js";

export interface LineageCanvasProps {
  model: Model;
  /** Qualified entry and field, such as payments.Refund.amount_cents. */
  field: string;
  onSelect: (key: string | undefined) => void;
}

/**
 * A field's lineage: each entry on the way is a box holding its fields, and
 * each arrow is a mapping expression that copies or derives one from another.
 */
export function LineageCanvas({ model, field, onSelect }: LineageCanvasProps) {
  const info = useMemo(() => lineageGraph(model, field), [model, field]);
  const [boxes, setBoxes] = useState<Map<string, Box>>();
  const flow = useReactFlow();

  useEffect(() => {
    let cancelled = false;
    setBoxes(undefined);
    if (info) {
      void layoutGraph(info.graph).then((b) => {
        if (!cancelled) setBoxes(b.boxes);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [info]);

  useEffect(() => {
    if (boxes)
      requestAnimationFrame(() => void flow.fitView({ padding: 0.2, duration: 300, maxZoom: 1.2 }));
  }, [boxes, flow]);

  const nodes = useMemo<CardNode[]>(() => {
    if (!info || !boxes) return [];
    return info.graph.nodes.flatMap((n) => {
      const box = boxes.get(n.id);
      const meta = info.nodes.get(n.id);
      if (!box || !meta) return [];
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
            family: meta.kind === "entry" ? ("data" as const) : ("field" as const),
            label: meta.label,
            kind: meta.kind === "entry" ? "data" : (meta.classification ?? "field"),
            version: meta.kind === "entry" && meta.detail ? `stored in ${meta.detail}` : undefined,
            detail: undefined,
            hiddenChildren: 0,
            isGroup: n.isGroup,
            emphasis: meta.focus ? "current" : "normal",
            selected: false,
            classified: !!meta.classification,
          },
        },
      ];
    });
  }, [info, boxes]);

  const edges = useMemo<Edge[]>(() => {
    if (!info) return [];
    return info.graph.edges.map((e) => {
      const meta = info.edges.get(e.id);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: ["lineage", meta?.copy ? "is-copy" : "is-derived"].join(" "),
        label: meta ? (meta.copy ? "copy" : meta.expression) : undefined,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        zIndex: 2,
      };
    });
  }, [info]);

  if (!info) return <p className="canvas-empty">No lineage for {field}.</p>;
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => {
        if (node.id.startsWith("field:")) onSelect(node.id);
        else if (node.id.startsWith("entry:")) onSelect(`data:${node.id.slice(6)}`);
      }}
      onPaneClick={() => onSelect(undefined)}
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
