import { describe, it, expect } from "vitest";
import {
  redactSensitiveText,
  maskSecret,
  type RedactOptions,
} from "./redact.js";

describe("redactSensitiveText", () => {
  describe("API key prefixes", () => {
    it("masks OpenAI keys", () => {
      const out = redactSensitiveText("key is sk-abcdefghijklmnopqrstuv");
      expect(out).not.toContain("sk-abcdefghijklmnopqrstuv");
      expect(out).toContain("sk-abc");
      expect(out).toContain("…");
    });

    it("masks GitHub PATs", () => {
      const out = redactSensitiveText("ghp_abcdefghijklmnopqrstuvwxyz");
      expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
      expect(out).toContain("ghp_");
    });

    it("masks AWS keys", () => {
      const out = redactSensitiveText("AKIAIOSFODNN7EXAMPLE");
      expect(out).toContain("…");
      expect(out).not.toContain("EXAMPLE");
    });

    it("masks Slack tokens", () => {
      // Construct to avoid triggering GitHub secret scanners in source
      const tok = ["xox" + "b", "1234567890", "abcdefghij" + "klmnopqrstuv"].join("-");
      const out = redactSensitiveText(tok);
      expect(out).toContain("…");
      expect(out).not.toContain(tok);
    });

    it("masks Google API keys", () => {
      const out = redactSensitiveText("AIzaSyD-abcdefghijklmnopqrstuvwxyz1234567");
      expect(out).toContain("…");
      expect(out).not.toContain("AIzaSyD-abcdefghijklmnopqrstuvwxyz1234567");
    });

    it("masks Stripe keys", () => {
      // Construct to avoid triggering GitHub secret scanners in source
      const tok = ["sk" + "_live_", "abcdefghij", "klmnopqrstuv1234"].join("");
      const out = redactSensitiveText(tok);
      expect(out).toContain("…");
    });

    it("preserves non-secret text", () => {
      const out = redactSensitiveText("hello world this is fine");
      expect(out).toBe("hello world this is fine");
    });
  });

  describe("ENV assignments", () => {
    it("masks API_KEY assignments", () => {
      const out = redactSensitiveText("OPENAI_API_KEY=sk-test123456789012345");
      expect(out).toContain("***");
      expect(out).not.toContain("sk-test123456789012345");
    });

    it("masks PASSWORD assignments", () => {
      const out = redactSensitiveText("DB_PASSWORD=secretpass123");
      expect(out).toContain("***");
    });

    it("preserves non-secret assignments", () => {
      const out = redactSensitiveText("PORT=3000");
      expect(out).toBe("PORT=3000");
    });
  });

  describe("JSON fields", () => {
    it("masks apiKey in JSON", () => {
      const out = redactSensitiveText('{"apiKey": "sk-secret123456789"}');
      expect(out).toContain("***");
      expect(out).not.toContain("sk-secret123456789");
    });

    it("masks token in JSON", () => {
      const out = redactSensitiveText('{"token": "abc123def456"}');
      expect(out).toContain("***");
    });
  });

  describe("auth headers", () => {
    it("masks Bearer tokens", () => {
      const out = redactSensitiveText("Authorization: Bearer eyJtest123");
      expect(out).toContain("***");
    });

    it("masks x-api-key", () => {
      const out = redactSensitiveText("x-api-key: secret123");
      expect(out).toContain("***");
    });
  });

  describe("PEM private keys", () => {
    it("masks full PEM blocks", () => {
      const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
      const out = redactSensitiveText(pem);
      expect(out).toBe("[REDACTED PRIVATE KEY]");
    });
  });

  describe("JWTs", () => {
    it("masks JWT tokens", () => {
      const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123";
      const out = redactSensitiveText(`token: ${jwt}`);
      expect(out).toContain("eyJ");
      expect(out).not.toContain("signature123");
    });
  });

  describe("DB connection strings", () => {
    it("masks password in connection string", () => {
      const out = redactSensitiveText("postgresql://user:secretpass@host:5432/db");
      expect(out).toContain("***");
      expect(out).not.toContain("secretpass");
      expect(out).toContain("postgresql://user:");
      expect(out).toContain("@host:5432/db");
    });
  });

  describe("URL bare tokens", () => {
    it("masks token in URL", () => {
      const out = redactSensitiveText("https://abcdefghijk@host.com/path");
      expect(out).toContain("***");
      expect(out).not.toContain("abcdefghijk@host.com");
    });
  });

  describe("Telegram bot tokens", () => {
    it("masks bot tokens", () => {
      const out = redactSensitiveText("123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456789");
      expect(out).toContain("***");
    });
  });

  describe("force option", () => {
    it("force=true redacts even when global toggle is off", () => {
      const oldEnv = process.env.MYA_REDACT_SECRETS;
      process.env.MYA_REDACT_SECRETS = "false";
      // Re-evaluate: the module-level const was already set, so we test force directly
      const out = redactSensitiveText("sk-test123456789012345", { force: true } as RedactOptions);
      expect(out).toContain("…");
      if (oldEnv === undefined) delete process.env.MYA_REDACT_SECRETS;
      else process.env.MYA_REDACT_SECRETS = oldEnv;
    });
  });

  describe("fileRead option", () => {
    it("uses non-reusable sentinel", () => {
      const out = redactSensitiveText("ghp_abcdefghijklmnopqrstuvwxyz", { fileRead: true });
      expect(out).toContain("«redacted:");
      expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    });
  });

  describe("redactUrlCredentials option", () => {
    it("redacts query param credentials when enabled", () => {
      const out = redactSensitiveText(
        "https://api.example.com/data?api_key=secret123",
        { redactUrlCredentials: true },
      );
      expect(out).toContain("api_key=***");
      expect(out).not.toContain("secret123");
    });

    it("does NOT redact query params by default", () => {
      const out = redactSensitiveText(
        "https://api.example.com/data?api_key=secret123",
      );
      expect(out).toContain("api_key=secret123");
    });

    it("redacts userinfo when enabled", () => {
      const out = redactSensitiveText(
        "https://user:pass@host.com/path",
        { redactUrlCredentials: true },
      );
      expect(out).toContain("***");
      expect(out).not.toContain("user:pass@host.com");
    });
  });
});

describe("maskSecret", () => {
  it("masks long tokens as first6…last4", () => {
    expect(maskSecret("ghp_abcdefghijklmnopqrstuvwxyz")).toBe("ghp_ab…wxyz");
  });

  it("masks short tokens as first4…", () => {
    expect(maskSecret("shortkey")).toBe("shor…");
  });

  it("nonReusable returns sentinel", () => {
    expect(maskSecret("ghp_abcdefghijklmnopqrstuvwxyz", { nonReusable: true })).toBe(
      "«redacted:ghp_ab…»",
    );
  });
});
