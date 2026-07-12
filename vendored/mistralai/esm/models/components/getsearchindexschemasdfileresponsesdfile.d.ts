import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type GetSearchIndexSchemaSDFileResponseSDFile = {
    content: string | null;
};
/** @internal */
export declare const GetSearchIndexSchemaSDFileResponseSDFile$inboundSchema: z.ZodType<GetSearchIndexSchemaSDFileResponseSDFile, unknown>;
export declare function getSearchIndexSchemaSDFileResponseSDFileFromJSON(jsonString: string): SafeParseResult<GetSearchIndexSchemaSDFileResponseSDFile, SDKValidationError>;
//# sourceMappingURL=getsearchindexschemasdfileresponsesdfile.d.ts.map