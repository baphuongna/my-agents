import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
import { GetSearchIndexSchemaDetailResponseField } from "./getsearchindexschemadetailresponsefield.js";
export type GetSearchIndexSchemaDetailResponseSchemaModel = {
    name: string;
    summary: string | null;
    embeddingDimensions: number | null;
    fields: Array<GetSearchIndexSchemaDetailResponseField>;
};
/** @internal */
export declare const GetSearchIndexSchemaDetailResponseSchemaModel$inboundSchema: z.ZodType<GetSearchIndexSchemaDetailResponseSchemaModel, unknown>;
export declare function getSearchIndexSchemaDetailResponseSchemaModelFromJSON(jsonString: string): SafeParseResult<GetSearchIndexSchemaDetailResponseSchemaModel, SDKValidationError>;
//# sourceMappingURL=getsearchindexschemadetailresponseschemamodel.d.ts.map