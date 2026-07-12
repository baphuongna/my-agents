import * as z from "zod/v4";
import * as components from "../components/index.js";
export type SetSchemaSummaryV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdSummaryFieldPutRequest = {
    indexId: string;
    schemaId: string;
    updateSchemaSummaryRequestSummary: components.UpdateSchemaSummaryRequestSummary;
};
/** @internal */
export type SetSchemaSummaryV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdSummaryFieldPutRequest$Outbound = {
    index_id: string;
    schema_id: string;
    UpdateSchemaSummaryRequestSummary: components.UpdateSchemaSummaryRequestSummary$Outbound;
};
/** @internal */
export declare const SetSchemaSummaryV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdSummaryFieldPutRequest$outboundSchema: z.ZodType<SetSchemaSummaryV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdSummaryFieldPutRequest$Outbound, SetSchemaSummaryV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdSummaryFieldPutRequest>;
export declare function setSchemaSummaryV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdSummaryFieldPutRequestToJSON(setSchemaSummaryV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdSummaryFieldPutRequest: SetSchemaSummaryV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdSummaryFieldPutRequest): string;
//# sourceMappingURL=setschemasummaryv1ragindexesindexindexidschemasschemaschemaidsummaryfieldput.d.ts.map