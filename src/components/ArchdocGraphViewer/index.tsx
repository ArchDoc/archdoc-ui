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
import { parseArchdocModel, sampleGraph } from './ArchdocGraph';

import simpleArchModel from '../../examples/simple-arch.new.json';
import { ArchDocModel } from '../../models/ArchdocModel2';

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
  const myModel: ArchDocModel = simpleArchModel;

  

  const archdocGraph = parseArchdocModel(myModel); //sampleGraph;

  const onInit = (reactFlowInstance: any) => console.log('flow loaded:', reactFlowInstance.getNodes());

  const [nodes, setNodes, onNodesChange] = useNodesState(archdocGraph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(archdocGraph.edges);
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