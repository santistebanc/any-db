import z from "zod/v4";

interface TypesConfig<Shape extends z.ZodRawShape> {
    shape: Shape,
    id: (props: Record<string, any>) => string
}

export function makeType<Shape extends z.ZodRawShape, Conf extends TypesConfig<Shape>, N extends string>(name: N, config: Conf) {
    const schema = z.object({
        ...config.shape,
        id: z.string(),
        type: z.literal(name),
    })
    type Schema = z.ZodObject<Conf['shape'] & {
        id: z.ZodString;
        type: z.ZodLiteral<N>;
    }, z.core.$strip>

    type Type = ((input: z.infer<z.ZodObject<Conf['shape']>>) => z.infer<z.ZodObject<Conf['shape'] & {
        id: z.ZodString;
        type: z.ZodLiteral<N>;
    }, z.core.$strip>>) & {
        schema: Schema,
        isType: (obj: any) => obj is z.infer<Schema>
    }
    type ConType = (input: z.infer<z.ZodObject<typeof config.shape, z.core.$strip>>) => z.infer<Schema>
    const con: ConType = (input) => schema.parse({ ...input, id: config.id(input), type: name })
    const isType = (obj: any): obj is z.infer<Schema> => schema.safeParse(obj).success

    const res = Object.assign(con, { schema, isType })
    return res as Type
}

export type Node = { type: string, id: string }
export function isNode(obj: any): obj is Node {
    return typeof obj === 'object' && obj != null && 'type' in obj && 'id' in obj;
}

export type Type<T> = z.infer<T>

interface Entry {
    path: string[];
    value: any;
    ref: boolean;
}

type ListChunk = { done: boolean, next?: () => ListChunk | Promise<ListChunk>, chunk: Entry[] }

interface DBConfig {
    server?: {
        set?: (path: string[], value: any, ref: boolean) => any
        list?: (...path: string[]) => ListChunk | Promise<ListChunk>
        subscribe?: (channel: string, onData: (data: any) => void) => any,
        publish?: (channel: string, data: any) => any,
    },
    local?: {
        set?: (path: string[], value: any, ref: boolean) => any
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

function parseObj(obj: any, objPath: string[] = []): { objPath: string[]; objValue: any }[] {
    return isNode(obj) ? [{ objPath, objValue: obj }] :
        (typeof obj === 'object' && obj != null) ?
            Object.entries(obj).flatMap(([k, v]) => parseObj(v, [...objPath, k]))
            : [{ objPath, objValue: obj }]
}

function collectPairs(sub: Node, collection: Map<string, Entry> = new Map<string, Entry>(), cache: Set<Node> = new Set<Node>()) {
    if (cache.has(sub)) return
    cache.add(sub)
    getProps(sub).forEach(([pred, obj]) => {
        parseObj(obj).forEach(({ objPath, objValue }) => {
            const path = [sub.type, sub.id, String(pred), ...objPath]
            const ref = isNode(objValue)
            const value = ref ? `${objValue.type}:${objValue.id}` : obj?.toString()
            collection.set(path.join('/'), { path, value, ref })
            if (ref) collectPairs(objValue, collection, cache)
        })
    });
    return collection
}

async function extractChunks(listChunk: ListChunk) {
    const cannonicals: Record<string, string | undefined> = {}
    async function extract(listChunk: ListChunk) {
        const { done, chunk, next } = listChunk;
        const results = chunk.flatMap(c => {
            const key = c.path.slice(1).join('/')
            const hash = c.path.at(-1)
            cannonicals[key] = (!cannonicals[key] || (hash ?? Infinity) < cannonicals[key]) ? hash : cannonicals[key]
            return c
        })
        if (done) {
            return results.filter(r => r.path.at(-1) === cannonicals[r.path.slice(1).join('/')]).map(r => ({ path: r.path.slice(0, -1), value: r.value, ref: r.ref }))
        } else if (next) {
            return await extract(await next())
        }
        return []
    }
    return await extract(listChunk)
}

export function setDeep(path: string[], value: any, obj: Record<string, any>) {
    if (path[0] === undefined) throw 'path must contain at least 1 string'
    if (path.length > 1) {
        if (!(path[0] in obj)) obj[path[0]] = {}
        setDeep(path.slice(1), value, obj[path[0]])
    } else {
        obj[path[0]] = value
    }
}

function entriesToNodes(entries: Entry[]) {
    const nodes: Record<string, Record<string, any>> = {}
    entries.forEach(en => {
        const [type, id, ...objPath] = en.path
        const key = `${type}:${id}`
        nodes[key] ??= { type, id }
        if (en.ref) {
            const [type, id] = en.value.split(':')
            const objKey = `${type}:${id}`
            nodes[objKey] ??= { type, id }
            setDeep(objPath, nodes[objKey], nodes[key])
        } else {
            setDeep(objPath, en.value, nodes[key])
        }
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
            config.local?.set?.(res.path.slice(1), res.value, res.ref)
        })
        entriesToNodes(results).forEach(n => config.onNode?.(n))
    }
    async function pull() {
        if (!config.server?.list || !config.local?.set) return
        async function probe(batchNum: number) {
            const first = await config.server?.list?.(String(batchNum))
            return (first?.done && first.chunk.length === 0) ?? false
        }
        async function getBatch() {
            if (!config.server?.list) return
            const results = await extractChunks(await config.server.list())
            results.forEach(res => {
                config.local?.set?.(res.path.slice(1), res.value, res.ref)
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
        const batch = currentBatchNumber++;
        const hash = getBatchHash()
        const allEntries = nodes.flatMap(n => {
            const pairs = collectPairs(n);
            return pairs ? [...pairs.values()] : [];
        });
        return Promise.allSettled(allEntries.map(async ({ path, value, ref }) => {
            await config.local?.set?.(path, value, ref)
            await config.server?.set?.([String(batch), ...path, hash], value, ref)
            config.server?.publish?.('newbatch', { path, value, ref })
            return { path, value, ref }
        }))
    }
    config.server?.subscribe?.('newbatch', () => pull())
    return { push, resetLocal, pull }
}
