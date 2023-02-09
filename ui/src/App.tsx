import { useEffect, useState } from 'react';
import Graph from './components/ArchdocGraphViewer';
import { MenuItem } from './components/MenuItem';
import { DetailSidebar } from './components/DetailSidebar';
import { Menu } from './components/Menu';
import { ArchDocModel } from './models/ArchdocModel2';

import { simpleArch } from './examples/simpleArch';


import './App.css';
import { ArchdocSpecParser } from './util/ArchdocSpecParser';

function App() {
  const [title, setTitle] = useState("None");
  const [description, setDescription] = useState("None");

  const [selectedNode, setSelectedNode] = useState<string|null>(null);

  const [selectedComponent, setSelectedComponent] = useState<string|null>(null)

  const archParser = new ArchdocSpecParser();

  const myArch = archParser.parse(simpleArch);
  const [model, setModel] = useState<ArchDocModel>(myArch);

  const handleOnNodeSelect = (node: any) => {
    console.log(node);
  }

  const selectedComponents = model.filter(x => x.name === selectedComponent);

  useEffect(() => {
    const getSpec = async () => {
      const abc = await fetch('/model');

      const val = await abc.text();

      const arch = archParser.parse(val);

      console.log("Setting model...")
      setModel(arch);

      //console.log(arch);
    }

    getSpec();
  }, []);

  return (
    <div className="App" style={{
      display: 'flex',
    }}>
      <div>
        <Menu>
          {/* <MenuItem icon={"Info"} title="Info" /> */}
          {/* <MenuItem icon={"Edit"} title="Edit" /> */}
          {/* <MenuItem icon={"SettingTwo"} title="Settings" /> */}
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
