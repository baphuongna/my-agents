import * as z from "zod/v4";
import { OpenEnum } from "../../types/enums.js";
export declare const SchemaFieldIndex: {
    readonly Ann: "ann";
    readonly Bm25: "bm25";
    readonly Attribute: "attribute";
};
export type SchemaFieldIndex = OpenEnum<typeof SchemaFieldIndex>;
/** @internal */
export declare const SchemaFieldIndex$inboundSchema: z.ZodType<SchemaFieldIndex, unknown>;
/** @internal */
export declare const SchemaFieldIndex$outboundSchema: z.ZodType<string, SchemaFieldIndex>;
//# sourceMappingURL=schemafieldindex.d.ts.map