import buildNets from './netBuilder.js';
import {
    sha256Hex,
    generateComponentId,
    generateNetId,
    compareComponents,
    compareNets,
    compareEndpoints,
    resolveCollisions,
    sortObjectKeys
} from './canonicalize.js';

const FORMAT_VERSION = '2.0.0';
const ANNOTATION_TYPES = new Set(['Text', 'Rectangle', 'Arrow', 'ImageAnnotation']);
const DIRECTION_STRINGS = new Set(['RIGHT', 'LEFT', 'UP', 'DOWN']);

/* Gather serializable circuit elements from a scope */
function collectElements(scope) {
    const elements = [];
    for (let i = 0; i < moduleList.length; i++) {
        const type = moduleList[i];
        if (type === 'SubCircuit' || ANNOTATION_TYPES.has(type)) continue;
        const list = scope[type];
        if (!list || !list.length) continue;
        for (let j = 0; j < list.length; j++) elements.push(list[j]);
    }
    return elements;
}

/* Pull stable parameters from an element save object */
function extractParams(element, customData) {
    const params = {};

    if (element.bitWidth !== undefined) params.bitWidth = element.bitWidth;
    if (element.direction) params.direction = element.direction;

    if (customData.values) {
        for (const key in customData.values) {
            if (!Object.prototype.hasOwnProperty.call(customData.values, key)) continue;
            if (key === 'state') {
                params.state = customData.values[key];
            } else {
                if (!params.values) params.values = {};
                params.values[key] = customData.values[key];
            }
        }
    }

    if (customData.constructorParamaters && customData.constructorParamaters.length > 0) {
        const cp = customData.constructorParamaters;
        if (typeof cp[1] === 'number' && cp[1] >= 2) params.inputSize = cp[1];

        const remaining = cp.filter((val, idx) => {
            if (idx === 0 && typeof val === 'string' && DIRECTION_STRINGS.has(val)) return false;
            if (idx === 1 && val === params.inputSize) return false;
            if (typeof val === 'number' && val === element.bitWidth) return false;
            return true;
        });
        if (remaining.length > 0) params.constructorParameters = remaining;
    }

    return params;
}

/* Map a node index to its final net id */
function mapNodeToNet(index, allNodes, nodeToNetId) {
    if (index === -1 || index == null) return null;
    const node = allNodes[index];
    return node ? (nodeToNetId.get(node) || null) : null;
}

/* Build component port mapping using node-to-net links */
function buildPorts(customData, allNodes, nodeToNetId) {
    const ports = {};
    if (!customData || !customData.nodes) return ports;

    for (const name in customData.nodes) {
        if (!Object.prototype.hasOwnProperty.call(customData.nodes, name)) continue;
        const ref = customData.nodes[name];

        if (Array.isArray(ref)) {
            const mapped = ref.map(i => mapNodeToNet(i, allNodes, nodeToNetId)).filter(Boolean);
            if (mapped.length > 0) ports[name] = mapped;
        } else {
            const netId = mapNodeToNet(ref, allNodes, nodeToNetId);
            if (netId) ports[name] = netId;
        }
    }
    return ports;
}

/* Build visual position info for a component */
function buildPosition(element) {
    const pos = { x: element.x, y: element.y };
    if (element.direction) pos.direction = element.direction;
    if (element.labelDirection) pos.labelDirection = element.labelDirection;
    if (element.canShowInSubcircuit && element.subcircuitMetadata) {
        pos.subcircuitMetadata = { ...element.subcircuitMetadata };
    }
    return pos;
}

/* Serialize one subcircuit reference and its position */
async function serializeSubCircuit(sub, nodeToNetId, allNodes) {
    const mapNode = n => {
        const obj = typeof n === 'number' ? allNodes[n] : n;
        return obj ? (nodeToNetId.get(obj) || null) : null;
    };

    const inputPorts = (sub.inputNodes || []).map(mapNode).filter(Boolean);
    const outputPorts = (sub.outputNodes || []).map(mapNode).filter(Boolean);

    const hex = await sha256Hex(`SubCircuit|${sub.id}|${inputPorts}|${outputPorts}`);
    const ref = { cid: `c_${hex}`, scopeId: String(sub.id), inputPorts, outputPorts };
    if (sub.label && sub.label.length > 0) ref.label = sub.label;
    if (sub.version) ref.version = String(sub.version);

    const position = { x: sub.x, y: sub.y };
    if (sub.labelDirection) position.labelDirection = sub.labelDirection;

    return { ref, position };
}

/* Serialize one visual annotation object */
function serializeAnnotation(element) {
    const anno = { type: element.objectType, x: element.x, y: element.y };
    const customData = element.customSave();
    if (customData && customData.values && Object.keys(customData.values).length > 0) {
        anno.properties = { ...customData.values };
    }
    return anno;
}

/* Extract optional metadata saved on the scope */
function extractMetadata(scope) {
    const meta = {};
    let has = false;

    if (scope.verilogMetadata &&
        (scope.verilogMetadata.isVerilogCircuit ||
         scope.verilogMetadata.code !== '// Write Some Verilog Code Here!')) {
        meta.verilogMetadata = { ...scope.verilogMetadata };
        has = true;
    }

    if (scope.testbenchData) {
        meta.testbenchData = {
            testData: scope.testbenchData.testData,
            currentGroup: scope.testbenchData.currentGroup,
            currentCase: scope.testbenchData.currentCase
        };
        has = true;
    }

    if (scope.restrictedCircuitElementsUsed && scope.restrictedCircuitElementsUsed.length > 0) {
        meta.restrictedCircuitElementsUsed = scope.restrictedCircuitElementsUsed;
        has = true;
    }

    return has ? meta : null;
}

/* Serialize a full scope into canonical JSON data */
export async function serializeScope(scope) {
    for (let i = 0; i < scope.SubCircuit.length; i++) {
        scope.SubCircuit[i].removeConnections();
    }

    try {
        const { nets: extractedNets } = buildNets(scope);
        const elements = collectElements(scope);

        const rows = [];
        for (const el of elements) {
            const customData = el.customSave();
            const params = extractParams(el, customData);
            const cid = await generateComponentId(el.objectType, params);
            rows.push({
                element: el, cid, customData,
                type: el.objectType, label: el.label || '', params
            });
        }
        rows.sort(compareComponents);
        resolveCollisions(rows, 'cid');

        const cidMap = new Map();
        for (const row of rows) cidMap.set(row.element, row.cid);

        const netRows = [];
        for (const net of extractedNets) {
            const endpoints = [];
            for (const ep of net.endpoints) {
                const compId = cidMap.get(ep.parent);
                if (!compId) continue;
                const item = { componentId: compId, portName: ep.portName };
                if (ep.portIndex !== undefined) item.portIndex = ep.portIndex;
                endpoints.push(item);
            }
            if (endpoints.length === 0) continue;
            endpoints.sort(compareEndpoints);
            netRows.push({
                netId: await generateNetId(endpoints),
                endpoints, bitWidth: net.bitWidth,
                label: net.label, waypoints: net.waypoints,
                members: net.members
            });
        }
        netRows.sort(compareNets);
        resolveCollisions(netRows, 'netId');

        const nodeToNetId = new Map();
        for (const nr of netRows) {
            for (const node of nr.members) nodeToNetId.set(node, nr.netId);
        }

        const components = [];
        const positions = {};

        for (const row of rows) {
            const ports = buildPorts(row.customData, scope.allNodes, nodeToNetId);
            const comp = { cid: row.cid, type: row.type, ports: sortObjectKeys(ports) };
            if (row.label) comp.label = row.label;
            if (Object.keys(row.params).length > 0) comp.parameters = sortObjectKeys(row.params);
            if (row.element.propagationDelay !== undefined &&
                row.element.propagationDelay !== row.element.constructor.prototype.propagationDelay) {
                comp.propagationDelay = row.element.propagationDelay;
            }
            components.push(comp);
            positions[row.cid] = buildPosition(row.element);
        }
        components.sort(compareComponents);

        const subcircuits = [];
        for (let i = 0; i < scope.SubCircuit.length; i++) {
            const { ref, position } = await serializeSubCircuit(
                scope.SubCircuit[i], nodeToNetId, scope.allNodes
            );
            subcircuits.push(ref);
            positions[ref.cid] = position;
        }

        const annotations = [];
        for (const type of ANNOTATION_TYPES) {
            const list = scope[type];
            if (!list || !list.length) continue;
            for (let i = 0; i < list.length; i++) annotations.push(serializeAnnotation(list[i]));
        }

        const netRoutes = {};
        for (const nr of netRows) {
            if (nr.waypoints && nr.waypoints.length > 0) {
                netRoutes[nr.netId] = { waypoints: nr.waypoints };
            }
        }

        const nets = netRows.map(nr => {
            const out = { netId: nr.netId, bitWidth: nr.bitWidth, endpoints: nr.endpoints };
            if (nr.label) out.label = nr.label;
            return out;
        });

        const topology = { components, nets };
        if (subcircuits.length > 0) topology.subcircuits = subcircuits;

        const visual = { componentPositions: sortObjectKeys(positions) };
        if (scope.layout) visual.layout = { ...scope.layout };
        if (Object.keys(netRoutes).length > 0) visual.netRoutes = sortObjectKeys(netRoutes);
        if (annotations.length > 0) visual.annotations = annotations;

        const output = { id: String(scope.id), name: scope.name, topology, visual };
        const metadata = extractMetadata(scope);
        if (metadata) output.metadata = metadata;

        return output;
    } finally {
        for (let i = 0; i < scope.SubCircuit.length; i++) {
            scope.SubCircuit[i].makeConnections();
        }
    }
}

/* Order scopes so dependencies come first */
function orderByDependencies(scopeList) {
    const deps = {};
    const done = {};
    const ordered = [];

    for (const id in scopeList) deps[id] = scopeList[id].getDependencies();

    function visit(id) {
        if (done[id]) return;
        for (const dep of (deps[id] || [])) visit(dep);
        done[id] = true;
        ordered.push(scopeList[id]);
    }

    for (const id in scopeList) visit(id);
    return ordered;
}

/* Serialize all scopes and project-level settings */
export async function serializeProject(scopeList, options) {
    const scopes = [];
    for (const scope of orderByDependencies(scopeList)) {
        scopes.push(await serializeScope(scope));
    }

    const project = {
        formatVersion: FORMAT_VERSION,
        meta: {
            name: options.projectName || 'Untitled',
            projectId: String(options.projectId || '')
        },
        scopes
    };

    if (options.orderedTabs && options.orderedTabs.length > 0) {
        project.orderedTabs = options.orderedTabs.map(String);
    }

    const gs = {};
    let hasGs = false;
    if (options.timePeriod !== undefined) { gs.timePeriod = options.timePeriod; hasGs = true; }
    if (options.clockEnabled !== undefined) { gs.clockEnabled = options.clockEnabled; hasGs = true; }
    if (options.focussedCircuit !== undefined) { gs.focussedCircuit = String(options.focussedCircuit); hasGs = true; }
    if (hasGs) project.globalState = gs;

    return JSON.stringify(project, null, 4);
}
