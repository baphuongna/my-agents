import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type GetSearchIndexDetailResponseSchemaModel = {
    name: string;
    id: string;
    documentCount: number | null;
    lastModified: Date;
    latencyP95SThreshold: number | null;
};
/** @internal */
export declare const GetSearchIndexDetailResponseSchemaModel$inboundSchema: z.ZodType<GetSearchIndexDetailResponseSchemaModel, unknown>;
export declare function getSearchIndexDetailResponseSchemaModelFromJSON(jsonString: string): SafeParseResult<GetSearchIndexDetailResponseSchemaModel, SDKValidationError>;
//# sourceMappingURL=getsearchindexdetailresponseschemamodel.d.ts.map