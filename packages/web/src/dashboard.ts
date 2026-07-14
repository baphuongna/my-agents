/**
 * @my-agent/web — dashboard SPA entry point.
 *
 * Composes the session list, approval modal, and prompt bar components
 * into a complete dashboard HTML page. The gateway serves this at `/`.
 *
 * Source: §25.2 Web dashboard; §25.6 UI↔Runtime event contract.
 */

import { sessionListHtml, escapeHtml } from "./components/session-list.js";
import { approvalModalHtml } from "./components/approval-modal.js";

export interface DashboardOptions {
  title?: string;
  wsPath?: string;
}

/** The dashboard SPA HTML. Subscribes to /events?since=cursor and renders the
 * turn stream + an approval modal bound to {kind:"approval"}. */
export function dashboardHtml(opts: DashboardOptions = {}): string {
  const title = opts.title ?? "agent dashboard";
  const wsQueryRaw = opts.wsPath ?? "/events";
  // Sanitize wsPath: only allow /, alphanumeric, ?, =, & (prevent XSS injection)
  const wsQuery = /^[\/?\w=&-]+$/.test(wsQueryRaw) ? wsQueryRaw : "/events";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#0a0a0a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="manifest" href="/manifest.json" />
<title>${escapeHtml(title)}</title>
<style>
  body { font: 14px/1.45 -apple-system,system-ui,sans-serif; margin: 0; background: #0b0d10; color: #e6edf3; }
  header { padding: 12px 16px; background: #161b22; border-bottom: 1px solid #30363d; }
  main { display: grid; grid-template-columns: 1fr 320px; gap: 1px; background: #30363d; height: calc(100vh - 49px); }
  #stream { background: #0b0d10; overflow-y: auto; padding: 12px; }
  #sidebar { background: #0d1117; padding: 12px; overflow-y: auto; }
  .ev { margin-bottom: 8px; padding: 6px 8px; border-radius: 4px; background: #161b22; border-left: 3px solid #388bfd; white-space: pre-wrap; word-break: break-word; }
  .ev.tool { border-left-color: #f0883e; }
  .ev.approval { border-left-color: #d29922; }
  .ev.error { border-left-color: #f85149; }
  .meta { font-size: 11px; color: #8b949e; }
  #approval-modal { position: fixed; bottom: 16px; right: 16px; background: #161b22; border: 1px solid #d29922; padding: 12px; border-radius: 6px; max-width: 360px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
  button { background: #238636; color: #fff; border: 0; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
  button.deny { background: #da3633; }
  .pill { display: inline-block; padding: 1px 6px; border-radius: 10px; background: #30363d; font-size: 11px; margin-left: 6px; }
</style>
</head>
<body>
<header><strong>${escapeHtml(title)}</strong><span class="pill" id="status">connecting</span><span class="pill" id="seq">seq 0</span></header>
<main>
  ${sessionListHtml()}
  <aside id="sidebar"><h3>session</h3><div id="info">—</div></aside>
</main>
${approvalModalHtml()}
<script>
  let cursor = 0;
  const stream = document.getElementById('stream');
  const statusEl = document.getElementById('status');
  const seqEl = document.getElementById('seq');
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host + '${wsQuery}' + (cursor > 0 ? '&since=' + cursor : ''));
    wsObj = ws;
    ws.onopen = () => { statusEl.textContent = 'live'; statusEl.style.background = '#238636'; ws_ready = true; };
    ws.onclose = () => { statusEl.textContent = 'reconnecting'; statusEl.style.background = '#d29922'; ws_ready = false; setTimeout(connect, 1000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (m) => {
      try {
        const env = JSON.parse(m.data);
        cursor = env.seq;
        seqEl.textContent = 'seq ' + cursor;
        renderEvent(env);
      } catch(e) { /* malformed — skip */ }
    };
  }
  function renderEvent(env) {
    const e = env.event || {};
    const div = document.createElement('div');
    div.className = 'ev ' + (e.kind || '');
    const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = '#' + env.seq + ' ' + (e.kind||'');
    div.appendChild(meta);
    const body = document.createElement('div');
    body.textContent = summarize(e);
    div.appendChild(body);
    stream.appendChild(div);
    stream.scrollTop = stream.scrollHeight;
    if (e.kind === 'approval' && e.stage === 'requested') showApproval(e);
  }
  function summarize(e) {
    if (e.kind === 'turn' && e.e) {
      if (e.e.state === 'Streaming' && e.e.chunk) return e.e.chunk.text || '';
      if (e.e.state === 'ToolExec') return '[tool results]';
      if (e.e.state === 'Completed') return '[completed · in ' + (e.e.usage?.input||0) + '/' + (e.e.usage?.output||0) + ']';
      return '[' + e.e.state + ']';
    }
    if (e.kind === 'budget') return 'budget: $' + (e.spentUsd||0).toFixed(4);
    return JSON.stringify(e).slice(0, 200);
  }
  function showApproval(e) {
    const m = document.getElementById('approval-modal');
    m.style.display = 'block';
    m.innerHTML = '<strong>approval</strong><br>' + escapeHtml(JSON.stringify(e.call||{})) + '<br><br><button onclick="this.parentNode.style.display=\\'none\\'">allow</button> <button class="deny" onclick="this.parentNode.style.display=\\'none\\'">deny</button>';
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  // Phase 15: prompt input bar.
  const inputBar = document.createElement('div');
  inputBar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#161b22;border-top:1px solid #30363d;padding:8px 16px;display:flex;gap:8px';
  const inp = document.createElement('input');
  inp.style.cssText = 'flex:1;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:8px';
  inp.placeholder = 'send a message...';
  const btn = document.createElement('button');
  btn.textContent = 'send';
  btn.onclick = () => {
    if (inp.value.trim() && ws_ready) { wsObj.send(JSON.stringify({ text: inp.value })); inp.value = ''; }
  };
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') btn.click(); });
  inputBar.appendChild(inp);
  inputBar.appendChild(btn);
  document.body.appendChild(inputBar);
  let ws_ready = false;
  let wsObj = null;
  connect();
  // Phase C: PWA service worker registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
</script>
</body>
</html>`;
}
