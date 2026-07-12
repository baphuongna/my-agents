import * as z from "zod/v4";
import { SchemaFieldDataType } from "./schemafielddatatype.js";
import { SchemaFieldIndex } from "./schemafieldindex.js";
import { SchemaFieldRankingType } from "./schemafieldrankingtype.js";
import { SchemaFieldStorage } from "./schemafieldstorage.js";
export type RegisterSearchIndexRequestVespaSchemaField = {
    name: string;
    type: SchemaFieldDataType;
    storage: SchemaFieldStorage;
    ranking: SchemaFieldRankingType;
    indexType: SchemaFieldIndex | null;
    multidimensional: boolean;
};
/** @internal */
export type RegisterSearchIndexRequestVespaSchemaField$Outbound = {
    name: string;
    type: string;
    storage: string;
    ranking: string;
    index_type: string | null;
    multidimensional: boolean;
};
/** @internal */
export declare const RegisterSearchIndexRequestVespaSchemaField$outboundSchema: z.ZodType<RegisterSearchIndexRequestVespaSchemaField$Outbound, RegisterSearchIndexRequestVespaSchemaField>;
export declare function registerSearchIndexRequestVespaSchemaFieldToJSON(registerSearchIndexRequestVespaSchemaField: RegisterSearchIndexRequestVespaSchemaField): string;
//# sourceMappingURL=registersearchindexrequestvespaschemafield.d.ts.map