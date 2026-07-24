/**
 * ReasoningPicker — compact reasoning-effort selector dropdown.
 *
 * Sets the main model's reasoning effort, persisting to config at
 * `agent.reasoning_effort`. Uses a read-modify-write of the whole config so
 * sibling keys are never clobbered (the dashboard's single-key save pattern).
 * The selected value updates optimistically and reverts on save failure.
 *
 * Port of Hermes ReasoningPicker, adapted to mya's config API surface
 * (`api.config()` GET + `postJSON("/config", …)` PUT).
 */
import { Brain } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, postJSON } from "@/lib/api";
import { EFFORT_OPTIONS, normalizeEffort, VALID_EFFORTS } from "@/lib/reasoning-effort";
import { cn } from "@/lib/utils";

export interface ReasoningPickerProps {
  /** Current model string; re-reads the saved effort when it changes. */
  currentModel?: string;
  /** Bumped after the model picker saves, to re-read config in lockstep. */
  refreshKey?: number;
  /** Called after a successful change. */
  onChanged?: (effort: string) => void;
}

export function ReasoningPicker({
  currentModel = "",
  refreshKey = 0,
  onChanged,
}: ReasoningPickerProps) {
  const [effort, setEffort] = useState("medium");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastFetchKeyRef = useRef("");

  useEffect(() => {
    const fetchKey = `${currentModel}:${refreshKey}`;
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;
    let cancelled = false;
    api
      .config()
      .then((cfg) => {
        if (cancelled) return;
        const agent = (cfg?.agent as Record<string, unknown> | undefined) ?? {};
        setEffort(normalizeEffort(agent.reasoning_effort));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Best-effort: keep the last known value.
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [currentModel, refreshKey]);

  const onSelect = useCallback(
    (next: string) => {
      if (!VALID_EFFORTS.has(next) || next === effort) return;
      const prev = effort;
      setEffort(next); // optimistic
      setSaving(true);
      // Read-modify-write the whole config so we never clobber sibling keys.
      api
        .config()
        .then((cfg) => {
          const base = (cfg ?? {}) as Record<string, unknown>;
          const agent =
            base.agent && typeof base.agent === "object"
              ? { ...(base.agent as Record<string, unknown>) }
              : {};
          agent.reasoning_effort = next;
          return postJSON("/config", { ...base, agent });
        })
        .then(() => {
          onChanged?.(next);
        })
        .catch(() => {
          setEffort(prev); // revert on failure
        })
        .finally(() => setSaving(false));
    },
    [effort, onChanged],
  );

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-fg-subtle">
        <Brain size={14} />
        <span className="tracking-wider">reasoning</span>
      </div>
      <select
        className={cn("input ml-auto min-w-[7rem] py-1")}
        value={effort}
        disabled={!loaded || saving}
        onChange={(e) => onSelect(e.target.value)}
        data-testid="reasoning-select"
      >
        {EFFORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
