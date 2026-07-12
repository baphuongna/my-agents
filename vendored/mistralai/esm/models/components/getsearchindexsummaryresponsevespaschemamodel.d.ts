import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type GetSearchIndexSummaryResponseVespaSchemaModel = {
    id: string;
    name: string;
    documentCount: number | null;
};
/** @internal */
export declare const GetSearchIndexSummaryResponseVespaSchemaModel$inboundSchema: z.ZodType<GetSearchIndexSummaryResponseVespaSchemaModel, unknown>;
export declare function getSearchIndexSummaryResponseVespaSchemaModelFromJSON(jsonString: string): SafeParseResult<GetSearchIndexSummaryResponseVespaSchemaModel, SDKValidationError>;
//# sourceMappingURL=getsearchindexsummaryresponsevespaschemamodel.d.ts.map