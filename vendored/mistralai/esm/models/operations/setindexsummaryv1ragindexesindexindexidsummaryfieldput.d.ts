import * as z from "zod/v4";
import * as components from "../components/index.js";
export type SetIndexSummaryV1RagIndexesIndexIndexIdSummaryFieldPutRequest = {
    indexId: string;
    updateIndexSummaryRequestSummary: components.UpdateIndexSummaryRequestSummary;
};
/** @internal */
export type SetIndexSummaryV1RagIndexesIndexIndexIdSummaryFieldPutRequest$Outbound = {
    index_id: string;
    UpdateIndexSummaryRequestSummary: components.UpdateIndexSummaryRequestSummary$Outbound;
};
/** @internal */
export declare const SetIndexSummaryV1RagIndexesIndexIndexIdSummaryFieldPutRequest$outboundSchema: z.ZodType<SetIndexSummaryV1RagIndexesIndexIndexIdSummaryFieldPutRequest$Outbound, SetIndexSummaryV1RagIndexesIndexIndexIdSummaryFieldPutRequest>;
export declare function setIndexSummaryV1RagIndexesIndexIndexIdSummaryFieldPutRequestToJSON(setIndexSummaryV1RagIndexesIndexIndexIdSummaryFieldPutRequest: SetIndexSummaryV1RagIndexesIndexIndexIdSummaryFieldPutRequest): string;
//# sourceMappingURL=setindexsummaryv1ragindexesindexindexidsummaryfieldput.d.ts.map