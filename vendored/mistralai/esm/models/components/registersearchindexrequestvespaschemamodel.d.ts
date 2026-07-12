import * as z from "zod/v4";
import { RegisterSearchIndexRequestVespaSchemaField, RegisterSearchIndexRequestVespaSchemaField$Outbound } from "./registersearchindexrequestvespaschemafield.js";
export type RegisterSearchIndexRequestVespaSchemaModel = {
    name: string;
    fields: Array<RegisterSearchIndexRequestVespaSchemaField>;
    sd: string;
};
/** @internal */
export type RegisterSearchIndexRequestVespaSchemaModel$Outbound = {
    name: string;
    fields: Array<RegisterSearchIndexRequestVespaSchemaField$Outbound>;
    sd: string;
};
/** @internal */
export declare const RegisterSearchIndexRequestVespaSchemaModel$outboundSchema: z.ZodType<RegisterSearchIndexRequestVespaSchemaModel$Outbound, RegisterSearchIndexRequestVespaSchemaModel>;
export declare function registerSearchIndexRequestVespaSchemaModelToJSON(registerSearchIndexRequestVespaSchemaModel: RegisterSearchIndexRequestVespaSchemaModel): string;
//# sourceMappingURL=registersearchindexrequestvespaschemamodel.d.ts.map