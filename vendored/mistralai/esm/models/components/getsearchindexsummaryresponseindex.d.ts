import * as z from "zod/v4";
import { OpenEnum } from "../../types/enums.js";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
import { GetSearchIndexSummaryResponseVespaIndex } from "./getsearchindexsummaryresponsevespaindex.js";
export declare const GetSearchIndexSummaryResponseIndexStatus: {
    readonly Online: "online";
    readonly Offline: "offline";
};
export type GetSearchIndexSummaryResponseIndexStatus = OpenEnum<typeof GetSearchIndexSummaryResponseIndexStatus>;
export type GetSearchIndexSummaryResponseIndexIndex = GetSearchIndexSummaryResponseVespaIndex;
export type GetSearchIndexSummaryResponseIndex = {
    id: string;
    name: string;
    creatorId: string;
    documentCount: number;
    status: GetSearchIndexSummaryResponseIndexStatus;
    createdAt: Date;
    modifiedAt: Date;
    index: GetSearchIndexSummaryResponseVespaIndex;
};
/** @internal */
export declare const GetSearchIndexSummaryResponseIndexStatus$inboundSchema: z.ZodType<GetSearchIndexSummaryResponseIndexStatus, unknown>;
/** @internal */
export declare const GetSearchIndexSummaryResponseIndexIndex$inboundSchema: z.ZodType<GetSearchIndexSummaryResponseIndexIndex, unknown>;
export declare function getSearchIndexSummaryResponseIndexIndexFromJSON(jsonString: string): SafeParseResult<GetSearchIndexSummaryResponseIndexIndex, SDKValidationError>;
/** @internal */
export declare const GetSearchIndexSummaryResponseIndex$inboundSchema: z.ZodType<GetSearchIndexSummaryResponseIndex, unknown>;
export declare function getSearchIndexSummaryResponseIndexFromJSON(jsonString: string): SafeParseResult<GetSearchIndexSummaryResponseIndex, SDKValidationError>;
//# sourceMappingURL=getsearchindexsummaryresponseindex.d.ts.map