/**
 * Rich formatting utilities — port of Hermes format.ts + utils.ts patterns.
 */

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function formatBytes(bytes?: number): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

export function formatDuration(s?: number): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function timeAgo(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "never";
  const diff = Math.floor((now - d) / 1000);
  if (diff < 0) return "in the future";
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return "yesterday";
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function truncate(str: string, max = 80): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

// ── Cron schedule helpers ─────────────────────────────────────────────

export type ScheduleMode = "interval" | "daily" | "weekly" | "monthly" | "custom";

export interface ScheduleState {
  mode: ScheduleMode;
  intervalValue: number;
  intervalUnit: "minutes" | "hours" | "days";
  timeOfDay: string;
  weekdays: number[];
  monthDay: number;
  customExpr: string;
}

export const DEFAULT_SCHEDULE: ScheduleState = {
  mode: "interval",
  intervalValue: 60,
  intervalUnit: "minutes",
  timeOfDay: "09:00",
  weekdays: [1],
  monthDay: 1,
  customExpr: "",
};

export function buildCronExpr(s: ScheduleState): string {
  switch (s.mode) {
    case "interval": {
      if (s.intervalUnit === "minutes") return `*/${s.intervalValue} * * * *`;
      if (s.intervalUnit === "hours") return `0 */${s.intervalValue} * * *`;
      return `0 0 */${s.intervalValue} * *`;
    }
    case "daily": {
      const [h, m] = s.timeOfDay.split(":");
      return `${m ?? "0"} ${h ?? "0"} * * *`;
    }
    case "weekly": {
      const [h, m] = s.timeOfDay.split(":");
      const days = s.weekdays.length ? s.weekdays.join(",") : "*";
      return `${m ?? "0"} ${h ?? "0"} * * ${days}`;
    }
    case "monthly": {
      const [h, m] = s.timeOfDay.split(":");
      return `${m ?? "0"} ${h ?? "0"} ${s.monthDay} * *`;
    }
    case "custom":
      return s.customExpr || "* * * * *";
  }
}

export function describeSchedule(s: ScheduleState): string {
  switch (s.mode) {
    case "interval":
      return `Every ${s.intervalValue} ${s.intervalUnit}`;
    case "daily":
      return `Daily at ${s.timeOfDay}`;
    case "weekly": {
      const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const days = s.weekdays.map((d) => names[d]).join(", ");
      return `Weekly on ${days || "—"} at ${s.timeOfDay}`;
    }
    case "monthly":
      return `Monthly on day ${s.monthDay} at ${s.timeOfDay}`;
    case "custom":
      return s.customExpr;
  }
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseSchedule(expr: string): ScheduleState {
  if (!expr || !expr.trim()) return { ...DEFAULT_SCHEDULE };
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { ...DEFAULT_SCHEDULE, mode: "custom", customExpr: expr };
  // R84: NaN guard on parseInt
  const safeInt = (s: string) => { const n = parseInt(s); return Number.isFinite(n) ? n : NaN; };

  // parts.length === 5 guaranteed by the check above
  const m = parts[0]!;
  const h = parts[1]!;
  const dom = parts[2]!;
  const dow = parts[4]!;

  // Every N minutes
  if (m.startsWith("*/") && h === "*" && dom === "*") {
    return { ...DEFAULT_SCHEDULE, mode: "interval", intervalValue: parseInt(m.slice(2)), intervalUnit: "minutes" };
  }
  // Every N hours
  if (m === "0" && h.startsWith("*/") && dom === "*") {
    return { ...DEFAULT_SCHEDULE, mode: "interval", intervalValue: parseInt(h.slice(2)), intervalUnit: "hours" };
  }
  // Every N days
  if (m === "0" && h === "0" && dom.startsWith("*/")) {
    return { ...DEFAULT_SCHEDULE, mode: "interval", intervalValue: parseInt(dom.slice(2)), intervalUnit: "days" };
  }
  // Daily
  if (dom === "*" && dow === "*") {
    return { ...DEFAULT_SCHEDULE, mode: "daily", timeOfDay: `${h.padStart(2, "0")}:${m.padStart(2, "0")}` };
  }
  // Weekly
  if (dom === "*" && dow !== "*") {
    return {
      ...DEFAULT_SCHEDULE,
      mode: "weekly",
      timeOfDay: `${h.padStart(2, "0")}:${m.padStart(2, "0")}`,
      weekdays: dow.split(",").map((d) => parseInt(d)),
    };
  }
  // Monthly
  if (dom !== "*" && dow === "*") {
    return {
      ...DEFAULT_SCHEDULE,
      mode: "monthly",
      monthDay: parseInt(dom),
      timeOfDay: `${h.padStart(2, "0")}:${m.padStart(2, "0")}`,
    };
  }

  return { ...DEFAULT_SCHEDULE, mode: "custom", customExpr: expr };
}

export { WEEKDAY_NAMES };
