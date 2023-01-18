import { useState } from 'react';
import Graph from './components/ArchdocGraph';
import { MenuItem } from './components/MenuItem';
import { DetailSidebar } from './components/DetailSidebar';
import { Menu } from './components/Menu';
import { ArchDocModel } from './models/ArchdocModel';

import simpleArchModel from './examples/simple-arch.json';


import './App.css';

function App() {
  const [title, setTitle] = useState("None");
  const [description, setDescription] = useState("None");

  const [selectedNode, setSelectedNode] = useState<string|null>(null);

  const [selectedComponent, setSelectedComponent] = useState<string|null>(null)

  const [model, setModel] = useState<ArchDocModel>(simpleArchModel);

  const handleOnNodeSelect = (node: any) => {
    console.log(node);
  }

  const selectedComponents = model.filter(x => x.name === selectedComponent);

  return (
    <div className="App" style={{
      display: 'flex',
    }}>
      <div>
        <Menu>
          <MenuItem icon={"Info"} title="Info" />
          <MenuItem icon={"Edit"} title="Edit" />
          <MenuItem icon={"SettingTwo"} title="Settings" />
        </Menu>
      </div>
      <div className='middle-pane'>
        <Graph selectedNode={selectedComponent} setSelectedNode={setSelectedComponent} onNodeSelect={(n) => {(n !== null) ? setSelectedComponent(n.data.label) : setSelectedComponent(null)}}/>
      </div>
      <div className='sidebar'>
        <DetailSidebar archdocComponent={(selectedComponents.length === 1) ? selectedComponents[0] : null} onSelectComponent={(component) => setSelectedComponent(component)} />
      </div>
      
    </div>

  );
}

export default App;
