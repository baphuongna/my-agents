/**
 * plugin-sdk ambient types — declares the `window.__MYA_PLUGINS__` +
 * `window.__MYA_PLUGIN_SDK__` globals for plugin-author type safety.
 *
 * Hand-authored (not `typeof window.__MYA_PLUGIN_SDK__`) for the same reasons
 * Hermes cites in its sdk.d.ts: the runtime object is built incrementally +
 * versioned, and a stable hand-authored contract is clearer for plugin authors
 * than a derived type that tracks implementation drift.
 */
import type { ComponentType } from "react";

/** Page/slot registration surface (see plugin-sdk.ts). */
export interface MyaPluginRegistry {
  register: (name: string, component: ComponentType) => () => void;
  registerSlot: (slot: string, component: ComponentType, priority?: number) => () => void;
}

/** React/hooks/components/utils surface (see plugin-sdk.ts). */
export interface MyaPluginSDK {
  readonly sdkVersion: string;
  readonly React: typeof import("react");
  readonly hooks: {
    useState: typeof import("react").useState;
    useEffect: typeof import("react").useEffect;
    useCallback: typeof import("react").useCallback;
    useMemo: typeof import("react").useMemo;
    useRef: typeof import("react").useRef;
    useContext: typeof import("react").useContext;
    createContext: typeof import("react").createContext;
  };
  readonly components: Record<string, ComponentType>;
  readonly utils: { cn: (...classes: Array<string | false | null | undefined>) => string };
}

declare global {
  interface Window {
    __MYA_PLUGINS__?: MyaPluginRegistry;
    __MYA_PLUGIN_SDK__?: MyaPluginSDK;
  }
}

export {};
