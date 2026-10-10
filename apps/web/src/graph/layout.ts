import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Graph } from "./graph.js";

export interface Box {
  /** Relative to the parent group, like React Flow sub-flows. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 76;
export const GROUP_HEADER = 62;

const elk = new ELK();

/**
 * Lays the graph out left to right with ELK's layered algorithm. Groups are
 * compound nodes, so relationships between children of different groups are
 * routed across the hierarchy.
 */
export async function layoutGraph(graph: Graph): Promise<Map<string, Box>> {
  const elkNodes = new Map<string, ElkNode>();
  for (const n of graph.nodes) {
    elkNodes.set(
      n.id,
      n.isGroup
        ? {
            id: n.id,
            children: [],
            layoutOptions: {
              "elk.padding": `[top=${GROUP_HEADER},left=20,bottom=20,right=20]`,
            },
          }
        : { id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT },
    );
  }

  const root: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.spacing.nodeNode": "28",
      "elk.spacing.componentComponent": "50",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: [],
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
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
  const visit = (nodes: ElkNode[] | undefined) => {
    for (const n of nodes ?? []) {
      boxes.set(n.id, {
        x: n.x ?? 0,
        y: n.y ?? 0,
        width: n.width ?? NODE_WIDTH,
        height: n.height ?? NODE_HEIGHT,
      });
      visit(n.children);
    }
  };
  visit(result.children);
  return boxes;
}
