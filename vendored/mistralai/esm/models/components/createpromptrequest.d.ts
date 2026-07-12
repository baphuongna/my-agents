import * as z from "zod/v4";
import { PromptDefinition, PromptDefinition$Outbound } from "./promptdefinition.js";
import { RegistrySharingScope } from "./registrysharingscope.js";
export type CreatePromptRequest = {
    /**
     * Stable object name.
     */
    name: string;
    /**
     * Versioned prompt content.
     */
    definition: PromptDefinition;
    /**
     * Display title.
     */
    title?: string | null | undefined;
    /**
     * Display description.
     */
    description?: string | null | undefined;
    /**
     * Notes for this version.
     */
    notes?: string | null | undefined;
    sharingScope?: RegistrySharingScope | undefined;
    /**
     * Aliases pointing to this version.
     */
    aliases?: Array<string> | undefined;
};
/** @internal */
export type CreatePromptRequest$Outbound = {
    name: string;
    definition: PromptDefinition$Outbound;
    title?: string | null | undefined;
    description?: string | null | undefined;
    notes?: string | null | undefined;
    sharingScope?: string | undefined;
    aliases?: Array<string> | undefined;
};
/** @internal */
export declare const CreatePromptRequest$outboundSchema: z.ZodType<CreatePromptRequest$Outbound, CreatePromptRequest>;
export declare function createPromptRequestToJSON(createPromptRequest: CreatePromptRequest): string;
//# sourceMappingURL=createpromptrequest.d.ts.map