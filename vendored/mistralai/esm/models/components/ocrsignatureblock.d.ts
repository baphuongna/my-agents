import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
/**
 * Signature region. ``content`` is the transcribed name when legible, else ``""``.
 */
export type OCRSignatureBlock = {
    topLeftX: number;
    topLeftY: number;
    bottomRightX: number;
    bottomRightY: number;
    /**
     * Text/markdown/html content of this block
     */
    content: string;
    type: "signature";
};
/** @internal */
export declare const OCRSignatureBlock$inboundSchema: z.ZodType<OCRSignatureBlock, unknown>;
export declare function ocrSignatureBlockFromJSON(jsonString: string): SafeParseResult<OCRSignatureBlock, SDKValidationError>;
//# sourceMappingURL=ocrsignatureblock.d.ts.map