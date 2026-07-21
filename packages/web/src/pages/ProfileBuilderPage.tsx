import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorBox, LoadingSpinner, PageHeader } from "@/components/PageBits";
import { WandSparkles } from "lucide-react";

interface Option { id: string; name: string }
interface BuilderOptions { models: Option[]; skills: Option[]; mcpServers: Option[] }
const steps = ["Identity", "Model", "Skills", "MCP servers", "Review"];

export function ProfileBuilderPage() {
  const [step, setStep] = useState(0);
  const [options, setOptions] = useState<BuilderOptions | null>(null);
  const [name, setName] = useState(""); const [model, setModel] = useState("");
  const [skills, setSkills] = useState<string[]>([]); const [servers, setServers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);

  useEffect(() => { let cancelled = false; Promise.all(["/models", "/skills", "/mcp/servers"].map(async (url) => {
    const response = await fetch(url); if (!response.ok) throw new Error(`Unable to load ${url} (${response.status})`); return response.json() as Promise<unknown>;
  })).then(([models, loadedSkills, mcpServers]) => { if (!cancelled) setOptions({ models: normalize(models, "models"), skills: normalize(loadedSkills, "skills"), mcpServers: normalize(mcpServers, "servers") }); })
    .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, []);

  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(null); try { const response = await fetch("/profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, model, skills, mcpServers: servers }) }); if (!response.ok) throw new Error(`Unable to create profile (${response.status})`); setSaved(true); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setSaving(false); } }
  const toggle = (value: string, values: string[], setter: (next: string[]) => void) => setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);

  return <div className="p-4 max-w-3xl w-full mx-auto space-y-3"><PageHeader title="Profile Builder" icon={WandSparkles} />
    <div className="flex gap-2 text-xs">{steps.map((label, index) => <span key={label} className={index === step ? "text-accent font-semibold" : "text-fg-subtle"}>{index + 1}. {label}</span>)}</div>
    {loading && <LoadingSpinner label="Loading builder options…" />}{error && <ErrorBox message={error} />}
    {!loading && options && <Card><form onSubmit={(event) => void submit(event)} className="space-y-4">
      {step === 0 && <label className="block text-sm">Profile name<input required className="input block w-full mt-1" value={name} onChange={(e) => setName(e.target.value)} /></label>}
      {step === 1 && <label className="block text-sm">Model<select required className="input block w-full mt-1" value={model} onChange={(e) => setModel(e.target.value)}><option value="">Select a model</option>{options.models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {step === 2 && <Checks options={options.skills} selected={skills} toggle={(id) => toggle(id, skills, setSkills)} />}
      {step === 3 && <Checks options={options.mcpServers} selected={servers} toggle={(id) => toggle(id, servers, setServers)} />}
      {step === 4 && <pre className="text-xs whitespace-pre-wrap">{JSON.stringify({ name, model, skills, mcpServers: servers }, null, 2)}</pre>}
      {saved && <p className="text-success text-sm">Profile created.</p>}<div className="flex justify-between"><Button type="button" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>Back</Button>{step < 4 ? <Button type="button" variant="primary" onClick={() => setStep((value) => value + 1)}>Next</Button> : <Button type="submit" variant="primary" disabled={saving}>{saving ? "Creating…" : "Create profile"}</Button>}</div>
    </form></Card>}
  </div>;
}

function normalize(value: unknown, key: string): Option[] { const record = value as Record<string, unknown>; const list = Array.isArray(value) ? value : Array.isArray(record?.[key]) ? record[key] as unknown[] : []; return list.map((item) => typeof item === "string" ? { id: item, name: item } : { id: String((item as Option).id ?? (item as Option).name), name: String((item as Option).name ?? (item as Option).id) }); }
function Checks({ options, selected, toggle }: { options: Option[]; selected: string[]; toggle: (id: string) => void }) { return <div className="grid sm:grid-cols-2 gap-2">{options.map((item) => <label key={item.id} className="text-sm"><input type="checkbox" className="mr-2" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />{item.name}</label>)}</div>; }
