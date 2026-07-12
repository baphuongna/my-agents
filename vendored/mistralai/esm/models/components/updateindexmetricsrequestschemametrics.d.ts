import * as z from "zod/v4";
export type UpdateIndexMetricsRequestSchemaMetrics = {
    name: string;
    documentCount: number;
};
/** @internal */
export type UpdateIndexMetricsRequestSchemaMetrics$Outbound = {
    name: string;
    document_count: number;
};
/** @internal */
export declare const UpdateIndexMetricsRequestSchemaMetrics$outboundSchema: z.ZodType<UpdateIndexMetricsRequestSchemaMetrics$Outbound, UpdateIndexMetricsRequestSchemaMetrics>;
export declare function updateIndexMetricsRequestSchemaMetricsToJSON(updateIndexMetricsRequestSchemaMetrics: UpdateIndexMetricsRequestSchemaMetrics): string;
//# sourceMappingURL=updateindexmetricsrequestschemametrics.d.ts.map