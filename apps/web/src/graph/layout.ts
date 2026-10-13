import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Graph } from "./graph.js";

export interface Box {
  /** Relative to the parent group, like React Flow sub-flows. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  boxes: Map<string, Box>;
  /**
   * Each edge's route, in absolute coordinates: from a point on the source's
   * border, through its bends, to a point on the target's. Edges that share a
   * box leave and enter it at different points.
   */
  routes: Map<string, Point[]>;
}

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 76;
export const GROUP_HEADER = 62;

const elk = new ELK();

/**
 * Lays the graph out left to right with ELK's layered algorithm, with
 * orthogonal routes for the edges. Groups are compound nodes, so
 * relationships between children of different groups are routed across the
 * hierarchy.
 */
export async function layoutGraph(graph: Graph): Promise<Layout> {
  const elkNodes = new Map<string, ElkNode>();
  for (const n of graph.nodes) {
    elkNodes.set(
      n.id,
      n.isGroup
        ? {
            id: n.id,
            children: [],
            layoutOptions: {
              "elk.padding": `[top=${GROUP_HEADER},left=28,bottom=28,right=28]`,
            },
          }
        : {
            id: n.id,
            width: n.size?.width ?? NODE_WIDTH,
            height: n.size?.height ?? NODE_HEIGHT,
            // Fixed ports, such as each row's sides, so edges meet the line they're about.
            ...(n.ports?.length
              ? {
                  ports: n.ports.map((p) => ({
                    id: p.id,
                    x: p.x,
                    y: p.y,
                    width: 0,
                    height: 0,
                    layoutOptions: { "elk.port.side": p.side },
                  })),
                  layoutOptions: { "elk.portConstraints": "FIXED_POS" },
                }
              : {}),
          },
    );
  }

  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      // Routes in absolute coordinates, wherever ELK keeps the edge.
      "elk.json.edgeCoords": "ROOT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.layered.spacing.edgeNodeBetweenLayers": "28",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
      "elk.spacing.nodeNode": "36",
      "elk.spacing.edgeNode": "22",
      "elk.spacing.edgeEdge": "14",
      "elk.spacing.componentComponent": "60",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: [],
    edges: graph.edges.map((e) => ({
      id: e.id,
      sources: [e.sourcePort ?? e.source],
      targets: [e.targetPort ?? e.target],
    })),
  };

  for (const n of graph.nodes) {
    const node = elkNodes.get(n.id) as ElkNode;
    const parent = n.parentId ? elkNodes.get(n.parentId) : undefined;
    (parent ?? root).children?.push(node);
  }
  // An expanded element whose children are all filtered out still needs a size.
  for (const node of elkNodes.values()) {
    if (node.children && node.children.length === 0) {
      delete node.children;
      node.width = NODE_WIDTH;
      node.height = NODE_HEIGHT;
    }
  }

  const result = await elk.layout(root);
  const boxes = new Map<string, Box>();
  const routes = new Map<string, Point[]>();
  const visit = (node: ElkNode) => {
    for (const e of (node.edges ?? []) as ElkExtendedEdge[]) {
      const s = e.sections?.[0];
      if (s) routes.set(e.id, [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
    }
    for (const n of node.children ?? []) {
      boxes.set(n.id, {
        x: n.x ?? 0,
        y: n.y ?? 0,
        width: n.width ?? NODE_WIDTH,
        height: n.height ?? NODE_HEIGHT,
      });
      visit(n);
    }
  };
  visit(result);
  return { boxes, routes };
}
