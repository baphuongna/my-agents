/**
 * @my-agent/web — dashboard SPA entry point.
 *
 * Full-featured dashboard with session management, live event stream,
 * streaming response aggregation, approval modal, and mobile nav.
 * The gateway serves this at `/`.
 *
 * Source: §25.2 Web dashboard; §25.6 UI↔Runtime event contract.
 */

import { escapeHtml } from "./components/session-list.js";
import { registerServiceWorker } from "./pwa-register.js";

export interface DashboardOptions {
  title?: string;
  wsPath?: string;
}

/** The dashboard SPA HTML. */
export function dashboardHtml(opts: DashboardOptions = {}): string {
  const title = opts.title ?? "mya";
  // Sanitize wsPath
  const wsQueryRaw = opts.wsPath ?? "/events";
  const wsQuery = /^[\/?\w=&.-]+$/.test(wsQueryRaw) ? wsQueryRaw : "/events";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#0a0a0a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="manifest" href="/manifest.json" />
<link rel="icon" href="/icons/192.png" />
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  body{font:14px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#0b0d10;color:#e6edf3;overflow:hidden}
  header{padding:8px 12px;background:#161b22;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  header strong{font-size:14px;letter-spacing:.2px}
  .spacer{flex:1}
  .pill{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;background:#30363d;font-size:11px;font-family:ui-monospace,monospace;white-space:nowrap}
  .pill.green{background:#238636;color:#fff}
  .pill.yellow{background:#d29922;color:#fff}
  .pill.red{background:#da3633;color:#fff}
  .pill.blue{background:#1f6feb;color:#fff}
  main{display:grid;grid-template-columns:1fr 280px;gap:1px;background:#30363d;height:calc(100vh - 41px - 52px)}
  #stream{background:#0b0d10;overflow-y:auto;padding:10px}
  #sidebar{background:#0d1117;padding:10px;overflow-y:auto}
  #sidebar h3{margin:0 0 6px;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;justify-content:space-between}
  #sidebar h3 button{background:#21262d;color:#58a6ff;border:1px solid #30363d;border-radius:3px;font-size:10px;padding:2px 6px;cursor:pointer;font-family:inherit}
  #sidebar h3 button:hover{background:#30363d}
  .ev{margin-bottom:6px;padding:6px 8px;border-radius:4px;background:#161b22;border-left:3px solid #388bfd;white-space:pre-wrap;word-break:break-word}
  .ev.tool{border-left-color:#f0883e}
  .ev.approval{border-left-color:#d29922}
  .ev.error{border-left-color:#f85149}
  .ev.budget{border-left-color:#a371f7}
  .ev.response{border-left-color:#58a6ff;background:#0d1117;padding:8px 10px}
  .ev.response.streaming .response-text::after{content:"▌";animation:blink .8s steps(2) infinite;color:#58a6ff}
  @keyframes blink{50%{opacity:0}}
  .response-text{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.5;min-height:1em}
  .meta{font-size:10px;color:#8b949e;font-family:ui-monospace,monospace}
  #session-list{list-style:none;margin:0;padding:0}
  #session-list li{display:flex;align-items:center;gap:4px;padding:3px 4px;border-radius:3px;font-size:12px;font-family:ui-monospace,monospace;cursor:pointer}
  #session-list li:hover{background:#161b22}
  #session-list li.active{background:#1f6feb33}
  #session-list .sid{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #session-list .sstat{font-size:9px;padding:1px 4px;border-radius:8px;background:#30363d;color:#8b949e}
  #session-list .sstat.active{background:#238636;color:#fff}
  #session-list .kill{background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:3px;font-size:10px;padding:0 4px;cursor:pointer}
  #session-list .kill:hover{background:#da3633;color:#fff;border-color:#da3633}
  #session-empty{font-size:11px;color:#8b949e;font-style:italic;padding:4px}
  .empty-stream{text-align:center;color:#484f58;padding:40px 20px;font-size:13px}
  .empty-stream .big{font-size:32px;margin-bottom:8px}
  #input-bar{position:fixed;bottom:0;left:0;right:0;background:#161b22;border-top:1px solid #30363d;padding:8px 12px;display:flex;gap:8px;z-index:10}
  #prompt{flex:1;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:4px;padding:8px 10px;font:inherit;font-size:13px}
  #prompt:focus{outline:none;border-color:#58a6ff}
  #send-btn{background:#238636;color:#fff;border:0;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500}
  #send-btn:disabled{background:#30363d;color:#8b949e;cursor:not-allowed}
  #approval-modal{position:fixed;bottom:64px;right:12px;background:#161b22;border:1px solid #d29922;padding:12px;border-radius:6px;max-width:340px;box-shadow:0 8px 24px rgba(0,0,0,.5);z-index:50;font-size:12px;display:none}
  #approval-modal pre{background:#0d1117;padding:6px;border-radius:3px;font-size:10px;overflow-x:auto;margin:6px 0;max-height:200px;overflow-y:auto}
  #approval-modal .actions{display:flex;gap:6px}
  #approval-modal button{background:#238636;color:#fff;border:0;padding:5px 12px;border-radius:3px;cursor:pointer;font-size:12px}
  #approval-modal button.deny{background:#da3633}
  #error-banner{display:none;position:fixed;top:41px;left:0;right:0;padding:6px 12px;background:#2a0a0a;border-bottom:1px solid #da3633;color:#ff8181;font-size:11px;font-family:ui-monospace,monospace;z-index:40}
  #error-banner.show{display:block}
  @media(max-width:640px){
    main{grid-template-columns:1fr}
    #sidebar{display:none}
    header{padding:6px 8px}
    header strong{font-size:12px}
    .pill{font-size:10px;padding:1px 6px}
  }
</style>
</head>
<body>
<header>
  <strong>⚡ ${escapeHtml(title)}</strong>
  <span class="pill yellow" id="ws-status">connecting</span>
  <span class="pill" id="seq-pill">seq 0</span>
  <span class="spacer"></span>
  <span class="pill" id="model-pill" title="active model">—</span>
</header>
<div id="error-banner"><span id="error-text"></span></div>
<main>
  <div id="stream">
    <div class="empty-stream" id="empty-state">
      <div class="big">💬</div>
      <div>No active session. Send a message to start.</div>
    </div>
  </div>
  <aside id="sidebar">
    <h3>sessions <span><button onclick="newSession()" title="new session">+</button><button onclick="refreshSessions()" title="refresh">↻</button></span></h3>
    <ul id="session-list"></ul>
    <div id="session-empty">no sessions</div>
  </aside>
</main>
<div id="approval-modal"></div>
<div id="input-bar">
  <input id="prompt" type="text" placeholder="send a message…" autocomplete="off" />
  <button id="send-btn" onclick="sendPrompt()">send</button>
</div>
<script>
"use strict";
(function(){
  var wsQuery='${wsQuery}';
  var cursor=0, ws=null, wsReady=false, currentSession=null, eventsShown=0;
  var currentResponse=null;
  var stream=document.getElementById('stream');
  var wsStatus=document.getElementById('ws-status');
  var seqPill=document.getElementById('seq-pill');
  var modelPill=document.getElementById('model-pill');
  var emptyState=document.getElementById('empty-state');
  var sessionList=document.getElementById('session-list');
  var sessionEmpty=document.getElementById('session-empty');
  var errorBanner=document.getElementById('error-banner');
  var errorText=document.getElementById('error-text');
  var promptInput=document.getElementById('prompt');

  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}

  function showError(msg){errorText.textContent=msg;errorBanner.classList.add('show');setTimeout(function(){errorBanner.classList.remove('show')},8000)}

  function wsUrl(){
    var q='';
    if(cursor>0)q+=(q?'&':'?')+'since='+cursor;
    if(wsQuery.indexOf('token=')<0){
      // Extract token from wsQuery if present
      var m=wsQuery.match(/token=([^&]+)/);
      if(m){}
    }
    var base=wsQuery.split('?')[0];
    var existing=wsQuery.indexOf('?')>=0?wsQuery.split('?')[1]:'';
    var parts=[];
    if(existing)parts.push(existing);
    if(cursor>0)parts.push('since='+cursor);
    return base+(parts.length?'?'+parts.join('&'):'');
  }

  function connect(){
    try{ws=new WebSocket(wsUrl())}catch(e){wsStatus.textContent='error';wsStatus.className='pill red';setTimeout(connect,2000);return}
    ws.onopen=function(){wsReady=true;wsStatus.textContent='live';wsStatus.className='pill green'};
    ws.onclose=function(){wsReady=false;wsStatus.textContent='reconnecting';wsStatus.className='pill yellow';setTimeout(connect,1500)};
    ws.onerror=function(){try{ws.close()}catch(e){}}
    ws.onmessage=function(m){
      try{
        var env=JSON.parse(m.data);
        if(typeof env.seq==='number'){cursor=env.seq;seqPill.textContent='seq '+cursor}
        renderEvent(env);
      }catch(e){}
    }
  }

  function renderEvent(env){
    if(!env||typeof env!=='object')return;
    if(emptyState)emptyState.style.display='none';
    var e=env.event||{};
    var kind=e.kind||'';

    if(kind==='turn'){
      var te=e.turnEvent||e.e||{};
      if(e.stage==='start'){currentResponse=null;return}
      if(e.stage==='end'){if(currentResponse){currentResponse.classList.remove('streaming');currentResponse=null}return}
      if(te.state==='Streaming'&&te.chunk&&te.chunk.kind==='text'){
        if(!currentResponse){
          currentResponse=document.createElement('div');
          currentResponse.className='ev response streaming';
          var m=document.createElement('div');m.className='meta';m.textContent='#'+env.seq+' assistant';currentResponse.appendChild(m);
          var t=document.createElement('div');t.className='response-text';currentResponse.appendChild(t);
          stream.appendChild(currentResponse);
        }
        currentResponse.querySelector('.response-text').textContent+=te.chunk.text||'';
        stream.scrollTop=stream.scrollHeight;
        return;
      }
      if(currentResponse&&(te.state==='Completed'||te.state==='Failed'||te.state==='Cancelled')){
        currentResponse.classList.remove('streaming');currentResponse=null;
      }
      if(te.state==='Failed'){renderTile(env,e,'error');if(te.error&&te.error.message)showError(te.error.message);return}
      if(te.state==='Completed'){return} // silently skip completion tiles
      renderTile(env,e,kind);return;
    }

    if(kind==='log'&&e.level==='error'){renderTile(env,e,'error');if(e.message)showError(e.message);return}
    if(kind==='budget'||kind==='health'||kind==='log')renderTile(env,e,kind);

    if(e.kind==='approval'&&e.stage==='requested')showApproval(e);
  }

  function renderTile(env,e,kind){
    var div=document.createElement('div');
    div.className='ev '+kind;
    var meta=document.createElement('div');meta.className='meta';meta.textContent='#'+env.seq+' '+kind;div.appendChild(meta);
    var body=document.createElement('div');body.textContent=summarize(e);div.appendChild(body);
    stream.appendChild(div);
    stream.scrollTop=stream.scrollHeight;
  }

  function summarize(e){
    if(e.kind==='turn'){var te=e.turnEvent||e.e||{};
      if(te.state==='ToolCalls')return'[tool calls]';
      if(te.state==='ToolExec')return'[tool results]';
      if(te.state==='Completed'){var u=te.usage||{};return'[completed · '+((u.input||0))+'→'+((u.output||0))+' tokens]'}
      if(te.state==='Cancelled')return'[cancelled]';
      return'['+te.state+']';
    }
    if(e.kind==='budget')return'$'+(Number(e.spentUsd)||0).toFixed(4);
    if(e.kind==='log')return(e.level||'info')+': '+(e.message||'');
    if(e.kind==='health')return e.status||'?';
    try{return JSON.stringify(e).slice(0,180)}catch(x){return'[?]'}
  }

  function showApproval(e){
    var m=document.getElementById('approval-modal');
    m.style.display='block';
    var call=e.call||{};
    m.innerHTML='<strong>approval required</strong><pre>'+esc(JSON.stringify(call,null,2))+'</pre><div class="actions"><button onclick="submitApproval(\\'allow\\')">allow</button><button class="deny" onclick="submitApproval(\\'deny\\')">deny</button></div>';
  }
  window.submitApproval=function(d){
    document.getElementById('approval-modal').style.display='none';
    if(ws&&wsReady){try{ws.send(JSON.stringify({kind:'approval_decision',decision:d}))}catch(e){}}
  };

  // ── Session management ──
  async function fetchJSON(url,opts){
    try{var r=await fetch(url,Object.assign({cache:'no-store'},opts||{}));if(!r.ok)return null;return await r.json()}catch(e){return null}
  }

  window.refreshSessions=async function(){
    var data=await fetchJSON('/sessions');
    if(!data){sessionEmpty.textContent='unavailable';sessionEmpty.style.display='';sessionList.innerHTML='';return}
    sessionEmpty.textContent='no sessions';
    sessionEmpty.style.display=data.length?'none':'';
    sessionList.innerHTML='';
    for(var i=0;i<data.length;i++){
      var s=data[i];var id=s.id||'?';var stat=s.status||'';
      var li=document.createElement('li');
      if(id===currentSession)li.className='active';
      var sid=document.createElement('span');sid.className='sid';sid.textContent=id;sid.title=id;li.appendChild(sid);
      if(stat){var st=document.createElement('span');st.className='sstat '+stat;st.textContent=stat;li.appendChild(st)}
      var kill=document.createElement('button');kill.className='kill';kill.textContent='×';kill.title='kill';
      (function(id){kill.onclick=function(e){e.stopPropagation();killSession(id)}})(id);
      li.appendChild(kill);
      (function(id){li.onclick=function(){selectSession(id)}})(id);
      sessionList.appendChild(li);
    }
  };

  window.selectSession=function(id){currentSession=id;window.refreshSessions()};

  async function killSession(id){
    await fetch('/sessions/'+encodeURIComponent(id),{method:'DELETE'});
    window.refreshSessions();
  }

  window.newSession=async function(){
    // Acquire a new session via the pool
    var data=await fetchJSON('/pool/acquire',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});
    if(data&&data.id){currentSession=data.id;window.refreshSessions()}
    else{window.refreshSessions()}
  };

  // ── Status ──
  async function fetchStatus(){
    var s=await fetchJSON('/status');
    if(s&&s.model)modelPill.textContent=s.model;
    else if(s&&s.providers){var keys=Object.keys(s.providers).filter(function(k){return s.providers[k].configured});modelPill.textContent=keys.length+' providers'}
  }

  // ── Input ──
  window.sendPrompt=function(){
    var text=promptInput.value.trim();
    if(!text)return;
    if(!wsReady){showError('WebSocket not connected. Retrying…');return}
    try{
      if(emptyState)emptyState.style.display='none';
      // Echo user message
      var div=document.createElement('div');div.className='ev';div.style.borderLeftColor='#3fb950';
      var meta=document.createElement('div');meta.className='meta';meta.textContent='you';div.appendChild(meta);
      var body=document.createElement('div');body.textContent=text;div.appendChild(body);
      stream.appendChild(div);stream.scrollTop=stream.scrollHeight;
      ws.send(JSON.stringify({text:text}));promptInput.value='';
    }catch(e){showError('Send failed: '+e.message)}
  };
  promptInput.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.sendPrompt()}});

  // ── Boot ──
  connect();
  window.refreshSessions();
  fetchStatus();
  setInterval(fetchStatus,30000); // refresh status every 30s
  setInterval(window.refreshSessions,5000); // refresh sessions every 5s

  // PWA: register service worker (inlined for browser scope)
  if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){})}
})();
</script>
</body>
</html>`;
}
