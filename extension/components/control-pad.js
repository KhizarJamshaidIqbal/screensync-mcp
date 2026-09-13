export function mountControlPad(el, send, toastFn) {
  el.innerHTML = `
    <div class="row spread">
      <strong>Device Control</strong>
      <span class="dim" style="font-size:var(--text-xs)">ADB via hub</span>
    </div>

    <div class="control-section">
      <div class="control-section-title">Navigation & Quick Actions</div>
      <div class="control-nav">
        <button class="btn-icon" id="cp-home" data-tooltip="Home">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
        <button class="btn-icon" id="cp-back" data-tooltip="Back">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <button class="btn-icon" id="cp-recents" data-tooltip="App Switcher">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2"/>
            <path d="M3 9h18"/>
            <path d="M3 15h18"/>
          </svg>
        </button>
        <button class="btn-icon" id="cp-shot" data-tooltip="Screenshot">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
            <circle cx="12" cy="13" r="3"/>
          </svg>
        </button>
        <button class="btn-icon" id="cp-ping" data-tooltip="Ping Hub">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
        </button>
        <button class="btn-icon" id="cp-status" data-tooltip="Device Status">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4"/>
            <path d="M12 8h.01"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="control-section">
      <div class="control-section-title">Type text / Voice</div>
      <div class="control-text-row">
        <input class="input" id="cp-text" placeholder="Type text or click mic to speak...">
        <button class="btn btn-ghost btn-sm" id="cp-mic" data-tooltip="Voice Copilot" title="Speak to type">
          <svg class="icon-svg-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
          </svg>
        </button>
        <button class="btn btn-ghost btn-sm" id="cp-type">
          <svg class="icon-svg-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          Send
        </button>
      </div>
    </div>

    <div class="control-section">
      <div class="control-section-title">Scroll D-Pad</div>
      <div class="dpad">
        <button class="btn-icon" data-dir="up" data-tooltip="Scroll Up">▲</button>
        <button class="btn-icon" data-dir="left" data-tooltip="Scroll Left">◀</button>
        <button class="btn-icon" data-dir="right" data-tooltip="Scroll Right">▶</button>
        <button class="btn-icon" data-dir="down" data-tooltip="Scroll Down">▼</button>
      </div>
    </div>

    <div class="control-section">
      <div class="control-section-title">Key event</div>
      <div class="control-text-row">
        <select class="input" id="cp-key">
          <option>BACK</option><option>HOME</option><option>ENTER</option>
          <option>KEYCODE_DEL</option><option>KEYCODE_APP_SWITCH</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="cp-keybtn">Press</button>
      </div>
    </div>

    <div class="control-section">
      <div class="control-section-title">Launch app</div>
      <div class="control-text-row">
        <input class="input" id="cp-pkg" placeholder="e.g. com.android.settings">
        <button class="btn btn-ghost btn-sm" id="cp-launch">Launch</button>
      </div>
    </div>`;

  const $ = (id) => el.querySelector('#' + id);
  const report = (txt, ok = true) => {
    if (toastFn) toastFn(txt, ok ? 'ok' : 'error');
  };
  const run = async (fn) => {
    try {
      const r = await fn();
      report(r.ok ? (r.result && (r.result.detail || 'OK') || 'OK') : (r.error || 'failed'), r.ok);
    } catch (e) { report(e.message, false); }
  };

  $('cp-home').onclick = () => run(() => send({ type: 'send-control', action: 'key', body: { key: 'HOME' } }));
  $('cp-back').onclick = () => run(() => send({ type: 'send-control', action: 'key', body: { key: 'BACK' } }));
  $('cp-recents').onclick = () => run(() => send({ type: 'send-control', action: 'key', body: { key: 'KEYCODE_APP_SWITCH' } }));
  $('cp-shot').onclick = () => run(() => send({ type: 'send-control', action: 'screenshot', body: {} }));
  $('cp-type').onclick = () => run(() => send({ type: 'send-control', action: 'type', body: { text: $('cp-text').value } }));
  $('cp-keybtn').onclick = () => run(() => send({ type: 'send-control', action: 'key', body: { key: $('cp-key').value } }));
  $('cp-launch').onclick = () => run(() => send({ type: 'send-control', action: 'launch', body: { package: $('cp-pkg').value } }));

  $('cp-ping').onclick = () => run(() => send({ type: 'probe', url: null }).then(async (r) => {
    if (r.ok) return r;
    const s = await send({ type: 'get-status' });
    return send({ type: 'probe', url: s.settings?.hubUrl });
  }));
  $('cp-status').onclick = () => run(() => send({ type: 'send-control', action: 'status', body: {} }));

  // D-pad scroll
  for (const btn of el.querySelectorAll('.dpad [data-dir]')) {
    btn.onclick = () => run(() => send({ type: 'send-control', action: 'scroll', body: { direction: btn.dataset.dir } }));
  }

  // Speech Recognition (Voice Copilot)
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = $('cp-mic');
  let recognition = null;
  let isListening = false;
  if (SpeechRec && micBtn) {
    try {
      recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        isListening = true;
        micBtn.style.color = '#EF4444';
        micBtn.style.borderColor = '#EF4444';
        report('Voice Copilot: Listening...', true);
      };
      recognition.onresult = (e) => {
        const transcript = Array.from(e.results).map((r) => r[0].transcript).join('');
        $('cp-text').value = transcript;
      };
      recognition.onerror = (e) => {
        isListening = false;
        micBtn.style.color = '';
        micBtn.style.borderColor = '';
        report('Speech error: ' + (e.error || 'unknown'), false);
      };
      recognition.onend = () => {
        isListening = false;
        micBtn.style.color = '';
        micBtn.style.borderColor = '';
      };

      micBtn.onclick = () => {
        if (isListening) {
          recognition.stop();
        } else {
          try { recognition.start(); } catch { recognition.stop(); }
        }
      };
    } catch {
      if (micBtn) micBtn.onclick = () => report('Speech recognition init error', false);
    }
  } else if (micBtn) {
    micBtn.onclick = () => report('Speech recognition not supported in this browser.', false);
  }

  // Ctrl+Enter to send text
  $('cp-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('cp-type').click();
  });
}
