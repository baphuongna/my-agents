import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandRegistry,
  commandRegistry,
  type CommandHandler,
  type CommandContext,
} from "./command-registry.js";

const ctx: CommandContext = { source: "tui", user: "tester", sessionKey: "s1" };

function makeHandler(text: string): CommandHandler {
  return () => text;
}

describe("CommandRegistry — registration & lookup", () => {
  let reg: CommandRegistry;

  beforeEach(() => {
    reg = new CommandRegistry();
  });

  it("register stores a command retrievable by get()", () => {
    reg.register({ name: "ping", description: "pong", handler: makeHandler("pong") });
    const spec = reg.get("ping");
    expect(spec).toBeDefined();
    expect(spec!.name).toBe("ping");
    expect(spec!.description).toBe("pong");
  });

  it("get returns undefined for an unregistered command", () => {
    expect(reg.get("nope")).toBeUndefined();
  });

  it("register overwrites a command with the same name", () => {
    reg.register({ name: "x", description: "v1", handler: makeHandler("1") });
    reg.register({ name: "x", description: "v2", handler: makeHandler("2") });
    const spec = reg.get("x");
    expect(spec!.description).toBe("v2");
  });

  it("list returns all registered commands", () => {
    reg.register({ name: "a", description: "aa", handler: makeHandler("a") });
    reg.register({ name: "b", description: "bb", handler: makeHandler("b") });
    const names = reg.list().map((c) => c.name);
    expect(names).toHaveLength(2);
    expect(names).toContain("a");
    expect(names).toContain("b");
  });

  it("list returns empty array when nothing is registered", () => {
    expect(reg.list()).toEqual([]);
  });
});

describe("CommandRegistry — alias resolution", () => {
  let reg: CommandRegistry;

  beforeEach(() => {
    reg = new CommandRegistry();
  });

  it("alias maps a shortcut to a canonical command", () => {
    reg.register({ name: "audit", description: "run audit", handler: makeHandler("audited") });
    reg.alias("a", "audit");
    const spec = reg.get("a");
    expect(spec).toBeDefined();
    expect(spec!.name).toBe("audit");
  });

  it("get falls back to the literal name when no alias matches", () => {
    reg.register({ name: "audit", description: "x", handler: makeHandler("ok") });
    const spec = reg.get("audit");
    expect(spec).toBeDefined();
    expect(spec!.name).toBe("audit");
  });

  it("alias for a non-existent canonical returns undefined", () => {
    reg.alias("z", "ghost");
    expect(reg.get("z")).toBeUndefined();
  });
});

describe("CommandRegistry — tryExecute", () => {
  let reg: CommandRegistry;

  beforeEach(() => {
    reg = new CommandRegistry();
    reg.register({
      name: "echo",
      description: "echo args",
      handler: (args: string) => `echoed: ${args}`,
    });
    reg.register({
      name: "fail",
      description: "always throws",
      handler: () => {
        throw new Error("boom");
      },
    });
    reg.register({
      name: "async",
      description: "async handler",
      handler: async (args: string) => `async:${args}`,
    });
  });

  it("returns null for a non-command message (no leading /)", async () => {
    const res = await reg.tryExecute("hello world", ctx);
    expect(res).toBeNull();
  });

  it("returns null for an empty message", async () => {
    const res = await reg.tryExecute("", ctx);
    expect(res).toBeNull();
  });

  it("returns null for a whitespace-only message", async () => {
    const res = await reg.tryExecute("   ", ctx);
    expect(res).toBeNull();
  });

  it("executes a registered command and returns output", async () => {
    const res = await reg.tryExecute("/echo hello", ctx);
    expect(res).not.toBeNull();
    expect(res!.command).toBe("echo");
    expect(res!.output).toBe("echoed: hello");
  });

  it("passes through multiple space-separated args joined by space", async () => {
    const res = await reg.tryExecute("/echo foo bar baz", ctx);
    expect(res!.output).toBe("echoed: foo bar baz");
  });

  it("strips surrounding double quotes from multi-word args", async () => {
    const res = await reg.tryExecute('/echo "hello world"', ctx);
    expect(res!.output).toBe("echoed: hello world");
  });

  it("supports async handlers", async () => {
    const res = await reg.tryExecute("/async done", ctx);
    expect(res!.output).toBe("async:done");
  });

  it("catches handler errors and returns an error message", async () => {
    const res = await reg.tryExecute("/fail", ctx);
    expect(res).not.toBeNull();
    expect(res!.output).toContain("Error executing /fail");
    expect(res!.output).toContain("boom");
  });

  it("returns 'Unknown command' for an unregistered command, listing available", async () => {
    const res = await reg.tryExecute("/nope", ctx);
    expect(res).not.toBeNull();
    expect(res!.output).toContain("Unknown command: /nope");
    expect(res!.output).toContain("echo");
  });

  it("command name is case-insensitive", async () => {
    const res = await reg.tryExecute("/ECHO hi", ctx);
    expect(res!.command).toBe("echo");
    expect(res!.output).toBe("echoed: hi");
  });

  it("resolves aliases during execution", async () => {
    reg.alias("e", "echo");
    const res = await reg.tryExecute("/e via-alias", ctx);
    expect(res!.output).toBe("echoed: via-alias");
  });

  it("passes the CommandContext to the handler", async () => {
    let received: CommandContext | null = null;
    reg.register({
      name: "ctx",
      description: "captures ctx",
      handler: (_args, c) => {
        received = c;
        return "ok";
      },
    });
    await reg.tryExecute("/ctx", ctx);
    expect(received).toBe(ctx);
  });

  it("handles a bare / with no command name", async () => {
    const res = await reg.tryExecute("/", ctx);
    expect(res).toBeNull();
  });
});

describe("CommandRegistry — isCommand", () => {
  const reg = new CommandRegistry();

  it("returns true for messages starting with /", () => {
    expect(reg.isCommand("/help")).toBe(true);
  });

  it("returns true even with leading whitespace before /", () => {
    expect(reg.isCommand("   /help")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(reg.isCommand("just text")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(reg.isCommand("")).toBe(false);
  });
});

describe("CommandRegistry — helpText", () => {
  it("lists all commands with their descriptions", () => {
    const reg = new CommandRegistry();
    reg.register({ name: "audit", description: "Run audit", handler: makeHandler("") });
    reg.register({ name: "status", description: "Show status", handler: makeHandler("") });
    const text = reg.helpText();
    expect(text).toContain("Available commands");
    expect(text).toContain("/audit — Run audit");
    expect(text).toContain("/status — Show status");
  });

  it("returns just the header when no commands registered", () => {
    const reg = new CommandRegistry();
    const text = reg.helpText();
    expect(text).toContain("Available commands");
  });
});

describe("commandRegistry singleton", () => {
  it("is an instance of CommandRegistry", () => {
    expect(commandRegistry).toBeInstanceOf(CommandRegistry);
  });
});
