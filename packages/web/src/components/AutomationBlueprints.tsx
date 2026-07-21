/**
 * AutomationBlueprints — pre-built cron job templates.
 * Port of Hermes AutomationBlueprints pattern.
 */
import { Clock, Zap, FileText, Activity, Mail, Database, Globe, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduleState } from "@/lib/format";
import type { LucideIcon } from "lucide-react";

export interface Blueprint {
  name: string;
  description: string;
  icon: LucideIcon;
  prompt: string;
  schedule: Partial<ScheduleState>;
  color: string;
}

export const BLUEPRINTS: Blueprint[] = [
  {
    name: "Daily Summary",
    description: "Generate a daily report of recent activity",
    icon: FileText,
    prompt: "Summarize what happened today: review git log, recent sessions, and any errors. Write a concise daily report.",
    schedule: { mode: "daily", timeOfDay: "18:00" },
    color: "text-accent",
  },
  {
    name: "Health Check",
    description: "Monitor system health every hour",
    icon: Activity,
    prompt: "Check system health: disk usage, running processes, recent errors. Report any issues found.",
    schedule: { mode: "interval", intervalValue: 60, intervalUnit: "minutes" },
    color: "text-success",
  },
  {
    name: "Git Status",
    description: "Review uncommitted changes daily",
    icon: GitBranch,
    prompt: "Check git status across all repositories. Summarize uncommitted changes, untracked files, and recent commits.",
    schedule: { mode: "daily", timeOfDay: "09:00" },
    color: "text-orange",
  },
  {
    name: "Weekly Review",
    description: "Comprehensive weekly project review",
    icon: Clock,
    prompt: "Perform a weekly review: summarize commits, issues resolved, tests added, and areas needing attention. Create action items for next week.",
    schedule: { mode: "weekly", timeOfDay: "17:00", weekdays: [5] },
    color: "text-purple",
  },
  {
    name: "Database Backup",
    description: "Backup and verify database integrity",
    icon: Database,
    prompt: "Backup the database, verify integrity, and rotate old backups. Report backup size and status.",
    schedule: { mode: "daily", timeOfDay: "02:00" },
    color: "text-warning",
  },
  {
    name: "Security Scan",
    description: "Run dependency security audit weekly",
    icon: Zap,
    prompt: "Run npm audit and cargo audit. Summarize vulnerabilities found, severity levels, and recommended fixes.",
    schedule: { mode: "weekly", timeOfDay: "08:00", weekdays: [1] },
    color: "text-danger",
  },
];

export function AutomationBlueprints({
  onApply,
}: {
  onApply: (blueprint: Blueprint) => void;
}) {
  return (
    <div>
      <h4 className="text-[11px] uppercase tracking-wide text-fg-muted mb-2 flex items-center gap-1.5">
        <Zap size={12} className="text-accent" />
        Quick Start Templates
      </h4>
      <div className="grid grid-cols-2 gap-1.5">
        {BLUEPRINTS.map((bp) => (
          <button
            key={bp.name}
            onClick={() => onApply(bp)}
            className="group flex items-start gap-2 p-2.5 rounded-lg border border-border hover:border-accent/50 hover:bg-bg-elevated/30 transition-all text-left"
          >
            <bp.icon size={15} className={cn("shrink-0 mt-0.5", bp.color)} />
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-fg group-hover:text-accent transition-colors">
                {bp.name}
              </div>
              <div className="text-[10px] text-fg-subtle truncate">{bp.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
