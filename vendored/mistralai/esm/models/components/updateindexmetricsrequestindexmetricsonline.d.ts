import * as z from "zod/v4";
import { UpdateIndexMetricsRequestSchemaMetrics, UpdateIndexMetricsRequestSchemaMetrics$Outbound } from "./updateindexmetricsrequestschemametrics.js";
export type UpdateIndexMetricsRequestIndexMetricsOnline = {
    status: "online";
    documentCount: number;
    schemaMetrics: Array<UpdateIndexMetricsRequestSchemaMetrics>;
};
/** @internal */
export type UpdateIndexMetricsRequestIndexMetricsOnline$Outbound = {
    status: "online";
    document_count: number;
    schema_metrics: Array<UpdateIndexMetricsRequestSchemaMetrics$Outbound>;
};
/** @internal */
export declare const UpdateIndexMetricsRequestIndexMetricsOnline$outboundSchema: z.ZodType<UpdateIndexMetricsRequestIndexMetricsOnline$Outbound, UpdateIndexMetricsRequestIndexMetricsOnline>;
export declare function updateIndexMetricsRequestIndexMetricsOnlineToJSON(updateIndexMetricsRequestIndexMetricsOnline: UpdateIndexMetricsRequestIndexMetricsOnline): string;
//# sourceMappingURL=updateindexmetricsrequestindexmetricsonline.d.ts.map