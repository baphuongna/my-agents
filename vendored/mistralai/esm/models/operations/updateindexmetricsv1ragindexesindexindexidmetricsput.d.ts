import * as z from "zod/v4";
import * as components from "../components/index.js";
export type MetricsData = components.UpdateIndexMetricsRequestIndexMetricsOnline | components.UpdateIndexMetricsRequestIndexMetricsOffline;
export type UpdateIndexMetricsV1RagIndexesIndexIndexIdMetricsPutRequest = {
    indexId: string;
    requestBody: components.UpdateIndexMetricsRequestIndexMetricsOnline | components.UpdateIndexMetricsRequestIndexMetricsOffline;
};
/** @internal */
export type MetricsData$Outbound = components.UpdateIndexMetricsRequestIndexMetricsOnline$Outbound | components.UpdateIndexMetricsRequestIndexMetricsOffline$Outbound;
/** @internal */
export declare const MetricsData$outboundSchema: z.ZodType<MetricsData$Outbound, MetricsData>;
export declare function metricsDataToJSON(metricsData: MetricsData): string;
/** @internal */
export type UpdateIndexMetricsV1RagIndexesIndexIndexIdMetricsPutRequest$Outbound = {
    index_id: string;
    RequestBody: components.UpdateIndexMetricsRequestIndexMetricsOnline$Outbound | components.UpdateIndexMetricsRequestIndexMetricsOffline$Outbound;
};
/** @internal */
export declare const UpdateIndexMetricsV1RagIndexesIndexIndexIdMetricsPutRequest$outboundSchema: z.ZodType<UpdateIndexMetricsV1RagIndexesIndexIndexIdMetricsPutRequest$Outbound, UpdateIndexMetricsV1RagIndexesIndexIndexIdMetricsPutRequest>;
export declare function updateIndexMetricsV1RagIndexesIndexIndexIdMetricsPutRequestToJSON(updateIndexMetricsV1RagIndexesIndexIndexIdMetricsPutRequest: UpdateIndexMetricsV1RagIndexesIndexIndexIdMetricsPutRequest): string;
//# sourceMappingURL=updateindexmetricsv1ragindexesindexindexidmetricsput.d.ts.map