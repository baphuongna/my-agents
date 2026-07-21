/**
 * ChatPage — chat with the agent from the browser.
 * Uses gateway pool API: POST /pool/acquire + POST /pool/prompt/:id
 * Streams responses via WebSocket /events filtered by sessionId.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { eventClient, type GatewayEvent } from "@/lib/ws";
import { PageHeader } from "@/components/PageBits";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/Markdown";
import { ModelPickerDialog } from "@/components/ModelPickerDialog";
import { useToast } from "@/lib/toast";
import {
  Terminal,
  Send,
  Loader2,
  Wrench,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Cpu,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { postJSON } from "@/lib/api";

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  streaming?: boolean;
  collapsed?: boolean;
}

export function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [activeModel, setActiveModel] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  // Connect WS
  useEffect(() => {
    eventClient.connect();
    const unsubStatus = eventClient.onStatus(setWsConnected);
    return unsubStatus;
  }, []);

  // Listen for events scoped to our session
  useEffect(() => {
    if (!sessionId) return;
    const unsub = eventClient.onEvent((ev) => {
      if (ev.sessionId !== sessionId) return;
      handleEvent(ev);
    });
    return unsub;
  }, [sessionId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleEvent = useCallback((ev: GatewayEvent) => {
    const type = ev.type;
    const payload = ev as Record<string, unknown>;

    if (type === "message/delta" || type === "message_delta" || type === "response/delta") {
      const delta = (payload.text ?? payload.delta ?? payload.content ?? "") as string;
      if (!delta) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
        }
        return [...prev, { role: "assistant", content: delta, streaming: true }];
      });
    } else if (type === "turn/end" || type === "turn_end" || type === "response/end" || type === "message/end") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev;
      });
      setBusy(false);
    } else if (type === "tool/call" || type === "tool_call") {
      const name = (payload.name ?? payload.toolName ?? "tool") as string;
      setMessages((prev) => [
        ...prev,
        { role: "tool", content: `Using ${name}…`, toolName: name, collapsed: false },
      ]);
    } else if (type === "tool/result" || type === "tool_result") {
      const result = (payload.output ?? payload.result ?? "") as string;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "tool") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: typeof result === "string" ? result.slice(0, 500) : JSON.stringify(result).slice(0, 500) },
          ];
        }
        return prev;
      });
    } else if (type === "error") {
      const msg = (payload.message ?? payload.error ?? "Unknown error") as string;
      setMessages((prev) => [...prev, { role: "system", content: `Error: ${msg}` }]);
      setBusy(false);
    }
  }, []);

  async function acquireSession() {
    try {
      const res = await postJSON<{ sessionId: string }>("/pool/acquire", {
        cwd: ".",
      });
      setSessionId(res.sessionId);
      toast("Session started", "success");
      return res.sessionId;
    } catch (e) {
      toast(`Failed to start session: ${e instanceof Error ? e.message : e}`, "error");
      return null;
    }
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;

    let sid = sessionId;
    if (!sid) {
      sid = await acquireSession();
      if (!sid) return;
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setBusy(true);

    try {
      await postJSON(`/pool/prompt/${sid}`, { text });
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `Failed to send: ${e instanceof Error ? e.message : e}` },
      ]);
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function reset() {
    setMessages([]);
    setSessionId(null);
    setBusy(false);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
        <Terminal size={16} className="text-accent" />
        <h1 className="text-sm font-semibold text-fg">Chat</h1>
        <div className="flex-1" />
        {activeModel && (
          <button
            className="btn-secondary text-[11px] gap-1"
            onClick={() => setModelPickerOpen(true)}
          >
            <Cpu size={11} />
            {activeModel}
          </button>
        )}
        {!activeModel && (
          <button
            className="btn-ghost text-[11px] gap-1"
            onClick={() => setModelPickerOpen(true)}
          >
            <Settings size={11} />
            Select model
          </button>
        )}
        {sessionId && (
          <Badge color="blue" className="font-mono">
            {sessionId.slice(0, 12)}
          </Badge>
        )}
        <Badge color={wsConnected ? "green" : "red"}>
          {wsConnected ? "connected" : "disconnected"}
        </Badge>
        {messages.length > 0 && (
          <button className="btn-ghost" onClick={reset} title="New conversation">
            <RotateCcw size={13} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Terminal size={36} className="text-fg-subtle mb-3" />
            <p className="text-fg-muted text-sm font-medium">Start a conversation</p>
            <p className="text-fg-subtle text-xs mt-1">
              Type a message below to chat with the agent
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-3">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} onToggle={() => toggleCollapse(i)} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border p-3 bg-bg-surface">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              className="input min-h-[40px] max-h-32 w-full resize-y pr-10"
              placeholder={sessionId ? "Type a message…  (Enter to send, Shift+Enter for newline)" : "Type a message to start a session…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={busy}
            />
            {busy && (
              <Loader2 size={14} className="absolute right-3 top-3 text-accent animate-spin" />
            )}
          </div>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!input.trim() || busy}
            className="h-[40px]"
          >
            <Send size={14} />
          </Button>
        </div>
      </div>

      <ModelPickerDialog
        open={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        onSelect={(_provider, model) => setActiveModel(model)}
      />
    </div>
  );

  function toggleCollapse(index: number) {
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, collapsed: !m.collapsed } : m)),
    );
  }
}

function MessageBubble({
  msg,
  onToggle,
}: {
  msg: ChatMessage;
  onToggle: () => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="bg-accent/15 border border-accent/30 rounded-lg rounded-br-sm px-3 py-2 max-w-[85%]">
          <div className="text-[10px] uppercase tracking-wide text-accent/70 mb-0.5">You</div>
          <div className="text-fg text-[13px] whitespace-pre-wrap break-words">{msg.content}</div>
        </div>
      </div>
    );
  }

  if (msg.role === "tool") {
    return (
      <div className="flex items-start gap-2 animate-fade-in">
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 text-[11px] text-fg-muted hover:text-accent transition-colors"
        >
          {msg.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <Wrench size={11} className="text-orange" />
          <code className="font-mono">{msg.toolName}</code>
        </button>
        {!msg.collapsed && msg.content && (
          <pre className="text-[10px] text-fg-subtle font-mono bg-bg-input rounded px-2 py-1 max-w-full overflow-x-auto flex-1">
            {msg.content}
          </pre>
        )}
      </div>
    );
  }

  if (msg.role === "system") {
    return (
      <div className="text-center animate-fade-in">
        <span className="text-[11px] text-danger bg-danger/10 rounded-full px-3 py-1">
          {msg.content}
        </span>
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex items-start gap-2 animate-fade-in">
      <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center shrink-0 mt-0.5">
        <Cpu size={13} className="text-accent" />
      </div>
      <div className="flex-1 min-w-0 bg-bg-surface border border-border rounded-lg rounded-tl-sm px-3 py-2">
        <Markdown content={msg.content || (msg.streaming ? "…" : "")} />
        {msg.streaming && (
          <span className="inline-block w-2 h-3.5 bg-accent animate-blink ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}
