import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
export type OCRCaptionBlock = {
    topLeftX: number;
    topLeftY: number;
    bottomRightX: number;
    bottomRightY: number;
    /**
     * Text/markdown/html content of this block
     */
    content: string;
    type: "caption";
};
/** @internal */
export declare const OCRCaptionBlock$inboundSchema: z.ZodType<OCRCaptionBlock, unknown>;
export declare function ocrCaptionBlockFromJSON(jsonString: string): SafeParseResult<OCRCaptionBlock, SDKValidationError>;
//# sourceMappingURL=ocrcaptionblock.d.ts.map