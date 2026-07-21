/**
 * ChatPage — premium chat experience with the agent.
 * Pool API + WebSocket streaming + Markdown + model picker.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { eventClient, type GatewayEvent } from "@/lib/ws";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/Markdown";
import { ModelPickerDialog } from "@/components/ModelPickerDialog";
import { useToast } from "@/lib/toast";
import {
  Send, Loader2, Wrench, ChevronDown, ChevronRight,
  RotateCcw, Cpu, Settings, Sparkles, Zap,
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

const SUGGESTIONS = [
  { icon: Zap, text: "What can you do?", color: "text-accent" },
  { icon: Cpu, text: "List available models", color: "text-purple" },
  { icon: Sparkles, text: "Write a haiku about coding", color: "text-orange" },
];

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

  useEffect(() => {
    eventClient.connect();
    return eventClient.onStatus(setWsConnected);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    return eventClient.onEvent((ev) => {
      if (ev.sessionId !== sessionId) return;
      handleEvent(ev);
    });
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleEvent = useCallback((ev: GatewayEvent) => {
    const inner = ((ev as Record<string, unknown>).event as Record<string, unknown>) ?? ev;
    const type = (inner.type ?? inner.kind ?? "") as string;

    if (type === "message_update") {
      const ame = inner.assistantMessageEvent as Record<string, unknown> | undefined;
      if (!ame) return;
      if ((ame.type as string) === "text_delta") {
        const delta = (ame.delta ?? "") as string;
        if (!delta) return;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            return [...prev.slice(0, -1), { ...last, content: last.content + delta }];
          }
          return [...prev, { role: "assistant", content: delta, streaming: true }];
        });
      }
      return;
    }

    if (type === "turn_end" || type === "agent_end" || type === "agent_settled") {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.streaming) {
          const msg = inner.message as { content?: Array<{ type: string; text?: string }> } | undefined;
          if (msg?.content && type === "turn_end") {
            const textParts = msg.content.filter((c) => c.type === "text").map((c) => c.text ?? "");
            const finalText = textParts.join("");
            if (finalText) return [...prev.slice(0, -1), { ...last, content: finalText, streaming: false }];
          }
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev;
      });
      if (type === "turn_end" || type === "agent_end") setBusy(false);
      return;
    }

    if (type === "tool_call" || type === "tool_start") {
      const name = (inner.name ?? inner.toolName ?? "tool") as string;
      setMessages((prev) => [...prev, { role: "tool", content: `Using ${name}…`, toolName: name, collapsed: false }]);
      return;
    }

    if (type === "tool_result" || type === "tool_end") {
      const output = (inner.output ?? inner.result ?? "") as string;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "tool") {
          return [...prev.slice(0, -1), { ...last, content: typeof output === "string" ? output.slice(0, 500) : JSON.stringify(output).slice(0, 500) }];
        }
        return prev;
      });
      return;
    }

    if (type === "error") {
      const msg = (inner.message ?? inner.error ?? "Unknown error") as string;
      setMessages((prev) => [...prev, { role: "system", content: `Error: ${msg}` }]);
      setBusy(false);
    }
  }, []);

  async function acquireSession() {
    try {
      const res = await postJSON<{ sessionId: string }>("/pool/acquire", { cwd: "." });
      setSessionId(res.sessionId);
      eventClient.setSession(res.sessionId);
      return res.sessionId;
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
      return null;
    }
  }

  async function submit(text?: string) {
    const prompt = (text ?? input).trim();
    if (!prompt || busy) return;
    let sid = sessionId;
    if (!sid) { sid = await acquireSession(); if (!sid) return; }
    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setInput("");
    setBusy(true);
    try {
      await postJSON(`/pool/prompt/${sid}`, { text: prompt });
    } catch (e) {
      setMessages((prev) => [...prev, { role: "system", content: `Failed: ${e instanceof Error ? e.message : e}` }]);
      setBusy(false);
    }
  }

  function reset() {
    setMessages([]); setSessionId(null); setBusy(false);
    eventClient.setSession("*");
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-full">
      {/* Minimal top bar */}
      <div className="flex items-center gap-2 px-4 h-12 shrink-0 border-b border-border/30">
        <div className="w-7 h-7 rounded-lg gradient-accent flex items-center justify-center shrink-0" style={{ boxShadow: "0 0 12px rgb(var(--accent) / 0.3)" }}>
          <Sparkles size={14} className="text-white" />
        </div>
        <h1 className="text-sm font-semibold text-fg">Chat</h1>
        <div className="flex-1" />
        <button
          className={cn("px-2.5 py-1 rounded-lg text-[11px] transition-all flex items-center gap-1.5",
            activeModel ? "bg-bg-elevated text-fg border border-border/50 hover:border-accent/50" : "text-fg-muted hover:text-accent")}
          onClick={() => setModelPickerOpen(true)}
        >
          <Cpu size={12} />
          {activeModel || "Select model"}
        </button>
        <div className="flex items-center gap-1">
          <span className={cn("w-1.5 h-1.5 rounded-full", wsConnected ? "bg-success" : "bg-danger", wsConnected && "animate-pulse")} />
        </div>
        {messages.length > 0 && (
          <button className="btn-ghost p-1.5" onClick={reset} title="New">
            <RotateCcw size={14} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6">
            <div className="w-16 h-16 rounded-2xl gradient-accent flex items-center justify-center mb-5 animate-scale-in" style={{ boxShadow: "0 0 32px rgb(var(--accent) / 0.25)" }}>
              <Sparkles size={28} className="text-white" />
            </div>
            <h2 className="text-lg font-semibold text-fg mb-1.5">Chat with mya</h2>
            <p className="text-sm text-fg-muted text-center max-w-sm mb-8">
              Your unified coding & autonomous agent. Ask anything, write code, or explore your project.
            </p>
            <div className="grid sm:grid-cols-3 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => submit(s.text)}
                  className="card card-hover p-3 text-left group animate-fade-in-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <s.icon size={15} className={cn("mb-2", s.color)} />
                  <p className="text-[12px] text-fg group-hover:text-accent transition-colors">{s.text}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} onToggle={() => toggleCollapse(i)} />
            ))}
            {busy && (
              <div className="flex items-center gap-2 pl-9 animate-fade-in">
                <div className="flex gap-1">
                  {[0,1,2].map(i => (
                    <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: `${i * 100}ms` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="relative">
            <textarea
              ref={inputRef}
              className="input min-h-[44px] max-h-32 w-full resize-y pr-12 rounded-xl bg-bg-surface"
              placeholder={sessionId ? "Message mya…  (Enter to send)" : "Start a conversation…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              rows={1}
              disabled={busy}
            />
            <button
              onClick={() => submit()}
              disabled={!input.trim() || busy}
              className={cn("absolute right-2 bottom-2 w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                input.trim() && !busy ? "gradient-accent text-white hover:scale-105" : "bg-fg/5 text-fg-subtle")}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
          <p className="text-[10px] text-fg-subtle/40 text-center mt-1.5">
            mya can make mistakes. Verify important information.
          </p>
        </div>
      </div>

      <ModelPickerDialog open={modelPickerOpen} onClose={() => setModelPickerOpen(false)} onSelect={(_p, m) => setActiveModel(m)} />
    </div>
  );

  function toggleCollapse(index: number) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, collapsed: !m.collapsed } : m)));
  }
}

function MessageBubble({ msg, onToggle }: { msg: ChatMessage; onToggle: () => void }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end animate-fade-in-up">
        <div className="max-w-[80%]">
          <div className="bg-accent/10 border border-accent/20 rounded-2xl rounded-br-md px-4 py-2.5">
            <div className="text-fg text-[13px] whitespace-pre-wrap break-words leading-relaxed">{msg.content}</div>
          </div>
        </div>
      </div>
    );
  }

  if (msg.role === "tool") {
    return (
      <div className="flex items-center gap-2 pl-9 animate-fade-in">
        <button onClick={onToggle} className="flex items-center gap-1.5 text-[11px] text-fg-subtle hover:text-accent transition-colors bg-fg/5 rounded-lg px-2 py-1">
          {msg.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          <Wrench size={10} className="text-orange" />
          <code className="font-mono">{msg.toolName}</code>
        </button>
        {!msg.collapsed && msg.content && (
          <pre className="text-[10px] text-fg-subtle font-mono bg-bg-input rounded-lg px-2.5 py-1.5 max-w-md overflow-x-auto flex-1 border border-border/30">{msg.content}</pre>
        )}
      </div>
    );
  }

  if (msg.role === "system") {
    return (
      <div className="flex justify-center animate-fade-in">
        <span className="text-[11px] text-danger bg-danger/10 border border-danger/20 rounded-full px-3 py-1">{msg.content}</span>
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex gap-3 animate-fade-in-up">
      <div className="w-8 h-8 rounded-xl gradient-accent flex items-center justify-center shrink-0 mt-0.5" style={{ boxShadow: "0 0 10px rgb(var(--accent) / 0.2)" }}>
        <Sparkles size={14} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-bg-surface border border-border/40 rounded-2xl rounded-tl-md px-4 py-3">
          <Markdown content={msg.content || (msg.streaming ? "" : "")} />
          {msg.streaming && !msg.content && (
            <div className="flex gap-1 py-1">
              {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent/50 animate-bounce" style={{ animationDelay: `${i * 100}ms` }} />)}
            </div>
          )}
          {msg.streaming && msg.content && (
            <span className="inline-block w-2 h-3.5 bg-accent animate-blink ml-0.5 align-middle rounded-sm" />
          )}
        </div>
      </div>
    </div>
  );
}
