import { useState } from "react";
import { api } from "@/lib/api";
import { usePolling } from "@/hooks/usePolling";

export function useHealth() {
  const [status, setStatus] = useState<"ok" | "loading" | "error">("loading");
  const [uptime, setUptime] = useState<number | null>(null);

  async function check() {
    try {
      const res = await api.health();
      setStatus("ok");
      setUptime(res.uptime ?? null);
    } catch {
      setStatus("error");
    }
  }

  // Recursive setTimeout (not setInterval) via usePolling — guarantees the
  // next tick is scheduled only after the current fetch settles, so slow
  // responses can never pile up. The hook also guards against unmount leaks.
  usePolling(check, 10_000);

  return { status, uptime };
}
