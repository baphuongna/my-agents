import * as z from "zod/v4";
export type DocumentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequest = {
    indexId: string;
    schemaId: string;
    /**
     * Only retrieve from this group
     */
    groupId?: string | null | undefined;
};
/** @internal */
export type DocumentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequest$Outbound = {
    index_id: string;
    schema_id: string;
    group_id?: string | null | undefined;
};
/** @internal */
export declare const DocumentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequest$outboundSchema: z.ZodType<DocumentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequest$Outbound, DocumentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequest>;
export declare function documentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequestToJSON(documentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequest: DocumentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequest): string;
//# sourceMappingURL=documentfetchv1ragindexesindexindexidschemasschemaschemaidretrievablesget.d.ts.map