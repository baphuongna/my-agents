import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type VespaGetRetrievableResponseRetrievable = {
    id: string;
    fields: {
        [k: string]: any;
    };
};
/** @internal */
export declare const VespaGetRetrievableResponseRetrievable$inboundSchema: z.ZodType<VespaGetRetrievableResponseRetrievable, unknown>;
export declare function vespaGetRetrievableResponseRetrievableFromJSON(jsonString: string): SafeParseResult<VespaGetRetrievableResponseRetrievable, SDKValidationError>;
//# sourceMappingURL=vespagetretrievableresponseretrievable.d.ts.map