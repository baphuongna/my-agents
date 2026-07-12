import { MistralCore } from "../core.js";
import { RequestOptions } from "../lib/sdks.js";
import * as components from "../models/components/index.js";
import { ConnectionError, InvalidRequestError, RequestAbortedError, RequestTimeoutError, UnexpectedClientError } from "../models/errors/httpclienterrors.js";
import * as errors from "../models/errors/index.js";
import { MistralError } from "../models/errors/mistralerror.js";
import { ResponseValidationError } from "../models/errors/responsevalidationerror.js";
import { SDKValidationError } from "../models/errors/sdkvalidationerror.js";
import * as operations from "../models/operations/index.js";
import { APIPromise } from "../types/async.js";
import { Result } from "../types/fp.js";
/**
 * Document Fetch
 *
 * @remarks
 * Fetch a few stored retrievable elements from the index/schema
 */
export declare function betaRagSearchIndexesDocumentsFetch(client: MistralCore, request: operations.DocumentFetchV1RagIndexesIndexIndexIdSchemasSchemaSchemaIdRetrievablesGetRequest, options?: RequestOptions): APIPromise<Result<Array<components.VespaGetRetrievableResponseRetrievable>, errors.HTTPValidationError | MistralError | ResponseValidationError | ConnectionError | RequestAbortedError | RequestTimeoutError | InvalidRequestError | UnexpectedClientError | SDKValidationError>>;
//# sourceMappingURL=betaRagSearchIndexesDocumentsFetch.d.ts.map