import { type Tracer, type TracerOptions, type TracerProvider } from "@opentelemetry/api";
import type { SDKOptions } from "../../lib/config.js";
import type { SecurityState } from "../../lib/security.js";
export declare const MISTRAL_SDK_TELEMETRY_ENV = "MISTRAL_SDK_TELEMETRY";
export declare const MISTRAL_TELEMETRY_BASE_URL = "https://api.mistral.ai";
export declare const MISTRAL_TELEMETRY_TRACES_PATH = "/telemetry/v1/traces";
export declare const MISTRAL_TELEMETRY_ENDPOINT: string;
export declare const MISTRAL_OTLP_TRACES_ENDPOINT_ENV = "MISTRAL_OTLP_TRACES_ENDPOINT";
export declare const TELEMETRY_PROVIDER_DEDICATED = "dedicated";
export declare const TELEMETRY_PROVIDER_GLOBAL = "global";
declare const PROVIDER_VALUES: readonly ["dedicated", "global"];
export type TelemetryProviderMode = typeof PROVIDER_VALUES[number];
export type TelemetrySetting = boolean | string | null | undefined;
export type TelemetryProvider = TelemetryProviderMode | TracerProvider;
export type ManagedTelemetryTracerProvider = TracerProvider & {
    shutdown?: () => void | Promise<void>;
    forceFlush?: () => void | Promise<void>;
};
export type TelemetryCapableTracingHook = {
    readonly _mistralTracingHook: true;
    tracerProvider: TracerProvider | undefined;
    _autoTelemetryProvider: ManagedTelemetryTracerProvider | undefined;
    _telemetryInitialization: Promise<boolean> | undefined;
    _telemetryConfigurationVersion: number;
    _telemetryAutoDisabled: boolean;
    _telemetryUseGlobalProvider: boolean;
};
type TelemetryContext = {
    baseURL?: string | URL | null | undefined;
    options?: SDKOptions | undefined;
    resolvedSecurity?: SecurityState | null | undefined;
};
type ClientWithHooks = {
    _baseURL?: string | URL | null | undefined;
    _options?: (SDKOptions & {
        hooks?: {
            beforeRequestHooks?: unknown[];
        };
    }) | undefined;
};
export type ModuleLoader = (specifier: string) => Promise<Record<string, unknown>>;
export type CreateTelemetryTracerProviderOptions = {
    apiKey: string | null | undefined;
    baseURL?: string | URL | null | undefined;
    moduleLoader?: ModuleLoader | undefined;
};
type CreateTelemetryTracerProvider = (options: CreateTelemetryTracerProviderOptions) => Promise<ManagedTelemetryTracerProvider>;
type ConfigureTelemetryForHookOptions = {
    telemetry?: TelemetrySetting;
    replaceExisting?: boolean | undefined;
    createTelemetryTracerProvider?: CreateTelemetryTracerProvider;
};
export declare class TelemetryConfigurationError extends Error {
    constructor(message: string);
}
export declare function configureTelemetry(client: ClientWithHooks, provider?: TelemetryProvider): Promise<boolean>;
export declare function setTracerProvider(client: ClientWithHooks, provider: TracerProvider): Promise<boolean>;
export declare function getTelemetryTracer(client: ClientWithHooks, name: string, version?: string, options?: TracerOptions): Tracer;
export declare function configureTelemetryForHook(hook: TelemetryCapableTracingHook, context: TelemetryContext, options?: ConfigureTelemetryForHookOptions): Promise<boolean>;
export declare function _createTelemetryTracerProvider(options: CreateTelemetryTracerProviderOptions): Promise<ManagedTelemetryTracerProvider>;
export {};
//# sourceMappingURL=telemetry.d.ts.map