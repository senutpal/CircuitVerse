import UnionFind from './unionFind.js';

const NODE_INPUT = 0;
const NODE_OUTPUT = 1;
const NODE_INTERMEDIATE = 2;

/* Creates a map from node to index in the allnodes array */
function buildNodeIndexMap(allNodes) {
    const nodeIndexMap = new Map();
    for (let i = 0; i < allNodes.length; i++) {
        nodeIndexMap.set(allNodes[i], i);
    }
    return nodeIndexMap;
}

/* Resloves the port name for a Node within its parent component */
function resolvePortName(node, parent, nodeIndexMap) {
    const nodeIndex = nodeIndexMap.get(node);
    if (nodeIndex === undefined) {
        return null;
    }

    let customData;
    try {
        customData = parent.customSave();
    } catch (e) {
        return null;
    }

    if (!customData || !customData.nodes) {
        return null;
    }

    const nodes = customData.nodes;
    for (const portName in nodes) {
        if (!Object.prototype.hasOwnProperty.call(nodes, portName)) {
            continue;
        }

        const portValue = nodes[portName];

        if (Array.isArray(portValue)) {
            const portIndex = portValue.indexOf(nodeIndex);
            if (portIndex !== -1) {
                return { portName, portIndex };
            }
        } else {
            if (portValue === nodeIndex) {
                return { portName };
            }
        }
    }

    return null;
}

/* Build nets(electrically connected components) from the given scope */
export default function buildNets(scope) {
    const allNodes = scope.allNodes || [];
    const nodeIndexMap = buildNodeIndexMap(allNodes);

    const uf = new UnionFind();

    for (let i = 0; i < allNodes.length; i++) {
        uf.find(allNodes[i]);
    }

    for (let i = 0; i < allNodes.length; i++) {
        const node = allNodes[i];
        for (let j = 0; j < node.connections.length; j++) {
            uf.union(node, node.connections[j]);
        }
    }

    const groups = uf.groups();

    const nets = [];

    for (const members of groups.values()) {
        const endpoints = [];
        const waypoints = [];
        const memberNodes = [];
        let bitWidth = 1;
        let label;
        let bitWidthSet = false;

        for (let i = 0; i < members.length; i++) {
            const node = members[i];
            const parent = node.parent;
            memberNodes.push(node);

            if (node.type === NODE_INTERMEDIATE) {
                waypoints.push({
                    x: node.absX(),
                    y: node.absY()
                });
            } else if ((node.type === NODE_INPUT || node.type === NODE_OUTPUT) &&
                parent && parent.objectType !== 'CircuitElement') {
                const portInfo = resolvePortName(node, parent, nodeIndexMap);

                if (portInfo) {
                    endpoints.push({
                        node,
                        parent,
                        portName: portInfo.portName,
                        portIndex: portInfo.portIndex
                    });
                }

                if (!bitWidthSet) {
                    bitWidth = node.bitWidth || 1;
                    bitWidthSet = true;
                }
            }

            if (!label && node.label && node.label.length > 0) {
                label = node.label;
            }
        }

        if (endpoints.length > 0) {
            nets.push({
                endpoints,
                bitWidth,
                label: label || '',
                waypoints,
                members: memberNodes
            });
        }
    }

    return { nets };
}

