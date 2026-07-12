import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
import { SchemaFieldDataType } from "./schemafielddatatype.js";
import { SchemaFieldIndex } from "./schemafieldindex.js";
import { SchemaFieldStorage } from "./schemafieldstorage.js";
export type GetSearchIndexSchemaDetailResponseField = {
    name: string;
    type: SchemaFieldDataType;
    storage: SchemaFieldStorage;
    indexType: SchemaFieldIndex | null;
};
/** @internal */
export declare const GetSearchIndexSchemaDetailResponseField$inboundSchema: z.ZodType<GetSearchIndexSchemaDetailResponseField, unknown>;
export declare function getSearchIndexSchemaDetailResponseFieldFromJSON(jsonString: string): SafeParseResult<GetSearchIndexSchemaDetailResponseField, SDKValidationError>;
//# sourceMappingURL=getsearchindexschemadetailresponsefield.d.ts.map