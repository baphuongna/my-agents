import * as z from "zod/v4";
import { OpenEnum } from "../../types/enums.js";
export declare const SchemaFieldDataType: {
    readonly Int: "int";
    readonly Bool: "bool";
    readonly String: "string";
    readonly Embedding: "embedding";
    readonly Long: "long";
    readonly Float: "float";
};
export type SchemaFieldDataType = OpenEnum<typeof SchemaFieldDataType>;
/** @internal */
export declare const SchemaFieldDataType$inboundSchema: z.ZodType<SchemaFieldDataType, unknown>;
/** @internal */
export declare const SchemaFieldDataType$outboundSchema: z.ZodType<string, SchemaFieldDataType>;
//# sourceMappingURL=schemafielddatatype.d.ts.map