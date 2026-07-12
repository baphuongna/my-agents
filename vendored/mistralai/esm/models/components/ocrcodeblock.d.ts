import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type OCRCodeBlock = {
    topLeftX: number;
    topLeftY: number;
    bottomRightX: number;
    bottomRightY: number;
    /**
     * Text/markdown/html content of this block
     */
    content: string;
    type: "code";
};
/** @internal */
export declare const OCRCodeBlock$inboundSchema: z.ZodType<OCRCodeBlock, unknown>;
export declare function ocrCodeBlockFromJSON(jsonString: string): SafeParseResult<OCRCodeBlock, SDKValidationError>;
//# sourceMappingURL=ocrcodeblock.d.ts.map