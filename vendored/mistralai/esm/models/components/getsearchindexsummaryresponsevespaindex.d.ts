import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
import { GetSearchIndexSummaryResponseVespaSchemaModel } from "./getsearchindexsummaryresponsevespaschemamodel.js";
export type GetSearchIndexSummaryResponseVespaIndex = {
    type: "vespa";
    k8sCluster: string;
    k8sNamespace: string;
    vespaInstanceName: string;
    schemas: Array<GetSearchIndexSummaryResponseVespaSchemaModel>;
};
/** @internal */
export declare const GetSearchIndexSummaryResponseVespaIndex$inboundSchema: z.ZodType<GetSearchIndexSummaryResponseVespaIndex, unknown>;
export declare function getSearchIndexSummaryResponseVespaIndexFromJSON(jsonString: string): SafeParseResult<GetSearchIndexSummaryResponseVespaIndex, SDKValidationError>;
//# sourceMappingURL=getsearchindexsummaryresponsevespaindex.d.ts.map