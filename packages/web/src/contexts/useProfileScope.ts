import { useContext } from "react";
import { ProfileContext } from "@/contexts/profile-context";

/** Consumer hook for the profile scope. */
export function useProfileScope() {
  return useContext(ProfileContext);
}
