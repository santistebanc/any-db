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
export {};
