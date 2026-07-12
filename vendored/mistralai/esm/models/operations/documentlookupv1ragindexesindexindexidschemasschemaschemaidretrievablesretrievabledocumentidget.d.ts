import * as z from "zod/v4";
export type DocumentLookupV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesRetrievableDocumentIdGetRequest = {
    indexId: string;
    schemaId: string;
    /**
     * the native ID in the underlying index
     */
    documentId: string;
};
/** @internal */
export type DocumentLookupV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesRetrievableDocumentIdGetRequest$Outbound = {
    index_id: string;
    schema_id: string;
    document_id: string;
};
/** @internal */
export declare const DocumentLookupV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesRetrievableDocumentIdGetRequest$outboundSchema: z.ZodType<DocumentLookupV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesRetrievableDocumentIdGetRequest$Outbound, DocumentLookupV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesRetrievableDocumentIdGetRequest>;
export declare function documentLookupV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesRetrievableDocumentIdGetRequestToJSON(documentLookupV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesRetrievableDocumentIdGetRequest: DocumentLookupV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesRetrievableDocumentIdGetRequest): string;
//# sourceMappingURL=documentlookupv1ragindexesindexindexidschemasschemaschemaidretrievablesretrievabledocumentidget.d.ts.map