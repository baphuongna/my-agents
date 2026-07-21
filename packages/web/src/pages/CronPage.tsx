import { useState } from "react";
import { useAsync } from "@/hooks/useAsync";
import { api, type CronJob } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader, LoadingSpinner, ErrorBox } from "./SessionsPage";
import { Clock, Play, Trash2, RefreshCw, Plus, Pause } from "lucide-react";
import { timeAgo, formatTime } from "@/lib/utils";

export function CronPage() {
  const { data: jobs, loading, error, reload } = useAsync(
    () => api.cronJobs(),
    [],
    10000,
  );
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="p-4 space-y-4">
      <PageHeader
        title="Cron Jobs"
        icon={Clock}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={reload}>
              <RefreshCw size={13} /> Refresh
            </Button>
            <Button size="sm" variant="primary" onClick={() => setShowAdd(!showAdd)}>
              <Plus size={13} /> Add Job
            </Button>
          </>
        }
      />

      {showAdd && <AddJobForm onDone={reload} onCancel={() => setShowAdd(false)} />}

      {loading && !jobs && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}

      {jobs && jobs.length === 0 && (
        <Card>
          <p className="text-fg-muted text-sm text-center py-8">
            No cron jobs configured. Click <strong>Add Job</strong> to create one.
          </p>
        </Card>
      )}

      {jobs && jobs.length > 0 && (
        <div className="grid gap-2">
          {jobs.map((job) => (
            <CronJobRow key={job.id} job={job} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function CronJobRow({ job, onChanged }: { job: CronJob; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await api.cronPatch(job.id, { enabled: !job.enabled });
      onChanged();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    try {
      await api.cronRun(job.id);
      onChanged();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm(`Delete job "${job.name}"?`)) return;
    setBusy(true);
    try {
      await api.cronDelete(job.id);
      onChanged();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <button
              className="text-fg font-medium text-sm hover:text-accent"
              onClick={() => setExpanded(!expanded)}
            >
              {job.name}
            </button>
            {job.enabled ? (
              <Badge color="green">enabled</Badge>
            ) : (
              <Badge color="gray">disabled</Badge>
            )}
            {job.jobType && <Badge color="blue">{job.jobType}</Badge>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-fg-muted font-mono">
            <span>{job.schedule}</span>
            <span>next: {timeAgo(job.nextRunAt)}</span>
            <span>last: {timeAgo(job.lastRunAt)}</span>
          </div>
          {expanded && (
            <div className="mt-2 space-y-1 text-[11px] text-fg-muted">
              {job.prompt && (
                <div>
                  <span className="text-fg-subtle">Prompt:</span>{" "}
                  <code className="text-fg">{job.prompt}</code>
                </div>
              )}
              {job.shellCommand && (
                <div>
                  <span className="text-fg-subtle">Shell:</span>{" "}
                  <code className="text-orange">{job.shellCommand}</code>
                </div>
              )}
              {job.provider && (
                <div>
                  <span className="text-fg-subtle">Provider:</span> {job.provider}
                  {job.model && ` / ${job.model}`}
                </div>
              )}
              {job.deliveryTargets && job.deliveryTargets.length > 0 && (
                <div>
                  <span className="text-fg-subtle">Delivery:</span>{" "}
                  {job.deliveryTargets.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={run} disabled={busy} title="Run now">
            <Play size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={toggle} disabled={busy} title={job.enabled ? "Disable" : "Enable"}>
            {job.enabled ? <Pause size={13} /> : <Play size={13} />}
          </Button>
          <Button size="sm" variant="ghost" onClick={del} disabled={busy} title="Delete">
            <Trash2 size={13} className="text-danger" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AddJobForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !schedule) return;
    setBusy(true);
    try {
      await api.cronAdd({ name, schedule, prompt: prompt || undefined, enabled: true });
      onDone();
      onCancel();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">New Cron Job</h3>
        <div className="grid grid-cols-2 gap-2">
          <input
            className="input"
            placeholder="Job name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="input font-mono"
            placeholder="* * * * *"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            required
          />
        </div>
        <textarea
          className="input min-h-[60px] w-full resize-y"
          placeholder="Prompt for the agent…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create Job"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
