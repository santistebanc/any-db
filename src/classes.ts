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