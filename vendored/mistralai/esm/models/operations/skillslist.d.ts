import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import * as components from "../components/index.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type SkillsListRequest = {
    pageSize?: number | undefined;
    pageToken?: string | undefined;
    alias?: string | undefined;
    fields?: Array<string> | undefined;
};
export type SkillsListResponse = {
    result: components.ListSkillsResponse;
};
/** @internal */
export type SkillsListRequest$Outbound = {
    pageSize?: number | undefined;
    pageToken?: string | undefined;
    alias?: string | undefined;
    fields?: Array<string> | undefined;
};
/** @internal */
export declare const SkillsListRequest$outboundSchema: z.ZodType<SkillsListRequest$Outbound, SkillsListRequest>;
export declare function skillsListRequestToJSON(skillsListRequest: SkillsListRequest): string;
/** @internal */
export declare const SkillsListResponse$inboundSchema: z.ZodType<SkillsListResponse, unknown>;
export declare function skillsListResponseFromJSON(jsonString: string): SafeParseResult<SkillsListResponse, SDKValidationError>;
//# sourceMappingURL=skillslist.d.ts.map