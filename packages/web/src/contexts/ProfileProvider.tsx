import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api, setManagementProfile } from "@/lib/api";
import { ProfileContext } from "@/contexts/profile-context";

/**
 * Machine-level management-profile scope.
 *
 * One switcher (rendered in the sidebar) decides which profile every
 * management page reads/writes. React STATE is the source of truth; the
 * URL (`?profile=<name>`) is a synchronized projection of it so deep links
 * land scoped and refresh survives. The selection is mirrored into the api
 * module so `fetchJSON` transparently appends it to the profile-scoped
 * endpoint families. "" = the dashboard's own profile.
 *
 * Why state-first instead of URL-first: sidebar nav links are bare paths
 * (`/config`, `/skills`). A URL-derived scope would silently reset to the
 * dashboard's own profile on every nav click — the switcher would LOOK
 * global while normal navigation dropped the write target. With state as
 * truth, the effect below re-asserts `?profile=` onto the new location
 * after each navigation, so the scope survives nav and stays deep-linkable.
 *
 * Adapted from the Hermes M2 pattern; mya's active-profile API returns a
 * single `{ name }` (no separate "current" vs "sticky active" distinction),
 * so currentProfile = active profile name.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const [profiles, setProfiles] = useState<string[]>([]);
  const [currentProfile, setCurrentProfile] = useState("default");

  // Initial value comes from the URL (deep link / refresh); afterwards
  // state leads and the URL follows.
  const [profile, setProfileState] = useState(
    () => searchParams.get("profile") ?? "",
  );

  // Mirror into the api module synchronously on every render where it
  // changed, so fetches fired by child effects in the same commit see it.
  setManagementProfile(profile);

  // A profile param arriving via in-app navigation must win over current
  // state — it's an explicit scope request.
  const urlProfile = searchParams.get("profile");
  useEffect(() => {
    if (urlProfile !== null && urlProfile !== profile) {
      setManagementProfile(urlProfile);
      setProfileState(urlProfile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlProfile]);

  // Re-assert ?profile= after navigations that dropped it (bare nav links).
  // Runs on every pathname/profile change; no-ops when already in sync.
  useEffect(() => {
    const inUrl = searchParams.get("profile") ?? "";
    if ((profile || "") === inUrl) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (profile) next.set("profile", profile);
        else next.delete("profile");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, profile]);

  useEffect(() => {
    let cancelled = false;
    const initialUrlProfile = searchParams.get("profile");

    Promise.all([api.getProfiles(), api.getActiveProfile()])
      .then(([profilesRes, info]) => {
        if (cancelled) return;

        setProfiles(profilesRes.profiles.map((p) => p.name));

        const active = info.name || "default";
        setCurrentProfile(active);

        // Deep links (?profile=) win. Otherwise align the switcher with the
        // active profile so Chat and management pages match what the
        // Profiles page shows as "active".
        if (initialUrlProfile === null) {
          setManagementProfile(active);
          setProfileState(active);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setProfile = useCallback(
    (name: string) => {
      setManagementProfile(name);
      setProfileState(name);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (name) next.set("profile", name);
          else next.delete("profile");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const value = useMemo(
    () => ({ profile, currentProfile, profiles, setProfile }),
    [profile, currentProfile, profiles, setProfile],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}
