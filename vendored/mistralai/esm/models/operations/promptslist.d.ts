import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import * as components from "../components/index.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type PromptsListRequest = {
    pageSize?: number | undefined;
    pageToken?: string | undefined;
    alias?: string | undefined;
    fields?: Array<string> | undefined;
};
export type PromptsListResponse = {
    result: components.ListPromptsResponse;
};
/** @internal */
export type PromptsListRequest$Outbound = {
    pageSize?: number | undefined;
    pageToken?: string | undefined;
    alias?: string | undefined;
    fields?: Array<string> | undefined;
};
/** @internal */
export declare const PromptsListRequest$outboundSchema: z.ZodType<PromptsListRequest$Outbound, PromptsListRequest>;
export declare function promptsListRequestToJSON(promptsListRequest: PromptsListRequest): string;
/** @internal */
export declare const PromptsListResponse$inboundSchema: z.ZodType<PromptsListResponse, unknown>;
export declare function promptsListResponseFromJSON(jsonString: string): SafeParseResult<PromptsListResponse, SDKValidationError>;
//# sourceMappingURL=promptslist.d.ts.map