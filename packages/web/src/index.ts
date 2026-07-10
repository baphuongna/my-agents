/**
 * @my-agent/web — minimal web dashboard SPA (§25.2).
 *
 * The gateway (§25.2) serves a session-cookie + CSRF SPA that subscribes to the
 * RuntimeEvent bus over WS with replay-from-cursor. This ships the SPA HTML +
 * the minimal client JS (no build step — vanilla, ~the §25.6 wire contract).
 * A full React/Vite SPA layers on top as a UI package.
 *
 * Source: §25.2 Web dashboard; §25.6 UI↔Runtime event contract.
 */

/** The dashboard SPA HTML. Subscribes to /events?since=cursor and renders the
 * turn stream + an approval modal bound to {kind:"approval"}. */
export function dashboardHtml(opts: { title?: string; wsPath?: string } = {}): string {
  const title = opts.title ?? "agent dashboard";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
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
  <div id="stream"></div>
  <aside id="sidebar"><h3>session</h3><div id="info">—</div></aside>
</main>
<div id="approval-modal" style="display:none"></div>
<script>
  let cursor = 0;
  const stream = document.getElementById('stream');
  const statusEl = document.getElementById('status');
  const seqEl = document.getElementById('seq');
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host + '/events?since=' + cursor);
    ws.onopen = () => { statusEl.textContent = 'live'; statusEl.style.background = '#238636'; };
    ws.onclose = () => { statusEl.textContent = 'reconnecting'; statusEl.style.background = '#d29922'; setTimeout(connect, 1000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (m) => {
      const env = JSON.parse(m.data);
      cursor = env.seq;
      seqEl.textContent = 'seq ' + cursor;
      renderEvent(env);
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
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  connect();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
