/**
 * SkillsPage — skill registry viewer.
 */
import { useEffect, useState } from "react";
import { api, type SkillInfo, type ToolInfo } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox, EmptyState } from "@/components/PageBits";
import { Package, Search, Wrench } from "lucide-react";
import { PluginSlot } from "@/components/PluginSlot";

/** Static fallback shown when the gateway has no /skills endpoint wired. */
const FALLBACK_SKILLS: SkillInfo[] = [
  { name: "code-optimizer", description: "Deep code optimization audit using parallel specialist agents" },
  { name: "lint", description: "Lint and format code with auto-fix" },
  { name: "review", description: "Review code changes for security, performance, bugs" },
  { name: "security-review", description: "Threat-model-driven security review (STRIDE)" },
  { name: "tdd", description: "Test-driven development red-green-refactor" },
  { name: "test", description: "Generate or run tests; auto-detects framework" },
  { name: "council", description: "Spawn 3 adversarial subagents (Skeptic, Pragmatist, Critic)" },
  { name: "orchestration", description: "Multi-phase orchestration for planners and executors" },
  { name: "systematic-debugging", description: "Four-phase debugging discipline with refuse gates" },
  { name: "post-mortem", description: "Write engineering RCA record after bug is fixed" },
  { name: "git-master", description: "Commit and release hygiene for safe version-control work" },
  { name: "iterative-audit", description: "Iterative multi-round codebase audit" },
  { name: "memory-store", description: "Store knowledge in persistent memory" },
  { name: "memory-search", description: "Search persistent memory for relevant knowledge" },
  { name: "browser-automation", description: "Headless browser automation and web scraping" },
];

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  // Agent toolset loaded in parallel with skills (allSettled) — a failing
  // /tools endpoint never blocks the skills list.
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Parallel load: skills + tools settle independently. When the
    // gateway has no /skills endpoint we fall back to the static list so
    // the page is always useful (Hermes allSettled pattern).
    Promise.allSettled([api.skills(), api.tools()]).then(([skillsR, toolsR]) => {
      if (cancelled) return;
      setSkills(skillsR.status === "fulfilled" ? skillsR.value : FALLBACK_SKILLS);
      if (toolsR.status === "fulfilled") setTools(toolsR.value);
      setError(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = search
    ? skills.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : skills;

  return (
    <div className="p-4 max-w-4xl w-full mx-auto space-y-3">
      {/* Plugin injection seam — top of skills. */}
      <PluginSlot name="skills:top" />

      <PageHeader
        title="Skills"
        icon={Package}
        actions={
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input
              className="input pl-7 text-xs w-40"
              placeholder="Search skills…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      />

      {loading && <LoadingSpinner />}
      {error && <ErrorBox message={error} />}
      {!loading && filtered.length === 0 && (
        <EmptyState icon={Package} title="No skills found" />
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        {filtered.map((skill, idx) => (
          <Card
            key={skill.name}
            hover
            className="animate-fade-in-up"
            style={{ animationDelay: `${Math.min(idx * 40, 320)}ms` }}
          >
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded gradient-accent flex items-center justify-center shrink-0 shadow-sm">
                <Package size={14} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <code className="text-[13px] text-accent font-mono">{skill.name}</code>
                {skill.description && (
                  <p className="text-[11px] text-fg-muted mt-0.5">{skill.description}</p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Agent toolset (loaded in parallel with skills) */}
      {tools && tools.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-1.5 flex items-center gap-1.5">
            <Wrench size={12} /> Available Tools
            <Badge color="gray">{tools.length}</Badge>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <Badge key={t.name} color="blue">
                <code className="font-mono text-[11px]">{t.name}</code>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Plugin injection seam — bottom of skills. */}
      <PluginSlot name="skills:bottom" />
    </div>
  );
}
