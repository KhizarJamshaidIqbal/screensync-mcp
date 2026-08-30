export function mountControlPad(el, send, resultEl) {
  el.innerHTML = `
    <div class="row spread">
      <strong>Device control</strong>
      <span class="dim" style="font-size:12px">ADB via hub</span>
    </div>
    <div class="pad-grid">
      <label class="field"><span>Type text</span>
        <div class="row"><input class="input" id="cp-text" placeholder="hello"><button class="btn btn-ghost btn-sm" id="cp-type">Type</button></div>
      </label>
      <label class="field"><span>Key event</span>
        <div class="row">
          <select class="input" id="cp-key">
            <option>BACK</option><option>HOME</option><option>ENTER</option>
            <option>KEYCODE_DEL</option><option>KEYCODE_APP_SWITCH</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="cp-keybtn">Press</button>
        </div>
      </label>
      <label class="field"><span>Scroll</span>
        <div class="row">
          <select class="input" id="cp-scroll">
            <option>up</option><option>down</option><option>left</option><option>right</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="cp-scrollbtn">Scroll</button>
        </div>
      </label>
      <label class="field"><span>Launch app</span>
        <div class="row"><input class="input" id="cp-pkg" placeholder="com.android.settings"><button class="btn btn-ghost btn-sm" id="cp-launch">Launch</button></div>
      </label>
    </div>
    <div class="row mt">
      <button class="btn btn-ghost btn-sm" id="cp-shot">📸 Screenshot now</button>
      <button class="btn btn-ghost btn-sm" id="cp-ping">Ping hub</button>
      <button class="btn btn-ghost btn-sm" id="cp-status">Device info</button>
    </div>`;

  const $ = (id) => el.querySelector('#' + id);
  const report = (txt, ok = true) => {
    resultEl.textContent = txt;
    resultEl.style.color = ok ? 'var(--success)' : 'var(--danger)';
  };
  const run = async (fn) => {
    try {
      const r = await fn();
      report(r.ok ? (r.result && (r.result.detail || 'OK — ' + JSON.stringify(r.result).slice(0, 60)) || 'OK') : (r.error || 'failed'), r.ok);
    } catch (e) {
      report(e.message, false);
    }
  };

  $('cp-type').onclick = () => run(() => send({ type: 'send-control', action: 'type', body: { text: $('cp-text').value } }));
  $('cp-keybtn').onclick = () => run(() => send({ type: 'send-control', action: 'key', body: { key: $('cp-key').value } }));
  $('cp-scrollbtn').onclick = () => run(() => send({ type: 'send-control', action: 'scroll', body: { direction: $('cp-scroll').value } }));
  $('cp-launch').onclick = () => run(() => send({ type: 'send-control', action: 'launch', body: { package: $('cp-pkg').value } }));
  $('cp-shot').onclick = () => run(() => send({ type: 'send-control', action: 'screenshot', body: {} }));
  $('cp-ping').onclick = () => run(() => send({ type: 'probe', url: null }).then(async (r) => {
    if (r.ok) return r;
    const s = await send({ type: 'get-status' });
    return send({ type: 'probe', url: s.settings.hubUrl });
  }));
  $('cp-status').onclick = () => run(() => send({ type: 'send-control', action: 'status', body: {} }));
}
