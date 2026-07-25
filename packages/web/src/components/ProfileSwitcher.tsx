import { useMemo } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProfileScope } from "@/contexts/useProfileScope";

/**
 * The dashboard's single write-target selector.
 *
 * Rendered in the sidebar. Every management page (Config, Skills, MCP,
 * Models, Cron, Sessions) reads/writes the selected profile via the
 * fetchJSON ?profile= injection. Hidden when only one profile exists.
 *
 * Amber styling flags when the switcher targets a profile OTHER than the
 * dashboard's own — every management write (config, skills, MCPs, model)
 * and sessions land in that profile.
 */
export function ProfileSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { profile, currentProfile, profiles, setProfile } = useProfileScope();

  const label = useMemo(
    () => `this dashboard (${currentProfile || "default"})`,
    [currentProfile],
  );

  // Hidden when fewer than 2 profiles (Hermes pattern).
  if (profiles.length < 2) return null;

  const isOther = !!profile && profile !== currentProfile;
  const selectId = "mya-profile-switcher";

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border/30 px-3 py-1.5",
        collapsed && "lg:justify-center lg:px-0",
      )}
      title="Managing profile"
    >
      <Users
        size={14}
        className={cn("shrink-0", isOther ? "text-amber-400" : "text-fg-subtle")}
      />
      <select
        id={selectId}
        data-testid="profile-switcher-select"
        className={cn(
          "input min-w-0 flex-1 py-1 text-xs",
          collapsed && "lg:hidden",
          isOther && "border-amber-500/60 text-amber-400",
        )}
        value={profile}
        onChange={(e) => setProfile(e.target.value)}
        aria-label="Profile scope"
      >
        <option value="">{label}</option>
        {profiles
          .filter((name) => name !== currentProfile)
          .map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
      </select>
      {collapsed && <span className="sr-only">{profile || label}</span>}
    </div>
  );
}
