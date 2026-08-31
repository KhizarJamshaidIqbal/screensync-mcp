import { parsePairing } from '../lib/pairing.js';
import { PROBE_URLS, DEFAULT_TOKEN } from '../lib/constants.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function show(step) {
  for (const s of ['welcome', 'connect', 'guide', 'done']) {
    $('step-' + s).hidden = s !== step;
  }
  const idx = { welcome: 1, connect: 2, guide: 3, done: 3 }[step];
  $('s1').className = 'on';
  $('s2').className = idx >= 2 ? 'on' : '';
  $('s3').className = idx >= 3 ? 'on' : '';
}

$('btn-start').onclick = async () => {
  show('connect');
  $('token').value = (await send({ type: 'get-status' })).settings.token || DEFAULT_TOKEN;
  $('probe-msg').textContent = 'Probing localhost…';
  const results = await Promise.allSettled(
    PROBE_URLS.map((u) => send({ type: 'probe', url: u }).then((r) => ({ u, r })))
  );
  const hit = results.find((r) => r.status === 'fulfilled' && r.value.r.ok);
  if (hit) {
    $('url').value = hit.value.u;
    $('probe-msg').textContent = `Found hub at ${hit.value.u} (${hit.value.r.result.latencyMs}ms).`;
  } else {
    $('probe-msg').textContent = 'No hub on localhost — enter your hub’s LAN address or paste a pairing link.';
  }
};

$('btn-apply').onclick = () => {
  const p = parsePairing($('pair').value);
  const err = $('conn-err');
  if (!p) {
    err.textContent = 'Could not parse that link. Supported: screensync://pair?…, JSON {"url","token"}, or http://ip:port#token';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  $('url').value = p.url;
  $('token').value = p.token;
};

$('btn-connect').onclick = async () => {
  const err = $('conn-err');
  err.hidden = true;
  const url = $('url').value.trim().replace(/\/$/, '');
  const token = $('token').value.trim() || DEFAULT_TOKEN;
  if (!url) {
    err.textContent = 'Enter the hub URL first.';
    err.hidden = false;
    return;
  }
  try {
    // LAN origins need a runtime grant; localhost is pre-granted.
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    if (!isLocal) {
      const granted = await chrome.permissions.request({ origins: [url + '/*'] });
      if (!granted) {
        err.textContent = 'Permission for that origin was denied — the extension cannot reach the hub without it.';
        err.hidden = false;
        return;
      }
    }
    const r = await send({ type: 'probe', url });
    if (!r.ok) throw new Error(r.error || 'unreachable');
    await send({ type: 'update-settings', patch: { hubUrl: url, token, onboardingComplete: true } });
    show('guide');
    loadGuide();
  } catch (e) {
    err.textContent = e.status === 401
      ? '401 — the token doesn’t match the hub’s SCREEN_SYNC_TOKEN.'
      : `Hub not reachable at ${url} — is start-hub.bat / start-hub.sh running? (${e.message})`;
    err.hidden = false;
  }
};

async function loadGuide() {
  const body = $('guide-body');
  body.innerHTML = '<p class="dim">Loading setup guide…</p>';
  const r = await send({ type: 'get-guide' });
  const g = r.guide;
  body.innerHTML = '';

  const sec = (title, node) => {
    const d = document.createElement('div');
    d.className = 'guide-sec';
    const h = document.createElement('h3');
    h.textContent = title;
    d.appendChild(h);
    d.appendChild(node);
    body.appendChild(d);
  };

  const ol = document.createElement('ol');
  for (const s of g.hubInstall?.steps || []) {
    const li = document.createElement('li');
    li.textContent = s;
    ol.appendChild(li);
  }
  sec('1 · Run the hub', ol);

  const env = document.createElement('ul');
  for (const [k, v] of Object.entries(g.hubInstall?.envVars || {})) {
    const li = document.createElement('li');
    const b = document.createElement('strong');
    b.textContent = k;
    li.appendChild(b);
    li.appendChild(document.createTextNode(' — ' + v));
    env.appendChild(li);
  }
  sec('Environment variables', env);

  for (const [key, cfg] of Object.entries(g.mcpConfig || {})) {
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    pre.textContent = cfg.template || JSON.stringify(cfg, null, 2);
    const wrap = document.createElement('div');
    const f = document.createElement('p');
    f.className = 'dim';
    f.style.fontSize = '12px';
    f.style.marginBottom = '6px';
    f.textContent = cfg.file || key;
    wrap.appendChild(f);
    wrap.appendChild(pre);
    sec('MCP config · ' + key, wrap);
  }

  const tr = document.createElement('ul');
  for (const t of g.troubleshooting || []) {
    const li = document.createElement('li');
    li.textContent = t;
    tr.appendChild(li);
  }
  sec('Troubleshooting', tr);

  if (r.fallback) {
    const note = document.createElement('p');
    note.className = 'dim';
    note.style.fontSize = '11.5px';
    note.textContent = '(offline — bundled guide shown)';
    body.appendChild(note);
  }
}

$('btn-done').onclick = () => show('done');
$('btn-dash').onclick = () => {
  location.href = 'dashboard.html';
};

show('welcome');
