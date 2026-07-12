/**
 * @my-agent/print — Shared command registry.
 *
 * Both the TUI (pi bridge) and channels (Telegram/Discord/Slack) share the
 * SAME command set. A user sending "/audit" via Telegram gets the same result
 * as typing /audit in the TUI.
 *
 * Architecture:
 *   1. CommandRegistry stores all command handlers (name → handler)
 *   2. mya-bridge registers commands into BOTH pi (for TUI) AND CommandRegistry
 *   3. ChannelSessionRouter checks incoming messages for "/" prefix → CommandRegistry
 *   4. If command found → execute → return result as channel response
 *   5. If not a command → run as agent prompt (normal LLM turn)
 */

/** A command handler — receives args string + context, returns response text. */
export interface CommandHandler {
  (args: string, ctx: CommandContext): Promise<string> | string;
}

/** Context passed to command handlers. */
export interface CommandContext {
  /** Channel id (e.g. "telegram", "tui") — handlers can adapt output format. */
  source: string;
  /** User identifier (for channels: username; for TUI: "tui"). */
  user: string;
  /** Session key (for channels: composite; for TUI: pi session). */
  sessionKey: string;
}

export interface CommandSpec {
  name: string;
  description: string;
  handler: CommandHandler;
}

/**
 * Registry of slash commands shared across TUI + all channels.
 * Single source of truth — the bridge populates it, channels consume it.
 */
export class CommandRegistry {
  private commands = new Map<string, CommandSpec>();
  private aliases = new Map<string, string>(); // alias → canonical name

  /** Register a command. */
  register(spec: CommandSpec): void {
    this.commands.set(spec.name, spec);
  }

  /** Register an alias (e.g. "a" → "audit"). */
  alias(shortcut: string, canonical: string): void {
    this.aliases.set(shortcut, canonical);
  }

  /** Get a command by name or alias. */
  get(name: string): CommandSpec | undefined {
    const canonical = this.aliases.get(name) ?? name;
    return this.commands.get(canonical);
  }

  /** List all registered commands. */
  list(): CommandSpec[] {
    return [...this.commands.values()];
  }

  /**
   * Try to execute a message as a command. Returns null if not a command.
   * Messages starting with "/" are treated as commands.
   */
  async tryExecute(
    message: string,
    ctx: CommandContext,
  ): Promise<{ output: string; command: string } | null> {
    const trimmed = message.trim();
    if (!trimmed.startsWith("/")) return null;

    // Parse: /command arg1 arg2 "multi word arg"
    const parts = trimmed.slice(1).match(/(?:[^\s"]+|"[^"]*")+/g);
    if (!parts || parts.length === 0) return null;

    const cmdName = parts[0]!.toLowerCase();
    const args = parts.slice(1).map((p) => p.replace(/^"|"$/g, "")).join(" ");

    const spec = this.get(cmdName);
    if (!spec) {
      return {
        output: `Unknown command: /${cmdName}. Available: ${this.list().map((c) => c.name).join(", ")}`,
        command: cmdName,
      };
    }

    try {
      const output = await spec.handler(args, ctx);
      return { output, command: cmdName };
    } catch (e) {
      return {
        output: `Error executing /${cmdName}: ${(e as Error).message}`,
        command: cmdName,
      };
    }
  }

  /** Check if a message is a command (starts with /). */
  isCommand(message: string): boolean {
    return message.trim().startsWith("/");
  }

  /** Generate a help string listing all commands. */
  helpText(): string {
    const lines = this.list().map((c) => `  /${c.name} — ${c.description}`);
    return `Available commands:\n${lines.join("\n")}`;
  }
}

/** Global shared command registry (singleton — import from anywhere). */
export const commandRegistry = new CommandRegistry();
