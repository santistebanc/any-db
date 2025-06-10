import z from "zod/v4";
interface TypesConfig<Shape extends z.ZodRawShape> {
    shape: Shape;
    id: (props: Record<string, any>) => string;
}
export declare function makeType<Shape extends z.ZodRawShape, Conf extends TypesConfig<Shape>, N extends string>(name: N, config: Conf): ((input: z.infer<z.ZodObject<Conf["shape"]>>) => z.infer<z.ZodObject<Conf["shape"] & {
    id: z.ZodString;
    type: z.ZodLiteral<N>;
}, z.core.$strip>>) & {
    schema: z.ZodObject<Conf["shape"] & {
        id: z.ZodString;
        type: z.ZodLiteral<N>;
    }, z.core.$strip>;
    isType: (obj: any) => obj is z.infer<z.ZodObject<Conf["shape"] & {
        id: z.ZodString;
        type: z.ZodLiteral<N>;
    }, z.core.$strip>>;
};
export type Node = {
    type: string;
    id: string;
};
export declare function isNode(obj: any): obj is Node;
export type Type<T> = z.infer<T>;
interface Entry {
    path: string[];
    value: any;
}
type ListChunk = {
    done: boolean;
    next?: () => ListChunk | Promise<ListChunk>;
    chunk: Entry[];
};
interface DBConfig {
    server?: {
        set?: (path: string[], value: any) => any;
        list?: (...path: string[]) => ListChunk | Promise<ListChunk>;
        subscribe?: (channel: string, onData: (data: any) => void) => any;
        publish?: (channel: string, data: any) => any;
    };
    local?: {
        set?: (path: string[], value: any) => any;
        list?: (...path: string[]) => ListChunk | Promise<ListChunk>;
        clear: () => Promise<void> | void;
    };
    onNode?: (node: Node) => void;
}
interface DBInterface {
    push: (...nodes: Node[]) => Promise<PromiseSettledResult<Entry>[]>;
    pull: () => Promise<void>;
    resetLocal: () => void;
}
export declare function db(config: DBConfig): DBInterface;
export {};
