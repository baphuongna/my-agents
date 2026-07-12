import * as z from "zod/v4";
import { ClosedEnum } from "../../types/enums.js";
import { RegisterSearchIndexRequestVespaIndex, RegisterSearchIndexRequestVespaIndex$Outbound } from "./registersearchindexrequestvespaindex.js";
export declare const RegisterSearchIndexRequestIndexStatus: {
    readonly Online: "online";
    readonly Offline: "offline";
};
export type RegisterSearchIndexRequestIndexStatus = ClosedEnum<typeof RegisterSearchIndexRequestIndexStatus>;
export type RegisterSearchIndexRequestIndexIndex = RegisterSearchIndexRequestVespaIndex;
export type RegisterSearchIndexRequestIndex = {
    name: string;
    status?: RegisterSearchIndexRequestIndexStatus | undefined;
    index: RegisterSearchIndexRequestVespaIndex;
};
/** @internal */
export declare const RegisterSearchIndexRequestIndexStatus$outboundSchema: z.ZodEnum<typeof RegisterSearchIndexRequestIndexStatus>;
/** @internal */
export type RegisterSearchIndexRequestIndexIndex$Outbound = RegisterSearchIndexRequestVespaIndex$Outbound;
/** @internal */
export declare const RegisterSearchIndexRequestIndexIndex$outboundSchema: z.ZodType<RegisterSearchIndexRequestIndexIndex$Outbound, RegisterSearchIndexRequestIndexIndex>;
export declare function registerSearchIndexRequestIndexIndexToJSON(registerSearchIndexRequestIndexIndex: RegisterSearchIndexRequestIndexIndex): string;
/** @internal */
export type RegisterSearchIndexRequestIndex$Outbound = {
    name: string;
    status: string;
    index: RegisterSearchIndexRequestVespaIndex$Outbound;
};
/** @internal */
export declare const RegisterSearchIndexRequestIndex$outboundSchema: z.ZodType<RegisterSearchIndexRequestIndex$Outbound, RegisterSearchIndexRequestIndex>;
export declare function registerSearchIndexRequestIndexToJSON(registerSearchIndexRequestIndex: RegisterSearchIndexRequestIndex): string;
//# sourceMappingURL=registersearchindexrequestindex.d.ts.map