import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { type Graph, reorderRows } from "./graph.js";
import { countCrossings } from "./route.js";

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
async function layoutOnce(
  graph: Graph,
  /** Extra ELK options for the root, to compare layouts. */
  options: Record<string, string> = {},
): Promise<Layout> {
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
              ...n.layout,
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
      ...options,
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

export interface UntangledLayout extends Layout {
  /** The graph as laid out: tables of rows may have their lines in a new order. */
  graph: Graph;
}

/**
 * Lays the graph out, then untangles the lines between rows: each table of
 * rows sorts its lines by where the rows they link to sit (the barycenter
 * heuristic), and the graph is laid out again, keeping whichever has fewer
 * crossings. Graphs without tables of rows are laid out once.
 */
export async function layoutGraph(
  graph: Graph,
  options: Record<string, string> = {},
  passes = 4,
): Promise<UntangledLayout> {
  let best = { graph, ...(await layoutOnce(graph, options)) };
  if (!graph.edges.some((e) => e.rows)) return best;
  let crossings = countCrossings(best.routes.values());
  // Each pass reorders from the last one, which may be worse before it gets better.
  let current = best;
  for (let pass = 0; pass < passes && crossings > 0; pass++) {
    const next = reorderRows(current.graph, barycenters(current.graph, current.boxes));
    current = { graph: next, ...(await layoutOnce(next, options)) };
    const c = countCrossings(current.routes.values());
    if (c < crossings) {
      best = current;
      crossings = c;
    }
  }
  return best;
}

/** For each table of rows, its lines ordered by the average height of the rows they link to. */
function barycenters(graph: Graph, boxes: Map<string, Box>): Map<string, number[]> {
  const parent = new Map(graph.nodes.map((n) => [n.id, n.parentId]));
  const top = (id: string): number => {
    const p = parent.get(id);
    return (boxes.get(id)?.y ?? 0) + (p ? top(p) : 0);
  };
  const port = new Map(
    graph.nodes.flatMap((n) => (n.ports ?? []).map((p) => [p.id, top(n.id) + p.y] as const)),
  );
  const linked = new Map<string, number[][]>();
  for (const n of graph.nodes) {
    if (n.rows)
      linked.set(
        n.id,
        n.rows.map(() => []),
      );
  }
  for (const e of graph.edges) {
    if (!e.rows || !e.sourcePort || !e.targetPort) continue;
    linked.get(e.source)?.[e.rows.from]?.push(port.get(e.targetPort) ?? 0);
    linked.get(e.target)?.[e.rows.to]?.push(port.get(e.sourcePort) ?? 0);
  }
  const order = new Map<string, number[]>();
  for (const [id, lines] of linked) {
    const base = top(id);
    const weight = lines.map((ys, i) =>
      ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : base + i * 1e-3,
    );
    // Lines that link nowhere keep their place relative to each other.
    order.set(
      id,
      lines.map((_, i) => i).sort((a, b) => (weight[a] as number) - (weight[b] as number) || a - b),
    );
  }
  return order;
}
