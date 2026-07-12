import * as z from "zod/v4";
import { RegisterSearchIndexRequestVespaSchemaModel, RegisterSearchIndexRequestVespaSchemaModel$Outbound } from "./registersearchindexrequestvespaschemamodel.js";
export type RegisterSearchIndexRequestVespaIndex = {
    type: "vespa";
    k8sCluster: string;
    k8sNamespace: string;
    vespaInstanceName: string;
    vespaVersion: string;
    schemas: Array<RegisterSearchIndexRequestVespaSchemaModel>;
    queryUrl: string;
};
/** @internal */
export type RegisterSearchIndexRequestVespaIndex$Outbound = {
    type: "vespa";
    k8s_cluster: string;
    k8s_namespace: string;
    vespa_instance_name: string;
    vespa_version: string;
    schemas: Array<RegisterSearchIndexRequestVespaSchemaModel$Outbound>;
    query_url: string;
};
/** @internal */
export declare const RegisterSearchIndexRequestVespaIndex$outboundSchema: z.ZodType<RegisterSearchIndexRequestVespaIndex$Outbound, RegisterSearchIndexRequestVespaIndex>;
export declare function registerSearchIndexRequestVespaIndexToJSON(registerSearchIndexRequestVespaIndex: RegisterSearchIndexRequestVespaIndex): string;
//# sourceMappingURL=registersearchindexrequestvespaindex.d.ts.map