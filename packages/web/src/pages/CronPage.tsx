/**
 * CronPage — full CRUD with visual schedule builder + run history.
 */
import { useEffect, useState } from "react";
import { api, type CronJob, type ProfileInfo } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader, LoadingSpinner, ErrorBox, EmptyState, RefreshButton } from "@/components/PageBits";
import { ScheduleBuilder } from "@/components/ScheduleBuilder";
import { AutomationBlueprints, type Blueprint } from "@/components/AutomationBlueprints";
import { ConfirmDialog, Modal } from "@/lib/modal";
import { useToast } from "@/lib/toast";
import { useConfirmDelete } from "@/hooks/useConfirmDelete";
import { usePageHeader } from "@/hooks/usePageHeader";
import { usePolling } from "@/hooks/usePolling";
import {
  type ScheduleState,
  DEFAULT_SCHEDULE,
  buildCronExpr,
  describeSchedule,
  parseSchedule,
  timeAgo,
} from "@/lib/format";
import { Clock, Play, Trash2, Plus, Pause, Pencil, History, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<CronJob | null>(null);
  // Profiles loaded in parallel with jobs (allSettled) — surfaced as
  // provider suggestions in the job modal. A failing /profiles endpoint
  // never blocks the cron job list.
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const { toast } = useToast();

  // Inject a "New Job" action into the shared page-header toolbar. The slot
  // is cleared on unmount (and again by the provider on route change).
  const { setEnd } = usePageHeader();
  useEffect(() => {
    setEnd(
      <Button size="sm" variant="primary" onClick={() => setShowAdd(true)}>
        <Plus size={13} /> New Job
      </Button>,
    );
    return () => {
      setEnd(null);
    };
  }, [setEnd, setShowAdd]);

  async function reload() {
    setLoading(true);
    setError(null);
    const [jobsR, profilesR] = await Promise.allSettled([
      api.cronJobs(),
      api.getProfiles(),
    ]);
    if (jobsR.status === "fulfilled") {
      setJobs(jobsR.value);
    } else {
      setError(
        jobsR.reason instanceof Error
          ? jobsR.reason.message
          : String(jobsR.reason),
      );
    }
    if (profilesR.status === "fulfilled") setProfiles(profilesR.value.profiles);
    setLoading(false);
  }

  usePolling(reload, 15000);

  async function toggle(job: CronJob) {
    try {
      await api.cronPatch(job.id, { enabled: !job.enabled });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, enabled: !j.enabled } : j)));
      toast(`${job.name} ${job.enabled ? "disabled" : "enabled"}`, "success");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  }

  async function run(job: CronJob) {
    try {
      await api.cronRun(job.id);
      toast(`Running "${job.name}"…`, "success");
      reload();
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  }

  async function del(id: string, name: string) {
    try {
      await api.cronDelete(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
      toast(`Deleted "${name}"`, "success");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  }

  return (
    <div className="p-4 max-w-4xl w-full mx-auto animate-fade-in-up">
      <PageHeader
        title="Cron Jobs"
        icon={Clock}
        actions={
          <>
            <RefreshButton onClick={reload} />
            <Button size="sm" variant="primary" onClick={() => setShowAdd(true)}>
              <Plus size={13} /> Add Job
            </Button>
          </>
        }
      />

      {loading && jobs.length === 0 && <LoadingSpinner label="Loading cron jobs…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && jobs.length === 0 && (
        <EmptyState
          icon={Clock}
          title="No cron jobs"
          description="Schedule recurring agent tasks"
          action={
            <Button size="sm" variant="primary" onClick={() => setShowAdd(true)}>
              <Plus size={13} /> Create your first job
            </Button>
          }
        />
      )}

      <div className="space-y-2">
        {jobs.map((job, i) => (
          <div key={job.id} style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }} className="animate-fade-in-up">
            <CronJobCard
              job={job}
              onToggle={() => toggle(job)}
              onRun={() => run(job)}
              onEdit={() => setEditing(job)}
              onDelete={() => del(job.id, job.name)}
            />
          </div>
        ))}
      </div>

      {/* Add/Edit modal */}
      <CronJobModal
        open={showAdd || editing !== null}
        editing={editing}
        profiles={profiles}
        onClose={() => {
          setShowAdd(false);
          setEditing(null);
        }}
        onSaved={() => {
          reload();
          setShowAdd(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function CronJobCard({
  job,
  onToggle,
  onRun,
  onEdit,
  onDelete,
}: {
  job: CronJob;
  onToggle: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const del = useConfirmDelete<CronJob>({
    onDelete: async () => { onDelete(); },
  });
  const [showRuns, setShowRuns] = useState(false);

  const schedule = parseSchedule(job.schedule);

  return (
    <Card className="hover:border-accent/50 transition-colors">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-2 h-2 rounded-full mt-1.5 shrink-0",
            job.enabled ? "bg-success animate-pulse-slow" : "bg-fg-subtle",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <button
              className="text-fg font-medium text-sm hover:text-accent min-w-0"
              onClick={() => setExpanded(!expanded)}
            >
              <span className="truncate">{job.name}</span>
            </button>
            {job.enabled ? (
              <Badge color="green">enabled</Badge>
            ) : (
              <Badge color="gray">disabled</Badge>
            )}
            {job.jobType && <Badge color="blue">{job.jobType}</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
            <span className="flex items-center gap-1">
              <Clock size={10} /> {describeSchedule(schedule)}
            </span>
            <code className="text-fg-subtle">{job.schedule}</code>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-fg-subtle mt-0.5">
            <span>next: {timeAgo(job.nextRunAt)}</span>
            <span>last: {timeAgo(job.lastRunAt)}</span>
            {job.provider && <span>via {job.provider}</span>}
          </div>

          {expanded && job.prompt && (
            <div className="mt-2 bg-bg-input rounded p-2 text-[11px] text-fg-muted border border-border">
              <span className="text-fg-subtle">Prompt:</span> {job.prompt}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Button size="sm" variant="ghost" onClick={onRun} title="Run now">
            <Play size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onToggle} title={job.enabled ? "Disable" : "Enable"}>
            {job.enabled ? <Pause size={13} /> : <Play size={13} />}
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit} title="Edit">
            <Pencil size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowRuns(!showRuns)} title="Run history">
            <History size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => del.requestDelete(job)} title="Delete">
            <Trash2 size={13} className="text-danger" />
          </Button>
        </div>
      </div>

      {showRuns && <RunHistory jobId={job.id} />}

      <ConfirmDialog
        open={del.isOpen}
        onClose={() => del.cancelDelete()}
        onConfirm={() => void del.confirmDelete()}
        title={`Delete "${job.name}"?`}
        description="This will permanently remove the cron job."
        confirmLabel="Delete"
        destructive
      />
    </Card>
  );
}

function RunHistory({ jobId }: { jobId: string }) {
  const [runs, setRuns] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .cronRuns(jobId)
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [jobId]);

  if (loading) return <div className="mt-3 pl-5 text-[11px] text-fg-subtle">Loading runs…</div>;
  if (runs.length === 0)
    return <div className="mt-3 pl-5 text-[11px] text-fg-subtle">No runs recorded yet.</div>;

  return (
    <div className="mt-3 pl-5 space-y-1">
      {runs.map((r, i) => {
        const run = r as { startedAt?: string; status?: string; error?: string };
        return (
          <div key={i} className="flex items-center gap-2 text-[11px] text-fg-muted">
            <Badge color={run.status === "completed" ? "green" : run.status === "error" ? "red" : "yellow"}>
              {run.status ?? "unknown"}
            </Badge>
            <span>{timeAgo(run.startedAt)}</span>
            {run.error && <span className="text-danger truncate">{run.error}</span>}
          </div>
        );
      })}
    </div>
  );
}

function CronJobModal({
  open,
  editing,
  profiles,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: CronJob | null;
  profiles: ProfileInfo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState<ScheduleState>(DEFAULT_SCHEDULE);
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setPrompt(editing.prompt ?? "");
      setSchedule(parseSchedule(editing.schedule));
      setProvider(editing.provider ?? "");
    } else {
      setName("");
      setPrompt("");
      setSchedule(DEFAULT_SCHEDULE);
      setProvider("");
    }
  }, [editing, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast("Name required", "error");
      return;
    }
    if (!prompt.trim()) {
      toast("Prompt required", "error");
      return;
    }
    setBusy(true);
    const payload = {
      name: name.trim(),
      prompt: prompt.trim(),
      schedule: buildCronExpr(schedule),
      provider: provider || undefined,
      enabled: true,
    };
    try {
      if (editing) {
        await api.cronPatch(editing.id, payload);
        toast("Job updated", "success");
      } else {
        await api.cronAdd(payload);
        toast("Job created", "success");
      }
      onSaved();
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit "${editing.name}"` : "New Cron Job"}
      maxWidth="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="cron-form" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save Changes" : "Create Job"}
          </Button>
        </>
      }
    >
      <form id="cron-form" onSubmit={submit} className="space-y-4">
        {/* Quick templates (only for new jobs) */}
        {!editing && (
          <AutomationBlueprints
            onApply={(bp: Blueprint) => {
              setName(bp.name);
              setPrompt(bp.prompt);
              setSchedule((prev) => ({ ...prev, ...bp.schedule }));
            }}
          />
        )}
        {/* Name */}
        <div>
          <label className="text-xs text-fg-muted mb-1 block">Job Name</label>
          <input
            className="input w-full"
            placeholder="daily-health-check"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Schedule */}
        <div>
          <label className="text-xs text-fg-muted mb-1.5 block">Schedule</label>
          <ScheduleBuilder value={schedule} onChange={setSchedule} />
        </div>

        {/* Prompt */}
        <div>
          <label className="text-xs text-fg-muted mb-1 block">Agent Prompt</label>
          <textarea
            className="input min-h-[80px] w-full resize-y"
            placeholder="Check server health and report any issues…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        {/* Provider (optional) */}
        <div>
          <label className="text-xs text-fg-muted mb-1 block">Provider (optional)</label>
          <input
            className="input w-full"
            placeholder="minimax"
            list="cron-profile-suggestions"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
          <datalist id="cron-profile-suggestions">
            {profiles.map((p) => (
              <option key={p.name} value={p.name} />
            ))}
          </datalist>
        </div>
      </form>
    </Modal>
  );
}
