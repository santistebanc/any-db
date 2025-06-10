import { isNode, Node } from "./classes";

interface Entry {
    path: string[];
    value: any;
}

type ListChunk = { done: boolean, next?: () => ListChunk | Promise<ListChunk>, chunk: Entry[] }

interface DBConfig {
    server?: {
        set?: (path: string[], value: any) => any
        list?: (...path: string[]) => ListChunk | Promise<ListChunk>
        subscribe?: (channel: string, onData: (data: any) => void) => any,
        publish?: (channel: string, data: any) => any,
    },
    local?: {
        set?: (path: string[], value: any) => any
        list?: (...path: string[]) => ListChunk | Promise<ListChunk>
        clear: () => Promise<void> | void
    },
    onNode?: (node: Node) => void
}

interface DBInterface {
    push: (...nodes: Node[]) => Promise<PromiseSettledResult<Entry>[]>
    pull: () => Promise<void>
    resetLocal: () => void,
}

function hextime(date?: number) {
    if (date === undefined) return Date.now().toString(36);
    return date.toString(36);
};

function getBatchHash() {
    return hextime() + Math.floor(Math.random() * 36 * 36).toString(36).padStart(2, '0')
}

function getProps(obj: Node) {
    return Object.entries(obj).filter(([k]) => !['id', 'type'].includes(k))
}

function collectPairs(sub: Node, collection: Map<string, Entry> = new Map<string, Entry>(), cache: Set<Node> = new Set<Node>()) {
    if (cache.has(sub)) return
    cache.add(sub)
    getProps(sub).forEach(([pred, obj]) => {
        const value = isNode(obj) ? obj : obj?.toString()
        const path = [sub.type, sub.id, String(pred)]
        collection.set(path.join('/'), { path, value })
        if (isNode(obj)) collectPairs(obj, collection, cache)
    });
    return collection
}

async function extractChunks(listChunk: ListChunk) {
    const cannonicals: Record<string, string> = {}
    async function extract(listChunk: ListChunk) {
        const { done, chunk, next } = listChunk;
        const results = chunk.flatMap(c => {
            const key = c.path.slice(1).join('/')
            const hash = c.path.at(-1)
            cannonicals[key] = (!cannonicals[key] || hash < cannonicals[key]) ? hash : cannonicals[key]
            return c
        })
        if (done) {
            return results.filter(r => r.path.at(-1) === cannonicals[r.path.slice(1).join('/')]).map(r => ({ path: r.path.slice(0, -1), value: r.value }))
        } else if (next) {
            return await extract(await next())
        }
    }
    return await extract(listChunk)
}

function entriesToNodes(entries: Entry[]) {
    const nodes: Record<string, Record<string, any>> = {}
    entries.forEach(en => {
        const [type, id, prop] = en.path
        const key = `${type}:${id}`
        nodes[key] ??= { type, id }
        nodes[key][prop] = en.value
    })
    return Object.values(nodes) as Node[]
}

export function db(config: DBConfig): DBInterface {
    let currentBatchNumber = 0
    async function resetLocal() {
        if (!config.local?.clear || !config.local?.set || !config.server?.list) return
        const results = await extractChunks(await config.server.list())
        await config.local.clear()
        results.forEach(res => {
            currentBatchNumber = Math.max(currentBatchNumber, Number(res.path[0]))
            config.local?.set(res.path.slice(1), res.value)
        })
        entriesToNodes(results).forEach(n => config.onNode?.(n))
    }
    async function pull() {
        if (!config.server?.list || !config.local?.set) return
        async function probe(batchNum: number) {
            const first = await config.server.list(String(batchNum))
            return first.done && first.chunk.length === 0
        }
        async function getBatch() {
            const results = await extractChunks(await config.server.list())
            results.forEach(res => {
                config.local.set(res.path.slice(1), res.value)
            })
            entriesToNodes(results).forEach(n => config.onNode?.(n))
        }
        if (!await probe(currentBatchNumber)) resetLocal()
        await getBatch()
        while (await probe(currentBatchNumber + 1)) {
            currentBatchNumber++;
            await getBatch()
        }
    }
    function push(...nodes: Node[]) {
        currentBatchNumber++;
        const hash = getBatchHash()
        const allEntries = nodes.flatMap(n => [...collectPairs(n).values()]);
        return Promise.allSettled(allEntries.map(async ({ path, value }) => {
            await config.local?.set?.(path, value)
            await config.server?.set?.([String(currentBatchNumber), ...path, hash], value)
            config.server?.publish?.('newbatch', { path, value })
            return { path, value }
        }))
    }
    config.server?.subscribe?.('newbatch', () => pull())
    return { push, resetLocal, pull }
}
