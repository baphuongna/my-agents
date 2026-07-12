import * as z from "zod/v4";
export type UpdateIndexMetricsRequestIndexMetricsOffline = {
    status: "offline";
    clearMetrics?: boolean | undefined;
};
/** @internal */
export type UpdateIndexMetricsRequestIndexMetricsOffline$Outbound = {
    status: "offline";
    clear_metrics: boolean;
};
/** @internal */
export declare const UpdateIndexMetricsRequestIndexMetricsOffline$outboundSchema: z.ZodType<UpdateIndexMetricsRequestIndexMetricsOffline$Outbound, UpdateIndexMetricsRequestIndexMetricsOffline>;
export declare function updateIndexMetricsRequestIndexMetricsOfflineToJSON(updateIndexMetricsRequestIndexMetricsOffline: UpdateIndexMetricsRequestIndexMetricsOffline): string;
//# sourceMappingURL=updateindexmetricsrequestindexmetricsoffline.d.ts.map