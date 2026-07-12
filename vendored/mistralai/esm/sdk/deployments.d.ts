import { EventStream } from "../lib/event-streams.js";
import { ClientSDK, RequestOptions } from "../lib/sdks.js";
import * as components from "../models/components/index.js";
import * as operations from "../models/operations/index.js";
export declare class Deployments extends ClientSDK {
    /**
     * List Deployments
     */
    listDeployments(request?: operations.ListDeploymentsV1WorkflowsDeploymentsGetRequest | undefined, options?: RequestOptions): Promise<components.DeploymentListResponse>;
    /**
     * Get Deployment
     */
    getDeployment(request: operations.GetDeploymentV1WorkflowsDeploymentsNameGetRequest, options?: RequestOptions): Promise<components.DeploymentDetailResponse>;
    /**
     * Get Deployment Logs
     *
     * @remarks
     * Retrieve logs for a deployment (across all of its workers).
     *
     * Use `after`/`before`/`order` on the first request to set the time range and sort order; for
     * the next pages pass the `cursor` from the previous response (it remembers the range and order).
     */
    getDeploymentLogs(request: operations.GetDeploymentLogsRequest, options?: RequestOptions): Promise<components.DeploymentLogSearchResponse>;
    /**
     * Stream Deployment Logs
     *
     * @remarks
     * Stream logs for a deployment (all of its workers) via SSE.
     *
     * Resume cursor comes from the `Last-Event-ID` header or `last_event_id` query param (header wins)
     * and takes precedence over `after`; omit all to tail from the deployment start.
     */
    streamDeploymentLogs(request: operations.StreamDeploymentLogsRequest, options?: RequestOptions): Promise<EventStream<operations.StreamDeploymentLogsResponseBody>>;
}
//# sourceMappingURL=deployments.d.ts.map