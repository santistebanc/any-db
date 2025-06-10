import { Node } from "./classes";
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
