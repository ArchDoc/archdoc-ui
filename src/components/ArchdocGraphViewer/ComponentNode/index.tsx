import { reduce } from "d3";
import { Handle, Position } from "reactflow";
import { Aiming, DatabaseLock, ThreeHexagons, Square, User, DatabaseFail } from "@icon-park/react"
import { relative } from "path";

import './index.css'
import React, { ReactElement } from "react";

enum Color {
    LightBlue = "#05C7F2",
    DarkBlue = "#056CF2"
}

interface ComponentStyle {
    icon: ReactElement
    backgroundColor: Color
}

const typeToStyleMap: Record<string, ComponentStyle> = {
    "user": {
        icon: <User theme="outline" size="48" fill="#FFF" strokeWidth={3}/>,
        backgroundColor: Color.LightBlue,
    },
    "service": {
        icon: <ThreeHexagons theme="outline" size="48" fill="#FFF" strokeWidth={3}/>,
        backgroundColor: Color.DarkBlue,
    }
}

const ComponentNode = ({id, data}: any) => {
    let icon = <Square theme="outline" size="48" fill="#FFF" strokeWidth={3}/>;
    let backgroundColor: Color = Color.DarkBlue;

    if (data.type in typeToStyleMap) {
        const componentStyle = typeToStyleMap[data.type];

        icon = componentStyle.icon;
        backgroundColor = componentStyle.backgroundColor;
    }

    const borderColor = data.selected ? "#FFF" : backgroundColor

    return (
        <div className="ComponentNode">
            <div className={data.selected ? "selected" : ""} style={{backgroundColor, borderColor}}>
                {/* <Aiming theme="outline" size="48" fill="#FFF"/> */}

                {icon}
                <Handle type="source" position={Position.Right} style={{display: 'none'}}/>
                <Handle type="target" position={Position.Right} style={{display: 'none'}}/>
            </div>
            <p>{data.label}</p>
        </div>
      );
}

export default ComponentNode;