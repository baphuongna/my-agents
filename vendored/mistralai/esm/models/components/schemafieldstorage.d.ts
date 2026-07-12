import * as z from "zod/v4";
import { OpenEnum } from "../../types/enums.js";
export declare const SchemaFieldStorage: {
    readonly InMemory: "in_memory";
    readonly OnDisk: "on_disk";
};
export type SchemaFieldStorage = OpenEnum<typeof SchemaFieldStorage>;
/** @internal */
export declare const SchemaFieldStorage$inboundSchema: z.ZodType<SchemaFieldStorage, unknown>;
/** @internal */
export declare const SchemaFieldStorage$outboundSchema: z.ZodType<string, SchemaFieldStorage>;
//# sourceMappingURL=schemafieldstorage.d.ts.map