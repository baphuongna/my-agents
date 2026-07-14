/**
 * @my-agent/gateway — mobile endpoint tests (SSE, models, repos, takeover/release).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Gateway } from "./index.js";

const reposPath = join(homedir(), ".mya", "repos.json");
let savedRepos: string | null = null;

/** Save repos.json before tests that write to it, restore after. */
function saveRepos(): void {
  try {
    savedRepos = readFileSync(reposPath, "utf-8");
  } catch {
    savedRepos = null;
  }
}

function restoreRepos(): void {
  if (savedRepos !== null) {
    // File existed before — restore original content
    writeFileSync(reposPath, savedRepos, "utf-8");
  } else if (existsSync(reposPath)) {
    // File was created by the test — remove it
    try { rmSync(reposPath); } catch { /* best-effort */ }
  }
}

afterEach(() => {
  restoreRepos();
});

describe("Gateway mobile endpoints", () => {
  it("GET /models returns array with provider/id/name fields", async () => {
    const gw = new Gateway({ host: "127.0.0.1", port: 0 });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/models`);
      expect(res.status).toBe(200);
      const models = await res.json() as Array<Record<string, unknown>>;
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]!).toHaveProperty("provider");
      expect(models[0]!).toHaveProperty("id");
      expect(models[0]!).toHaveProperty("name");
    } finally {
      await gw.stop();
    }
  });

  it("POST /repos adds a repo and GET /repos includes it", async () => {
    saveRepos();
    const gw = new Gateway({ host: "127.0.0.1", port: 0 });
    const { port } = await gw.start();
    try {
      const cwd = process.cwd();
      const postRes = await fetch(`http://127.0.0.1:${port}/repos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      expect(postRes.status).toBe(201);
      const postBody = await postRes.json() as Record<string, unknown>;
      expect(postBody["ok"]).toBe(true);

      const getRes = await fetch(`http://127.0.0.1:${port}/repos`);
      expect(getRes.status).toBe(200);
      const repos = await getRes.json() as string[];
      expect(Array.isArray(repos)).toBe(true);
      expect(repos).toContain(cwd);
    } finally {
      await gw.stop();
    }
  });

  it("POST /repos with non-existent cwd returns 400", async () => {
    const gw = new Gateway({ host: "127.0.0.1", port: 0 });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/repos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd: "/nonexistent/path/that/should/not/exist" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body["error"]).toBeDefined();
    } finally {
      await gw.stop();
    }
  });

  it("POST /sessions/:id/takeover sets controller and returns 200", async () => {
    const gw = new Gateway({ host: "127.0.0.1", port: 0 });
    const { port } = await gw.start();
    try {
      gw.control.registerSession("test-takeover");
      const res = await fetch(`http://127.0.0.1:${port}/sessions/test-takeover/takeover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: "client-1" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body["ok"]).toBe(true);
      expect(body["controllerClientId"]).toBe("client-1");
    } finally {
      await gw.stop();
    }
  });

  it("POST /sessions/:id/release clears controller and returns 200", async () => {
    const gw = new Gateway({ host: "127.0.0.1", port: 0 });
    const { port } = await gw.start();
    try {
      gw.control.registerSession("test-release");
      // First takeover
      await fetch(`http://127.0.0.1:${port}/sessions/test-release/takeover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: "client-1" }),
      });
      // Then release
      const res = await fetch(`http://127.0.0.1:${port}/sessions/test-release/release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: "client-1" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body["ok"]).toBe(true);
    } finally {
      await gw.stop();
    }
  });

  it("GET /sessions/:id/events returns SSE stream headers and init event", async () => {
    const gw = new Gateway({ host: "127.0.0.1", port: 0 });
    const { port } = await gw.start();
    try {
      gw.control.registerSession("sse-test");
      const res = await fetch(`http://127.0.0.1:${port}/sessions/sse-test/events`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      // Read initial data line
      const reader = res.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        expect(text).toContain("data:");
        expect(text).toContain("yourClientId");
      }
    } finally {
      await gw.stop();
    }
  });

  it("POST /sessions/:id/release by non-controller returns 403", async () => {
    const gw = new Gateway({ host: "127.0.0.1", port: 0 });
    const { port } = await gw.start();
    try {
      gw.control.registerSession("test-403");
      // Client-1 takes over
      await fetch(`http://127.0.0.1:${port}/sessions/test-403/takeover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: "client-1" }),
      });
      // Client-2 tries to release
      const res = await fetch(`http://127.0.0.1:${port}/sessions/test-403/release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: "client-2" }),
      });
      expect(res.status).toBe(403);
    } finally {
      await gw.stop();
    }
  });
});
