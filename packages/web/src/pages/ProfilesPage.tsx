import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAsync } from "@/hooks/useAsync";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ErrorBox, LoadingSpinner, PageHeader } from "@/components/PageBits";
import { Users } from "lucide-react";

interface Profile { id: string; name: string; description?: string; active?: boolean }

async function loadProfiles(): Promise<Profile[]> {
  const response = await fetch("/profiles");
  if (!response.ok) throw new Error(`Unable to load profiles (${response.status})`);
  const body = await response.json() as Profile[] | { profiles: Profile[] };
  return Array.isArray(body) ? body : body.profiles;
}

export function ProfilesPage() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(loadProfiles, []);
  const [actionError, setActionError] = useState<string | null>(null);

  async function activate(profile: Profile) {
    setActionError(null);
    try {
      const response = await fetch(`/profiles/${encodeURIComponent(profile.id)}/activate`, { method: "POST" });
      if (!response.ok) throw new Error(`Unable to activate profile (${response.status})`);
      reload();
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
  }

  return <div className="p-4 max-w-4xl w-full mx-auto space-y-3">
    <PageHeader title="Profiles" icon={Users} actions={<Button variant="primary" onClick={() => navigate("/profiles/new")}>Create Profile</Button>} />
    {loading && !data && <LoadingSpinner label="Loading profiles…" />}
    {(error || actionError) && <ErrorBox message={error ?? actionError ?? "Unknown error"} />}
    <div className="grid sm:grid-cols-2 gap-2">{data?.map((profile) =>
      <Card key={profile.id} hover>
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{profile.name}</h2><p className="text-xs text-fg-muted mt-1">{profile.description || "No description"}</p></div>
          {profile.active ? <span className="text-[10px] uppercase text-success">Active</span> : <Button size="sm" onClick={() => void activate(profile)}>Make active</Button>}
        </div>
      </Card>)}</div>
  </div>;
}
