"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = db;
const classes_1 = require("./classes");
function hextime(date) {
    if (date === undefined)
        return Date.now().toString(36);
    return date.toString(36);
}
;
function getBatchHash() {
    return hextime() + Math.floor(Math.random() * 36 * 36).toString(36).padStart(2, '0');
}
function getProps(obj) {
    return Object.entries(obj).filter(([k]) => !['id', 'type'].includes(k));
}
function collectPairs(sub, collection = new Map(), cache = new Set()) {
    if (cache.has(sub))
        return;
    cache.add(sub);
    getProps(sub).forEach(([pred, obj]) => {
        const value = (0, classes_1.isNode)(obj) ? obj : obj?.toString();
        const path = [sub.type, sub.id, String(pred)];
        collection.set(path.join('/'), { path, value });
        if ((0, classes_1.isNode)(obj))
            collectPairs(obj, collection, cache);
    });
    return collection;
}
async function extractChunks(listChunk) {
    const cannonicals = {};
    async function extract(listChunk) {
        const { done, chunk, next } = listChunk;
        const results = chunk.flatMap(c => {
            const key = c.path.slice(1).join('/');
            const hash = c.path.at(-1);
            cannonicals[key] = (!cannonicals[key] || hash < cannonicals[key]) ? hash : cannonicals[key];
            return c;
        });
        if (done) {
            return results.filter(r => r.path.at(-1) === cannonicals[r.path.slice(1).join('/')]).map(r => ({ path: r.path.slice(0, -1), value: r.value }));
        }
        else if (next) {
            return await extract(await next());
        }
    }
    return await extract(listChunk);
}
function entriesToNodes(entries) {
    const nodes = {};
    entries.forEach(en => {
        const [type, id, prop] = en.path;
        const key = `${type}:${id}`;
        nodes[key] ??= { type, id };
        nodes[key][prop] = en.value;
    });
    return Object.values(nodes);
}
function db(config) {
    let currentBatchNumber = 0;
    async function resetLocal() {
        if (!config.local?.clear || !config.local?.set || !config.server?.list)
            return;
        const results = await extractChunks(await config.server.list());
        await config.local.clear();
        results.forEach(res => {
            currentBatchNumber = Math.max(currentBatchNumber, Number(res.path[0]));
            config.local?.set(res.path.slice(1), res.value);
        });
        entriesToNodes(results).forEach(n => config.onNode?.(n));
    }
    async function pull() {
        if (!config.server?.list || !config.local?.set)
            return;
        async function probe(batchNum) {
            const first = await config.server.list(String(batchNum));
            return first.done && first.chunk.length === 0;
        }
        async function getBatch() {
            const results = await extractChunks(await config.server.list());
            results.forEach(res => {
                config.local.set(res.path.slice(1), res.value);
            });
            entriesToNodes(results).forEach(n => config.onNode?.(n));
        }
        if (!await probe(currentBatchNumber))
            resetLocal();
        await getBatch();
        while (await probe(currentBatchNumber + 1)) {
            currentBatchNumber++;
            await getBatch();
        }
    }
    function push(...nodes) {
        currentBatchNumber++;
        const hash = getBatchHash();
        const allEntries = nodes.flatMap(n => [...collectPairs(n).values()]);
        return Promise.allSettled(allEntries.map(async ({ path, value }) => {
            await config.local?.set?.(path, value);
            await config.server?.set?.([String(currentBatchNumber), ...path, hash], value);
            config.server?.publish?.('newbatch', { path, value });
            return { path, value };
        }));
    }
    config.server?.subscribe?.('newbatch', () => pull());
    return { push, resetLocal, pull };
}
