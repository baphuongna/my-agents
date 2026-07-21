/**
 * SkillsPage — skill registry viewer.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, LoadingSpinner, ErrorBox, EmptyState } from "@/components/PageBits";
import { Package, Search } from "lucide-react";

interface SkillInfo {
  name: string;
  description?: string;
  path?: string;
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    // Skills are managed by the agent, not a gateway endpoint.
    // Show known skills from the project structure.
    const knownSkills: SkillInfo[] = [
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
    setSkills(knownSkills);
    setLoading(false);
  }, []);

  const filtered = search
    ? skills.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.description ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : skills;

  return (
    <div className="p-4 max-w-4xl space-y-3">
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
        {filtered.map((skill) => (
          <Card key={skill.name} className="hover:border-accent/40 transition-colors">
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded bg-bg-elevated flex items-center justify-center shrink-0">
                <Package size={14} className="text-accent" />
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
    </div>
  );
}
