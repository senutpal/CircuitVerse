const HASH_LENGTH = 12;

/* Make a short stable hash for any input text. */
async function sha256Hex(input) {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, HASH_LENGTH);
}

/* Convert data into a predictable JSON-like string. */
function stableStringify(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
    }
    return 'null';
}

/* Build hash input text from component type and params. */
function componentHashInput(type, parameters) {
    const parts = [type];
    if (parameters && Object.keys(parameters).length > 0) {
        const entries = Object.keys(parameters).sort()
            .map(k => `${k}:${stableStringify(parameters[k])}`);
        parts.push(entries.join(';'));
    }
    return parts.join('|');
}

/* Build hash input text from sorted net endpoints. */
function netHashInput(endpoints) {
    return endpoints.map(ep => {
        let s = `${ep.componentId}.${ep.portName}`;
        if (ep.portIndex !== undefined) s += `[${ep.portIndex}]`;
        return s;
    }).sort().join(';');
}

/* Create a stable component id. */
export async function generateComponentId(type, parameters) {
    return 'c_' + await sha256Hex(componentHashInput(type, parameters));
}

/* Create a stable net id. */
export async function generateNetId(endpoints) {
    return 'n_' + await sha256Hex(netHashInput(endpoints));
}

export { sha256Hex };

/* Rename duplicate ids by adding numeric suffixes. */
export function resolveCollisions(items, idField) {
    const seen = new Map();
    for (const item of items) {
        const base = item[idField];
        const count = seen.get(base) || 0;
        if (count > 0) item[idField] = `${base}_${count}`;
        seen.set(base, count + 1);
    }
    return items;
}

/* Sort components by type, label, then id. */
export function compareComponents(a, b) {
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    const la = a.label || '', lb = b.label || '';
    if (la !== lb) return la < lb ? -1 : 1;
    if (a.cid !== b.cid) return a.cid < b.cid ? -1 : 1;
    return 0;
}

/* Sort nets by net id. */
export function compareNets(a, b) {
    return a.netId < b.netId ? -1 : a.netId > b.netId ? 1 : 0;
}

/* Sort endpoints by component and port order. */
export function compareEndpoints(a, b) {
    if (a.componentId !== b.componentId) return a.componentId < b.componentId ? -1 : 1;
    if (a.portName !== b.portName) return a.portName < b.portName ? -1 : 1;
    const ia = a.portIndex !== undefined ? a.portIndex : -1;
    const ib = b.portIndex !== undefined ? b.portIndex : -1;
    return ia - ib;
}

/* Return a new object with sorted keys. */
export function sortObjectKeys(obj) {
    const sorted = {};
    for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];
    return sorted;
}
