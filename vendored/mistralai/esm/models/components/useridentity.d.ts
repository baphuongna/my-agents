import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type UserIdentity = {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
};
/** @internal */
export declare const UserIdentity$inboundSchema: z.ZodType<UserIdentity, unknown>;
export declare function userIdentityFromJSON(jsonString: string): SafeParseResult<UserIdentity, SDKValidationError>;
//# sourceMappingURL=useridentity.d.ts.map