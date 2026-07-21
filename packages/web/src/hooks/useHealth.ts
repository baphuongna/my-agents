import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function useHealth() {
  const [status, setStatus] = useState<"ok" | "loading" | "error">("loading");
  const [uptime, setUptime] = useState<number | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    async function check() {
      try {
        const res = await api.health();
        setStatus("ok");
        setUptime(res.uptime ?? null);
      } catch {
        setStatus("error");
      }
    }

    check();
    timer = setInterval(check, 10000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  return { status, uptime };
}
