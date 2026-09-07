const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>OpenClaw on Railway</title>
  <style>
    :root{--bg:#080b12;--panel:#111724;--line:#263044;--muted:#9eabc0;--text:#f4f7fb;--green:#39d98a;--yellow:#ffcc66;--red:#ff6b78;--accent:#7c8cff}
    *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at 20% 0,#18223c 0,transparent 35%),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
    main{width:min(980px,calc(100% - 32px));margin:48px auto}.hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:28px}
    h1{font-size:clamp(30px,5vw,48px);line-height:1.05;margin:0 0 12px}.eyebrow{color:var(--accent);font-weight:800;letter-spacing:.13em;text-transform:uppercase;font-size:12px}.lead{color:var(--muted);max-width:620px;margin:0}
    .badge{border:1px solid var(--line);background:#0d1220;border-radius:999px;padding:8px 13px;white-space:nowrap}.dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:8px;background:var(--yellow)}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{background:linear-gradient(180deg,rgba(23,31,49,.96),rgba(14,19,31,.96));border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 16px 50px rgba(0,0,0,.18)}
    .wide{grid-column:1/-1}h2{font-size:17px;margin:0 0 14px}.metric{font-size:25px;font-weight:800}.muted{color:var(--muted)}
    .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}button,a.button{appearance:none;border:0;border-radius:11px;padding:11px 14px;font:inherit;font-weight:750;cursor:pointer;text-decoration:none;background:var(--accent);color:white}button.secondary,a.secondary{background:#212a3d}button.danger{background:#652f38}
    pre{background:#080c14;border:1px solid #222c3e;border-radius:12px;padding:14px;min-height:90px;max-height:330px;overflow:auto;white-space:pre-wrap;color:#c9d5e8}input{flex:1;min-width:220px;background:#080c14;color:var(--text);border:1px solid var(--line);border-radius:11px;padding:11px 13px;font:inherit}
    ol{padding-left:20px;color:var(--muted)}code{color:#cbd5ff}.hidden{display:none}@media(max-width:700px){main{margin-top:28px}.hero{display:block}.badge{display:inline-block;margin-top:18px}.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
  </style>
</head>
<body><main>
  <section class="hero"><div><div class="eyebrow">Railway control center</div><h1>OpenClaw is under control.</h1><p class="lead">A small, protected control center for status, setup, pairing, and recovery. The OpenClaw dashboard remains the source of truth for providers, models, agents, and channels.</p></div><div class="badge"><span class="dot" id="statusDot"></span><span id="statusText">Checking…</span></div></section>
  <section class="grid">
    <article class="card"><h2>OpenClaw version</h2><div class="metric" id="version">Loading…</div><p class="muted">Pinned to a tested stable release.</p></article>
    <article class="card"><h2>Persistent storage</h2><div class="metric" id="storage">Checking…</div><p class="muted">State, auth profiles, sessions, and workspace live under <code>/data</code>.</p></article>
    <article class="card wide"><h2>Start here</h2><ol><li>Click Start OpenClaw; the token is copied and the dashboard opens.</li><li>Paste the token and press Connect.</li><li>On the first connection, return here and approve the browser below.</li><li>Press Connect again, then configure providers, models, and channels.</li></ol><div class="row"><button id="startOpenClaw">Start OpenClaw</button><button class="secondary" id="copyToken">Copy token only</button></div><p class="muted" id="copyResult"></p></article>
    <article class="card wide"><h2>Diagnostics</h2><div class="row"><button class="secondary action" data-action="version">Version</button><button class="secondary action" data-action="doctor">Run doctor</button><button class="secondary action" data-action="status">Gateway status</button><button class="secondary action" data-action="devices">Pending devices</button><button class="danger action" data-action="restart">Restart Gateway</button></div><pre id="output">Choose a diagnostic action.</pre></article>
    <article class="card wide"><h2>Authorize this browser</h2><p class="muted">OpenClaw requires one-time approval for each new browser profile. Requests appear here automatically.</p><div id="pendingDevices" class="muted">Checking for a pending browser…</div><div class="row" style="margin-top:12px"><button class="secondary" id="refreshDevices">Refresh requests</button></div></article>
  </section>
</main><script type="module">
const output=document.querySelector('#output');
const setOutput=(v)=>output.textContent=typeof v==='string'?v:JSON.stringify(v,null,2);
async function api(path,options){const r=await fetch(path,options);const data=await r.json().catch(()=>({ok:false,error:'Invalid server response'}));if(!r.ok)throw new Error(data.error||('HTTP '+r.status));return data}
async function refresh(){try{const s=await api('/setup/api/status');document.querySelector('#version').textContent=s.version||'Unknown';document.querySelector('#storage').textContent=s.storageWritable?'Ready':'Needs attention';document.querySelector('#statusText').textContent=s.gateway.ready?'Gateway ready':'Gateway starting';const dot=document.querySelector('#statusDot');dot.style.background=s.gateway.ready?'var(--green)':'var(--yellow)'}catch(e){document.querySelector('#statusText').textContent='Control center error';document.querySelector('#statusDot').style.background='var(--red)'}}
document.querySelector('#copyToken').onclick=async()=>{try{const d=await api('/setup/api/token');await navigator.clipboard.writeText(d.token);document.querySelector('#copyResult').textContent='Gateway token copied.'}catch(e){document.querySelector('#copyResult').textContent=e.message}};
document.querySelector('#startOpenClaw').onclick=async()=>{const tab=window.open('about:blank','_blank');try{const d=await api('/setup/api/token');await navigator.clipboard.writeText(d.token);document.querySelector('#copyResult').textContent='Token copied. Paste it in the OpenClaw connection screen.';if(tab)tab.location='/openclaw/';else window.location='/openclaw/'}catch(e){if(tab)tab.close();document.querySelector('#copyResult').textContent=e.message}};
for(const b of document.querySelectorAll('.action'))b.onclick=async()=>{b.disabled=true;setOutput('Running…');try{const d=await api('/setup/api/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:b.dataset.action})});setOutput(d.output||d)}catch(e){setOutput(e.message)}finally{b.disabled=false;refresh()}};
async function refreshDevices(){const box=document.querySelector('#pendingDevices');try{const d=await api('/setup/api/devices');box.replaceChildren();if(!d.pending.length){box.textContent='No pending browser. Open OpenClaw, enter the token, press Connect, then return here.';return}for(const device of d.pending){const row=document.createElement('div');row.className='row';row.style.marginTop='10px';const label=document.createElement('code');label.textContent='Browser request '+device.requestId;const approve=document.createElement('button');approve.textContent='Approve browser';approve.onclick=async()=>{approve.disabled=true;setOutput('Approving browser…');try{const result=await api('/setup/api/devices/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:device.requestId})});setOutput(result.output||'Browser approved. Return to OpenClaw and press Connect again.');await refreshDevices()}catch(e){setOutput(e.message);approve.disabled=false}};row.append(label,approve);box.append(row)}}catch(e){box.textContent=e.message}}
document.querySelector('#refreshDevices').onclick=refreshDevices;
refresh();refreshDevices();setInterval(()=>{refresh();refreshDevices()},10000);
</script></body></html>`;
}

export function loginHtml(message = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>OpenClaw Setup Login</title><style>:root{--bg:#080b12;--panel:#111724;--line:#263044;--muted:#9eabc0;--text:#f4f7fb;--red:#ff6b78;--accent:#7c8cff}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 0,#18223c 0,transparent 40%),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;padding:20px}main{width:min(440px,100%);background:linear-gradient(180deg,#171f31,#0e131f);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 24px 80px rgba(0,0,0,.35)}h1{margin:0 0 8px;font-size:28px}p{color:var(--muted)}label{display:block;margin:20px 0 7px;font-weight:700}input{width:100%;background:#080c14;color:var(--text);border:1px solid var(--line);border-radius:11px;padding:12px 14px;font:inherit}button{width:100%;margin-top:16px;border:0;border-radius:11px;padding:12px 14px;background:var(--accent);color:white;font:inherit;font-weight:800;cursor:pointer}.error{color:var(--red)}</style></head><body><main><h1>OpenClaw Setup</h1><p>Enter the <code>SETUP_PASSWORD</code> configured for this Railway service. Your browser receives a secure, private session cookie.</p>${message ? `<p class="error">${escapeHtml(message)}</p>` : ""}<form method="post" action="/login"><label for="password">Setup password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Continue securely</button></form></main></body></html>`;
}

export function errorHtml(title, detail) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui;background:#0b0e15;color:#f4f7fb;margin:40px auto;max-width:760px;padding:0 20px}main{background:#151b28;border:1px solid #2a3448;border-radius:18px;padding:24px}p{color:#b1bdd0;white-space:pre-wrap}code{color:#cbd5ff}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></main></body></html>`;
}
