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
  model: ArchDocModel
  onNodeSelect: (node: any) => void,
  selectedNode: string | null,
  setSelectedNode: (component: string|null) => void
}

function ImprovedGraph({model, onNodeSelect, selectedNode, setSelectedNode}: Props) {

   //sampleGraph;

  //console.log(archdocGraph);

  const onInit = (reactFlowInstance: any) => console.log('flow loaded:', reactFlowInstance.getNodes());

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

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

    const archdocGraph = parseArchdocModel(model);

    setNodes((nds) => nds.map((n) => {
      n.data = {
        ...n.data,
        selected: (selectedNode === n.data.label),
      };

      return n;
    }));
  }, [selectedNode, setNodes])

  useEffect(() => {
    console.log("Model Changed!");

    const archdocGraph = parseArchdocModel(model);

    setNodes(archdocGraph.nodes);
    setEdges(archdocGraph.edges);
  }, [model])

  return (
    <div className='Graph' >
      <ReactFlow 
        nodes={nodes} 
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(e,n) => {setSelectedNode(n.id); console.log(`Selected ${n.id}!`); onNodeSelect(n);}}
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