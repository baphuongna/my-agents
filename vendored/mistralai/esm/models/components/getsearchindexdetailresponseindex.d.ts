import * as z from "zod/v4";
import { OpenEnum } from "../../types/enums.js";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
import { GetSearchIndexDetailResponseSchemaModel } from "./getsearchindexdetailresponseschemamodel.js";
export declare const GetSearchIndexDetailResponseIndexStatus: {
    readonly Online: "online";
    readonly Offline: "offline";
};
export type GetSearchIndexDetailResponseIndexStatus = OpenEnum<typeof GetSearchIndexDetailResponseIndexStatus>;
export type GetSearchIndexDetailResponseIndex = {
    name: string;
    creatorId: string;
    documentCount: number;
    status: GetSearchIndexDetailResponseIndexStatus;
    createdAt: Date;
    modifiedAt: Date;
    vespaVersion: string | null;
    summary: string | null;
    schemas: Array<GetSearchIndexDetailResponseSchemaModel>;
};
/** @internal */
export declare const GetSearchIndexDetailResponseIndexStatus$inboundSchema: z.ZodType<GetSearchIndexDetailResponseIndexStatus, unknown>;
/** @internal */
export declare const GetSearchIndexDetailResponseIndex$inboundSchema: z.ZodType<GetSearchIndexDetailResponseIndex, unknown>;
export declare function getSearchIndexDetailResponseIndexFromJSON(jsonString: string): SafeParseResult<GetSearchIndexDetailResponseIndex, SDKValidationError>;
//# sourceMappingURL=getsearchindexdetailresponseindex.d.ts.map