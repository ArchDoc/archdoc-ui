import { ArchDocComponent, ArchDocModel } from "../../models/ArchdocModel2"

export interface ArchdocNodePosition {
    x: number
    y: number
}

export interface ArchdocNodeData {
    label: string
    type: string
    icon: string
    selected: boolean
}

export interface ArchdocNode {
    id: string
    data: ArchdocNodeData
    type: string
    position: ArchdocNodePosition
}

export interface ArchdocEdge {
    id: string
    source: string
    target: string
}

export const equals = (e1: ArchdocEdge, e2: ArchdocEdge) => {
    return e1.source === e2.source 
        && e1.target === e2.target;
}

export interface ArchdocGraph {
    nodes: ArchdocNode[]
    edges: ArchdocEdge[]
}

export const computeGraphRanking = (archdocModel: ArchDocModel) => {
    const queue: string[][] = [];

    const graphRanking: string[][] = [];

    const componentsPlaced: any = {};

    if (archdocModel.length === 0) {
        return graphRanking;
    }

    const users = archdocModel.filter(x => x.type === "user");

    queue.push(users.map(x => x.name));

    const getNode = (name: string): ArchDocComponent | null => {
        const foundNodes = archdocModel.filter(x => x.name === name);

        if (foundNodes.length === 1) {
            return foundNodes[0];
        }

        return null;
    }

    while (queue.length > 0) {
        const foundNodeIds = queue.shift();

        if (!foundNodeIds) {
            break;
        }

        //console.table({foundNodeIds})

        const nodeIds = foundNodeIds.filter(x => !Object.keys(componentsPlaced).includes(x));
        if (nodeIds.length > 0) {
            graphRanking.push(nodeIds); 
        }

        //console.table({nodeIds})
        
        nodeIds.forEach(id => {
            if (!componentsPlaced.hasOwnProperty(id)) {
                componentsPlaced[id] = true;
            }
        })

        const depedencies = nodeIds.flatMap(id => {
            const node = getNode(id);

            if (node && node.dependencies.length > 0) {
                return node.dependencies.map(x => x.componentId);
            }

            return [];
        });

        if (depedencies.length > 0) {
            const uniqueDependencies = depedencies.reduce((uniqueValues: string[], value: string) => {
                if(!uniqueValues.some(val => val === value)) {
                    uniqueValues.push(value);
                }
        
                return uniqueValues;
            }, []);

            queue.push(uniqueDependencies)
        }
    }



    // graphRanking.forEach(nodeIds => {
    //     console.table({before: graphRanking})
    //     const depedencies = nodeIds.flatMap(id => {
    //         const node = getNode(id);

    //         if (node && node.dependencies.length > 0) {
    //             return node.dependencies.map(x => x.componentId);
    //         }

    //         return [];
    //     });

    //     console.table({beforePush: graphRanking})
    //     graphRanking.push(depedencies);
    //     console.table({afterPush: graphRanking})
    // });

    return graphRanking;
}

export const parseArchdocModel = (model: ArchDocModel): ArchdocGraph => {
    const archdocGraph: ArchdocGraph = { nodes: [], edges: [] };

    console.log(model)

    const arrangement = computeGraphRanking(model);

    // const arrangement: string[][] = [
    //     ["client"],
    //     ["ui"],
    //     ["api"],
    //     ["recipe-service", "auth-service", "product-service", "widget-service"]
    // ];

    console.log(arrangement)

    const modelIds = model.map((component, index) => "" + index);
    const modelNames = model.map(component => component.name);

    const nodes = model.map((component): ArchdocNode => {
        // const arrangement: string[][] = [
        //     ["client"],
        //     ["ui"],
        //     ["api"],
        //     ["recipe-service", "auth-service", "product-service", "widget-service"]
        // ];

        // const arrangement

        const lengths = arrangement.map(arr => arr.length);

        const maxLength = Math.max(...lengths);

        const getColumnPosition = (arr: string[][], name: string): number[] => {
            for (let col = 0; col < arr.length; col++) {
                for (let row = 0; row < arr[col].length; row++) {
                    if (arr[col][row] === name) {
                        return [col, row];
                    }
                }
            }

            return [-1, -1];
        }

        const s = getColumnPosition(arrangement, component.name)

        const initX = 200;
        const initY = 200;

        const scaleX = 200;
        const scaleY = 200;

        //console.table({component: component.name, s, colSize: lengths[s[0]]})
        
        const x = (s[0] * scaleX) + initX;
        const baseline = (maxLength / 2.0) - (lengths[s[0]] / 2.0) + (s[1]);
        const y = (baseline * scaleY) + initY;

        return {
            id: component.name,
            data: {
                type: component.type,
                label: component.name,
                icon: component.type,
                selected: false
            },
            type: "custom",
            position: {
                x,
                y
            }
        }
    });

    archdocGraph.nodes = nodes;

    const edges: ArchdocEdge[] = model.flatMap(component => {
        const deps1 = component.consumers
            .map(dep => ({
                id: `${dep.componentId}-${component.name}`,
                source: dep.componentId,
                target: component.name
            }));

        const deps2 = component.dependencies
        .map(dep => ({
            id: `${component.name}-${dep.componentId}`,
            source: component.name,
            target: dep.componentId
        }));

        return deps1.concat(deps2);
    })

    const uniqueEdges = edges.reduce((uniqueValues: ArchdocEdge[], value: ArchdocEdge) => {
        if(!uniqueValues.some((edge: ArchdocEdge) => equals(edge, value))) {
            uniqueValues.push(value);
        }

        return uniqueValues;
    }, []);

    archdocGraph.edges = uniqueEdges;

    return archdocGraph;
}

export const sampleGraph: ArchdocGraph = {
    nodes: [
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
    ],
    edges: [
        { id: 'e1-2', source: '1', target: '2' },
        { id: 'e2-3', source: '2', target: '3' },
        { id: 'e3-4', source: '3', target: '4' },
        { id: 'e3-5', source: '3', target: '5' },
        { id: 'e3-6', source: '3', target: '6' }
    ]
}