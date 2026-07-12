import * as z from "zod/v4";
export type UnregisterSearchIndexV1RagIndexesIndexIndexIdDeleteRequest = {
    indexId: string;
};
/** @internal */
export type UnregisterSearchIndexV1RagIndexesIndexIndexIdDeleteRequest$Outbound = {
    index_id: string;
};
/** @internal */
export declare const UnregisterSearchIndexV1RagIndexesIndexIndexIdDeleteRequest$outboundSchema: z.ZodType<UnregisterSearchIndexV1RagIndexesIndexIndexIdDeleteRequest$Outbound, UnregisterSearchIndexV1RagIndexesIndexIndexIdDeleteRequest>;
export declare function unregisterSearchIndexV1RagIndexesIndexIndexIdDeleteRequestToJSON(unregisterSearchIndexV1RagIndexesIndexIndexIdDeleteRequest: UnregisterSearchIndexV1RagIndexesIndexIndexIdDeleteRequest): string;
//# sourceMappingURL=unregistersearchindexv1ragindexesindexindexiddelete.d.ts.map