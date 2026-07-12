import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type OCRListBlock = {
    topLeftX: number;
    topLeftY: number;
    bottomRightX: number;
    bottomRightY: number;
    /**
     * Text/markdown/html content of this block
     */
    content: string;
    type: "list";
};
/** @internal */
export declare const OCRListBlock$inboundSchema: z.ZodType<OCRListBlock, unknown>;
export declare function ocrListBlockFromJSON(jsonString: string): SafeParseResult<OCRListBlock, SDKValidationError>;
//# sourceMappingURL=ocrlistblock.d.ts.map