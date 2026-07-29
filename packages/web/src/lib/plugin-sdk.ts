/**
 * plugin-sdk — exposes the plugin registration + SDK surface on `window`.
 *
 * Plugin bundles (loaded via `<script>` by usePlugins) call into
 * `window.__MYA_PLUGINS__` to register pages/slots, and use
 * `window.__MYA_PLUGIN_SDK__` for React + hooks + UI primitives so they don't
 * need to bundle their own React copy. Adapted from Hermes `exposePluginSDK()`.
 *
 * The registry itself lives in plugin-registry.ts (priority-ordered,
 * useSyncExternalStore-backed). This module is only the WINDOW BOUNDARY.
 */
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useContext,
  createContext,
  type ComponentType,
} from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import Tooltip from "@/components/ui/Tooltip";
import { registerSlot, registerPluginPage } from "@/lib/plugin-registry";
import { isValidSlot, type PluginSlotName } from "@/lib/plugin-slots";

/** Bump on breaking changes to the SDK contract; additive changes need no bump. */
export const SDK_CONTRACT_VERSION = "1.0.0";

/** The page/slot registration surface exposed to plugin bundles. */
export interface MyaPluginRegistry {
  /** Register a top-level plugin page (route). Returns an unsubscribe fn. */
  register: typeof registerPluginPage;
  /** Register a component into a named slot. Unknown slots warn + no-op. */
  registerSlot: (slot: string, component: ComponentType, priority?: number) => () => void;
}

/** The React/hooks/components/utils surface so plugins avoid bundling React. */
export interface MyaPluginSDK {
  readonly sdkVersion: string;
  readonly React: typeof React;
  readonly hooks: {
    useState: typeof useState;
    useEffect: typeof useEffect;
    useCallback: typeof useCallback;
    useMemo: typeof useMemo;
    useRef: typeof useRef;
    useContext: typeof useContext;
    createContext: typeof createContext;
  };
  readonly components: {
    Badge: typeof Badge;
    Button: typeof Button;
    Card: typeof Card;
    Tooltip: typeof Tooltip;
  };
  readonly utils: { cn: typeof cn };
}

/**
 * Expose the plugin registry + SDK on `window`. Idempotent (skips if already
 * set). Call once before render (mirrors Hermes main.tsx).
 */
export function exposePluginSDK(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;

  if (!w["__MYA_PLUGINS__"]) {
    w["__MYA_PLUGINS__"] = {
      register: registerPluginPage,
      registerSlot: (slot: string, component: ComponentType, priority?: number): (() => void) => {
        // The registry is typed to PluginSlotName; the window boundary accepts
        // any string (plugin-ecosystem custom slots) but narrows via isValidSlot.
        // Unknown slots are warned + skipped rather than crashing the bundle.
        if (!isValidSlot(slot)) {
          // eslint-disable-next-line no-console
          console.warn(
            `[mya plugin] unknown slot "${slot}" — not in KNOWN_SLOT_NAMES; skipping registration.`,
          );
          return () => {};
        }
        return registerSlot(slot as PluginSlotName, component, priority);
      },
    } satisfies MyaPluginRegistry;
  }

  if (!w["__MYA_PLUGIN_SDK__"]) {
    w["__MYA_PLUGIN_SDK__"] = {
      sdkVersion: SDK_CONTRACT_VERSION,
      React,
      hooks: { useState, useEffect, useCallback, useMemo, useRef, useContext, createContext },
      components: { Badge, Button, Card, Tooltip },
      utils: { cn },
    } satisfies MyaPluginSDK;
  }

  // Backward-compat: pre-F5 plugin bundles read window.React directly.
  if (!w["React"]) w["React"] = React;
}
