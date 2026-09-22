import { parsePairing } from '../lib/pairing.js';
import { buildAgentSetupPrompt, buildHubTroubleshootPrompt } from '../lib/connect-kit.js';
import { PROBE_URLS, DEFAULT_TOKEN } from '../lib/constants.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

const STEPS = ['welcome', 'connect', 'guide', 'done'];

function updateStepper(currentStep) {
  const index = STEPS.indexOf(currentStep);
  const fill = $('stepper-fill');
  
  if (fill) {
    const percentages = [0, 33.3, 66.6, 100];
    fill.style.width = `${percentages[index]}%`;
  }

  STEPS.forEach((s, i) => {
    const node = $(`step-node-${i + 1}`);
    if (!node) return;

    node.classList.remove('active', 'completed');
    if (i === index) {
      node.classList.add('active');
    } else if (i < index) {
      node.classList.add('completed');
    }
  });
}

function show(step) {
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    const el = $('step-' + s);
    if (el) {
      if (s === step) {
        el.hidden = false;
        // Reflow to trigger CSS entrance animation
        void el.offsetWidth;
        el.classList.add('onb-step');
      } else {
        el.hidden = true;
      }
    }
  }
  updateStepper(step);
}

// Prefill hub URL + token so the connect step never opens empty: fill
// defaults synchronously, then upgrade from saved settings when they arrive.
function prefillConnect() {
  const urlAuto = !$('url').value;
  const tokenAuto = !$('token').value;
  if (urlAuto) $('url').value = PROBE_URLS[0];
  if (tokenAuto) $('token').value = DEFAULT_TOKEN;
  send({ type: 'get-status' })
    .then((status) => {
      const s = status?.settings;
      if (!s) return;
      if (urlAuto && s.hubUrl) $('url').value = s.hubUrl;
      if (tokenAuto && s.token) $('token').value = s.token;
    })
    .catch(() => { /* defaults already in place */ });
}

// Stepper items click navigation (allow jump to completed steps)
STEPS.forEach((step, i) => {
  const node = $(`step-node-${i + 1}`);
  if (node) {
    node.addEventListener('click', () => {
      // Allow clicking active or previously visited steps
      show(step);
      if (step === 'connect') prefillConnect();
    });
  }
});

// Quick suggestion chips
document.querySelectorAll('.quick-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const urlInput = $('url');
    if (urlInput) urlInput.value = chip.dataset.url;
  });
});

// Step 1 -> Step 2
$('btn-start').onclick = async () => {
  show('connect');
  prefillConnect();

  const probePill = $('probe-pill');
  if (probePill) {
    probePill.className = 'pill';
    probePill.innerHTML = '<span class="dot live ok"></span>Probing';
  }
  $('probe-msg').textContent = 'Probing localhost for running hub…';

  const results = await Promise.allSettled(
    PROBE_URLS.map((u) => send({ type: 'probe', url: u }).then((r) => ({ u, r })))
  );
  const hit = results.find((r) => r.status === 'fulfilled' && r.value.r.ok);
  if (hit) {
    $('url').value = hit.value.u;
    $('probe-msg').textContent = `Found hub at ${hit.value.u} (${hit.value.r.result.latencyMs}ms latency).`;
    if (probePill) {
      probePill.className = 'pill ok';
      probePill.innerHTML = '<span class="dot ok"></span>Hub Found';
    }
  } else {
    $('probe-msg').textContent = 'No hub detected on localhost — start start-hub.bat / start-hub.sh or enter address below.';
    if (probePill) {
      probePill.className = 'pill warn';
      probePill.innerHTML = '<span class="dot warn"></span>Not Found';
    }
  }
};

// Apply Pairing Link
$('btn-apply').onclick = () => {
  const p = parsePairing($('pair').value);
  const err = $('conn-err');
  if (!p) {
    err.textContent = 'Could not parse pairing link. Supported: screensync://pair?…, JSON {"url","token"}, or http://ip:port#token';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  $('url').value = p.url;
  $('token').value = p.token;
};

function detectPlatform() {
  const ua = navigator.userAgent || '';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Desktop';
}

// Connect Button
$('btn-connect').onclick = async () => {
  const err = $('conn-err');
  const troubleshoot = $('conn-troubleshoot');
  err.hidden = true;
  if (troubleshoot) troubleshoot.hidden = true;
  const url = $('url').value.trim().replace(/\/$/, '');
  const token = $('token').value.trim() || DEFAULT_TOKEN;
  
  if (!url) {
    err.textContent = 'Please enter the Hub URL first.';
    err.hidden = false;
    return;
  }

  try {
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    if (!isLocal) {
      const alreadyHas = await chrome.permissions.contains({ origins: [url + '/*'] }).catch(() => false);
      if (!alreadyHas) {
        const granted = await chrome.permissions.request({ origins: [url + '/*'] }).catch(() => false);
        if (!granted) {
          err.textContent = 'Host permission denied. The extension requires network access to communicate with the hub.';
          err.hidden = false;
          return;
        }
      }
    }
    const r = await send({ type: 'probe', url });
    if (!r.ok) throw new Error(r.error || 'unreachable');
    const authCheck = await send({ type: 'test-hub', url, token });
    if (!authCheck.ok) {
      const errObj = new Error(authCheck.error || 'authentication failed');
      errObj.status = authCheck.status;
      throw errObj;
    }
    await send({ type: 'update-settings', patch: { hubUrl: url, token, onboardingComplete: true } });
    show('guide');
    loadGuide();
  } catch (e) {
    if (e.status === 401) {
      err.textContent = '401 Unauthorized — Pairing token does not match hub SCREEN_SYNC_TOKEN.';
    } else if (e.status === 404) {
      err.textContent = `404 Not Found at ${url} — Port 3000 is occupied by another local server or an outdated hub. Please run sh start-hub.sh (macOS) or start-hub.bat (Windows).`;
    } else {
      err.textContent = `Hub unreachable at ${url} — please check the hub is running (sh start-hub.sh on macOS, start-hub.bat on Windows). (${e.message})`;
    }
    err.hidden = false;

    // Show Auto-Fix with AI Agent card
    if (troubleshoot) {
      troubleshoot.hidden = false;
      const os = detectPlatform();
      const guideContent = $('manual-guide-content');
      if (guideContent) {
        if (os === 'macOS') {
          guideContent.innerHTML = `
            <ol style="margin-left:16px;margin-top:4px;display:flex;flex-direction:column;gap:4px">
              <li>Open <strong>Terminal</strong> (<code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:4px">Cmd + Space</code> &rarr; <em>Terminal</em>).</li>
              <li>Check if port 3000 is busy: <code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:4px">lsof -i :3000</code> (close any conflicting dev app).</li>
              <li>Navigate &amp; start hub: <code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:4px">cd ~/Downloads/screensync-hub &amp;&amp; sh start-hub.sh</code></li>
              <li>When terminal displays <em>✔ hub on http://localhost:3000</em>, click <strong>Connect &amp; Continue</strong>.</li>
            </ol>`;
        } else {
          guideContent.innerHTML = `
            <ol style="margin-left:16px;margin-top:4px;display:flex;flex-direction:column;gap:4px">
              <li>Open the unzipped <code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:4px">screensync-hub</code> folder.</li>
              <li>Double-click <code style="background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:4px">start-hub.bat</code>.</li>
              <li>Make sure no other web server is occupying port 3000.</li>
              <li>When terminal displays <em>✔ hub on http://localhost:3000</em>, click <strong>Connect &amp; Continue</strong>.</li>
            </ol>`;
        }
      }

      const copyFixBtn = $('btn-copy-fix-prompt');
      if (copyFixBtn) {
        copyFixBtn.onclick = async () => {
          const fixPrompt = buildHubTroubleshootPrompt({
            hubUrl: url,
            token,
            error: err.textContent,
            os,
          });
          try {
            await navigator.clipboard.writeText(fixPrompt);
            const origText = copyFixBtn.textContent;
            copyFixBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyFixBtn.textContent = origText; }, 2000);
          } catch {
            prompt('Copy AI Fix Prompt:', fixPrompt);
          }
        };
      }

      const toggleGuideBtn = $('btn-toggle-guide');
      const drawer = $('manual-steps-drawer');
      if (toggleGuideBtn && drawer) {
        toggleGuideBtn.onclick = () => {
          drawer.hidden = !drawer.hidden;
          toggleGuideBtn.textContent = drawer.hidden ? 'Manual Steps' : 'Hide Steps';
        };
      }
    }
  }
};

// Guide loader
async function loadGuide() {
  const body = $('guide-body');
  body.textContent = 'Loading MCP setup guide…';
  body.className = 'dim mt';
  
  const r = await send({ type: 'get-guide' });
  const g = r.guide;
  body.textContent = '';
  body.className = 'mt';

  const sec = (title, node) => {
    const d = document.createElement('div');
    d.className = 'guide-sec mt';
    const h = document.createElement('h3');
    h.textContent = title;
    d.appendChild(h);
    d.appendChild(node);
    body.appendChild(d);
  };

  const ol = document.createElement('ol');
  ol.style.marginTop = '8px';
  for (const s of g.hubInstall?.steps || []) {
    const li = document.createElement('li');
    li.textContent = s;
    ol.appendChild(li);
  }
  sec('1 · Run the Hub', ol);

  const env = document.createElement('ul');
  env.style.marginTop = '8px';
  for (const [k, v] of Object.entries(g.hubInstall?.envVars || {})) {
    const li = document.createElement('li');
    const b = document.createElement('strong');
    b.textContent = k;
    li.appendChild(b);
    li.appendChild(document.createTextNode(' — ' + v));
    env.appendChild(li);
  }
  sec('2 · Environment Variables', env);

  for (const [key, cfg] of Object.entries(g.mcpConfig || {})) {
    const pre = document.createElement('pre');
    pre.className = 'code-block mt';
    pre.textContent = cfg.template || JSON.stringify(cfg, null, 2);
    const wrap = document.createElement('div');
    const f = document.createElement('p');
    f.className = 'dim';
    f.style.fontSize = '12px';
    f.style.marginTop = '8px';
    f.textContent = cfg.file || key;
    wrap.appendChild(f);
    wrap.appendChild(pre);
    sec('3 · MCP Configuration (' + key + ')', wrap);
  }

  const tr = document.createElement('ul');
  tr.style.marginTop = '8px';
  for (const t of g.troubleshooting || []) {
    const li = document.createElement('li');
    li.textContent = t;
    tr.appendChild(li);
  }
  sec('4 · Troubleshooting', tr);
}

// Copy AI Setup Prompt
$('btn-copy-prompt').onclick = async () => {
  const { settings } = await send({ type: 'get-status' });
  await navigator.clipboard.writeText(buildAgentSetupPrompt(settings));
  const b = $('btn-copy-prompt');
  const original = b.innerHTML;
  b.innerHTML = '<span>✓ Copied! Paste into your Agent</span>';
  setTimeout(() => (b.innerHTML = original), 2500);
};

const backBtn = $('btn-back-guide');
if (backBtn) {
  backBtn.onclick = () => show('connect');
}

$('btn-done').onclick = () => show('done');
$('btn-dash').onclick = () => {
  location.href = 'dashboard.html';
};

// Initial view
show('welcome');
prefillConnect();
