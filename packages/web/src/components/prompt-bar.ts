/**
 * @my-agent/web — prompt bar component.
 *
 * Fixed-position input bar at the bottom of the dashboard. Allows the user
 * to send text messages to the agent via WebSocket.
 */

export interface PromptBarOptions {
  /** Placeholder text for the input. */
  placeholder?: string;
  /** Callback when the user sends a message. */
  onSend?: (text: string) => void;
}

/** Client-side: create and attach the prompt bar to the document body. */
export function createPromptBar(opts: PromptBarOptions = {}): HTMLDivElement {
  const inputBar = document.createElement("div");
  inputBar.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;background:#161b22;border-top:1px solid #30363d;padding:8px 16px;display:flex;gap:8px";
  
  const inp = document.createElement("input");
  inp.style.cssText =
    "flex:1;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:8px";
  inp.placeholder = opts.placeholder ?? "send a message...";
  
  const btn = document.createElement("button");
  btn.textContent = "send";
  btn.onclick = () => {
    const text = inp.value.trim();
    if (text && opts.onSend) {
      opts.onSend(text);
      inp.value = "";
    }
  };
  
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") btn.click();
  });
  
  inputBar.appendChild(inp);
  inputBar.appendChild(btn);
  
  return inputBar;
}
