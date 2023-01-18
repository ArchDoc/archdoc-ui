import { useCallback, useEffect, useState } from 'react';
import ReactFlow, {
  addEdge,
  MiniMap,
  MarkerType,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from 'reactflow';

import ComponentEdge from './ComponentEdge'

import 'reactflow/dist/style.css';
import ComponentNode from './ComponentNode';

import './index.css'

const nodeTypes: any = {
  custom: ComponentNode,
}

const edgeTypes: any = {
  floating: ComponentEdge,
};

interface Props {
  onNodeSelect: (node: any) => void,
  selectedNode: string | null,
  setSelectedNode: (component: string|null) => void
}

function ImprovedGraph({onNodeSelect, selectedNode, setSelectedNode}: Props) {
  const initialNodes: any[] = [
    {
      id: '1',
      data: { label: 'client', type: 'user', icon: 'user', selected: false },
      type: 'custom',
      position: { x: 50, y: 150 },
    },
    {
      id: '2',
      data: { label: 'ui', type: 'service', icon: 'service', selected: false },
      type: 'custom',
      position: { x: 250, y: 150 },
    },
    {
      id: '3',
      data: { label: 'api', type: 'service', icon: 'service', selected: false },
      type: 'custom',
      position: { x: 450, y: 150 },
    },
    {
      id: '4',
      data: { label: 'recipe-service', type: 'service', icon: 'service', selected: false },
      type: 'custom',
      position: { x: 650, y: 50 },
    },
    {
      id: '5',
      data: { label: 'auth-service', type: 'service', icon: 'service', selected: false },
      type: 'custom',
      position: { x: 650, y: 150 },
    },
    {
      id: '6',
      data: { label: 'product-service', type: 'service', icon: 'service', selected: false },
      type: 'custom',
      position: { x: 650, y: 250 },
    }
  ];

  const initialEdges: any[] = [
    {
      id: 'e1-2',
      source: '1',
      target: '2',
    },
    {
      id: 'e2-3',
      source: '2',
      target: '3',
    },
    {
      id: 'e3-4',
      source: '3',
      target: '4',
    },
    {
      id: 'e3-5',
      source: '3',
      target: '5',
    },
    {
      id: 'e3-6',
      source: '3',
      target: '6',
    },
  ];

  const onInit = (reactFlowInstance: any) => console.log('flow loaded:', reactFlowInstance.getNodes());

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge(params, eds)), []);

  //const [selectedNode, setSelectedNode] = useState<string|null>(null);

  const connectionLineStyle = {
    strokeWidth: 3,
    stroke: 'black',
  };

  const defaultEdgeOptions = {
    style: { strokeWidth: 3, stroke: '#C1C1C1' },
    type: 'floating',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#C1C1C1',
    },
  };

  useEffect(() => {
    console.log("SELECTED!");
    
    setNodes((nds) => nds.map((n) => {
      n.data = {
        ...n.data,
        selected: (selectedNode === n.data.label),
      };

      return n;
    }));
  }, [selectedNode, setNodes])

  return (
    <div className='Graph' >
      <ReactFlow 
        nodes={nodes} 
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(e,n) => {setSelectedNode(n.id); console.log(`Selected ${n.id}`); onNodeSelect(n);}}
        onEdgeClick={(e) => console.log(e)}
        onConnect={onConnect}
        defaultEdgeOptions={defaultEdgeOptions}
        onInit={onInit}
        connectionLineStyle={connectionLineStyle}
        onPaneClick={() => {setSelectedNode(null); console.log(`Selected null`); onNodeSelect(null);}}>
        <Background />
        <Controls />
        <MiniMap zoomable pannable />
      </ReactFlow>
    </div>
  );
}

export default ImprovedGraph;