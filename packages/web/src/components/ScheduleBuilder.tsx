/**
 * Schedule Builder — visual cron expression editor.
 * Port of Hermes ScheduleBuilder pattern.
 */
import {
  type ScheduleState,
  type ScheduleMode,
  WEEKDAY_NAMES,
  buildCronExpr,
  describeSchedule,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";

const MODES: { value: ScheduleMode; label: string }[] = [
  { value: "interval", label: "Every N…" },
  { value: "daily", label: "Daily at" },
  { value: "weekly", label: "Weekly on" },
  { value: "monthly", label: "Monthly on" },
  { value: "custom", label: "Custom cron" },
];

export function ScheduleBuilder({
  value,
  onChange,
}: {
  value: ScheduleState;
  onChange: (s: ScheduleState) => void;
}) {
  const update = (patch: Partial<ScheduleState>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      {/* Mode selector */}
      <div className="flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => update({ mode: m.value })}
            className={cn(
              "px-2.5 py-1 text-[11px] rounded-md transition-colors",
              value.mode === m.value
                ? "bg-accent text-white"
                : "bg-bg-elevated text-fg-muted hover:text-fg border border-border",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Conditional fields */}
      {value.mode === "interval" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">Every</span>
          <input
            type="number"
            aria-label="Interval value" min={1} max={1440}
            className="input w-20 text-center"
            value={value.intervalValue}
            onChange={(e) => update({ intervalValue: Math.max(1, parseInt(e.target.value) || 1) })}
          />
          <select
            className="input"
            value={value.intervalUnit}
            onChange={(e) => update({ intervalUnit: e.target.value as ScheduleState["intervalUnit"] })}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
      )}

      {(value.mode === "daily" || value.mode === "weekly" || value.mode === "monthly") && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">at</span>
          <input
            type="time" aria-label="Time of day"
            className="input w-28"
            value={value.timeOfDay}
            onChange={(e) => update({ timeOfDay: e.target.value })}
          />
        </div>
      )}

      {value.mode === "weekly" && (
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_NAMES.map((name, i) => {
            const active = value.weekdays.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  const next = active
                    ? value.weekdays.filter((d) => d !== i)
                    : [...value.weekdays, i].sort();
                  update({ weekdays: next });
                }}
                className={cn(
                  "w-8 h-8 text-[11px] rounded-md transition-colors",
                  active
                    ? "bg-accent text-white"
                    : "bg-bg-elevated text-fg-muted hover:text-fg border border-border",
                )}
              >
                {name.slice(0, 2)}
              </button>
            );
          })}
        </div>
      )}

      {value.mode === "monthly" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">on day</span>
          <input
            type="number"
            aria-label="Day of month" min={1}
            max={31}
            className="input w-20 text-center"
            value={value.monthDay}
            onChange={(e) => update({ monthDay: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)) })}
          />
        </div>
      )}

      {value.mode === "custom" && (
        <input
          className="input font-mono w-full"
          placeholder="*/5 * * * *"
          value={value.customExpr}
          onChange={(e) => update({ customExpr: e.target.value })}
        />
      )}

      {/* Preview */}
      <div className="flex items-center gap-1.5 text-[11px] text-fg-muted bg-bg-input rounded-md px-2.5 py-1.5">
        <Clock size={11} className="text-accent" />
        <span>{describeSchedule(value)}</span>
        <code className="text-fg-subtle ml-auto font-mono">{buildCronExpr(value)}</code>
      </div>
    </div>
  );
}
