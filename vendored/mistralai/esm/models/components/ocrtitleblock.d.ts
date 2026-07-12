import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type OCRTitleBlock = {
    topLeftX: number;
    topLeftY: number;
    bottomRightX: number;
    bottomRightY: number;
    /**
     * Text/markdown/html content of this block
     */
    content: string;
    type: "title";
};
/** @internal */
export declare const OCRTitleBlock$inboundSchema: z.ZodType<OCRTitleBlock, unknown>;
export declare function ocrTitleBlockFromJSON(jsonString: string): SafeParseResult<OCRTitleBlock, SDKValidationError>;
//# sourceMappingURL=ocrtitleblock.d.ts.map