"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeType = makeType;
exports.isNode = isNode;
const v4_1 = __importDefault(require("zod/v4"));
function makeType(name, config) {
    const schema = v4_1.default.object({
        ...config.shape,
        id: v4_1.default.string(),
        type: v4_1.default.literal(name),
    });
    const con = (input) => schema.parse({ ...input, id: config.id(input), type: name });
    const isType = (obj) => schema.safeParse(obj).success;
    const res = Object.assign(con, { schema, isType });
    return res;
}
function isNode(obj) {
    return typeof obj === 'object' && obj != null && 'type' in obj && 'id' in obj;
}
