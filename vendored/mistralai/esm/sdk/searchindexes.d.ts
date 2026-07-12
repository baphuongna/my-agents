import { ClientSDK, RequestOptions } from "../lib/sdks.js";
import * as components from "../models/components/index.js";
import * as operations from "../models/operations/index.js";
export declare class SearchIndexes extends ClientSDK {
    /**
     * Register (or re-register) a search index
     */
    register(request: components.RegisterSearchIndexRequestIndex, options?: RequestOptions): Promise<components.RegisterSearchIndexResponseIndex>;
    /**
     * Get Index Summaries
     *
     * @remarks
     * Fetch summary view of all indexes available to a user
     */
    getIndexSummaries(options?: RequestOptions): Promise<Array<components.GetSearchIndexSummaryResponseIndex>>;
    /**
     * Unregister Search Index
     *
     * @remarks
     * Delete all information about an index
     */
    unregister(request: operations.UnregisterSearchIndexV1RagIndexesIndexIndexIdDeleteRequest, options?: RequestOptions): Promise<any>;
    /**
     * Update Index Metrics
     *
     * @remarks
     * Update the metrics for a given index
     */
    updateIndexMetrics(request: operations.UpdateIndexMetricsV1RagIndexesIndexIndexIdMetricsPutRequest, options?: RequestOptions): Promise<any>;
    /**
     * Get Index Details
     *
     * @remarks
     * Get a detailed view of the stored data for a single index
     */
    getIndexDetail(request: operations.GetIndexDetailsV1RagIndexesIndexIndexIdDetailGetRequest, options?: RequestOptions): Promise<components.GetSearchIndexDetailResponseIndex>;
    /**
     * Set Index Summary
     *
     * @remarks
     * Update the summary field for an index
     */
    setIndexSummary(request: operations.SetIndexSummaryV1RagIndexesIndexIndexIdSummaryFieldPutRequest, options?: RequestOptions): Promise<any>;
    /**
     * Get Index Schema Detail
     *
     * @remarks
     * Get a detailed view of the stored information for a schema
     */
    getIndexSchemaDetail(request: operations.GetIndexSchemaDetailV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdDetailGetRequest, options?: RequestOptions): Promise<components.GetSearchIndexSchemaDetailResponseSchemaModel>;
    /**
     * Set Schema Summary
     *
     * @remarks
     * Update the summary field for an index
     */
    setSchemaSummary(request: operations.SetSchemaSummaryV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdSummaryFieldPutRequest, options?: RequestOptions): Promise<any>;
    /**
     * Get Index Schema File
     */
    getIndexSchemaFile(request: operations.GetIndexSchemaFileV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdFileGetRequest, options?: RequestOptions): Promise<components.GetSearchIndexSchemaSDFileResponseSDFile>;
    /**
     * Document Lookup
     *
     * @remarks
     * Fetch stored information about a retrievable element stored in an index
     */
    documentLookup(request: operations.DocumentLookupV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesRetrievableDocumentIdGetRequest, options?: RequestOptions): Promise<components.VespaGetRetrievableResponseRetrievable>;
    /**
     * Document Fetch
     *
     * @remarks
     * Fetch a few stored retrievable elements from the index/schema
     */
    documentsFetch(request: operations.DocumentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequest, options?: RequestOptions): Promise<Array<components.VespaGetRetrievableResponseRetrievable>>;
}
//# sourceMappingURL=searchindexes.d.ts.map