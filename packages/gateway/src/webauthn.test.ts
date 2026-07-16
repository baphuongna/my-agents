/**
 * @my-agent/gateway — WebAuthn endpoint tests (Phase 3-7).
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { Gateway } from "./index.js";
import { WebAuthnService } from "@my-agent/secrets";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpStore = join(tmpdir(), `mya-gw-webauthn-test-${process.pid}-${Date.now()}`, "creds.json");

afterEach(() => {
  if (existsSync(tmpStore)) rmSync(tmpStore, { force: true });
});

afterAll(() => {
  // Clean up the parent temp directory
  const parent = join(tmpStore, "..");
  if (existsSync(parent)) rmSync(parent, { recursive: true, force: true });
});

describe("Gateway WebAuthn endpoints", () => {
  it("GET /auth/webauthn/status returns enrolled=false for fresh store", async () => {
    mkdirSync(join(tmpStore, ".."), { recursive: true });
    const webAuthn = new WebAuthnService({ rpId: "localhost", origin: "http://localhost", storePath: tmpStore });
    const gw = new Gateway({ host: "127.0.0.1", port: 0, webAuthn });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/auth/webauthn/status`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body["enrolled"]).toBe(false);
      expect(body["credentialCount"]).toBe(0);
    } finally {
      await gw.stop();
    }
  });

  it("POST /auth/webauthn/challenge returns challengeId + options for register", async () => {
    mkdirSync(join(tmpStore, ".."), { recursive: true });
    const webAuthn = new WebAuthnService({ rpId: "localhost", origin: "http://localhost", storePath: tmpStore });
    const gw = new Gateway({ host: "127.0.0.1", port: 0, webAuthn });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/auth/webauthn/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "register" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body["challengeId"]).toBeTruthy();
      expect(body["options"]).toBeDefined();
    } finally {
      await gw.stop();
    }
  });

  it("POST /auth/webauthn/challenge rejects invalid kind", async () => {
    mkdirSync(join(tmpStore, ".."), { recursive: true });
    const webAuthn = new WebAuthnService({ rpId: "localhost", origin: "http://localhost", storePath: tmpStore });
    const gw = new Gateway({ host: "127.0.0.1", port: 0, webAuthn });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/auth/webauthn/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "bogus" }),
      });
      expect(res.status).toBe(400);
    } finally {
      await gw.stop();
    }
  });

  it("POST /auth/webauthn/verify returns 400 for unknown challenge", async () => {
    mkdirSync(join(tmpStore, ".."), { recursive: true });
    const webAuthn = new WebAuthnService({ rpId: "localhost", origin: "http://localhost", storePath: tmpStore });
    const gw = new Gateway({ host: "127.0.0.1", port: 0, webAuthn });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/auth/webauthn/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: "nonexistent", credential: {}, kind: "register" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body["error"]).toBeDefined();
    } finally {
      await gw.stop();
    }
  });

  it("endpoints return 404 when webAuthn service is not configured", async () => {
    const gw = new Gateway({ host: "127.0.0.1", port: 0 });
    const { port } = await gw.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/auth/webauthn/status`);
      expect(res.status).toBe(404);
    } finally {
      await gw.stop();
    }
  });
});
