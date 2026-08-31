// Web access card — the master switch that makes this browser the AI
// agent's eyes and hands on the user's live web tabs (mirrors what the
// mobile app does for the phone).
export function mountWebAccess(el, send) {
  el.innerHTML = `
    <div class="row spread" style="margin-bottom:8px">
      <strong>Web access for AI agents</strong>
      <label class="switch" title="Allow the AI agent to see and act on your browser tabs">
        <input type="checkbox" id="web-toggle">
        <span class="slider"></span>
      </label>
    </div>
    <div class="dim" id="web-sub" style="font-size:12px;line-height:1.5">
      When enabled, your AI agent can see the active tab (web_screenshot), read the page
      (web_hierarchy) and act on it (web_click / web_type / web_navigate / web_scroll)
      through the ScreenSync hub — just like it drives your phone.
    </div>
    <div class="row" style="margin-top:10px;gap:8px">
      <span class="pill off" id="web-pill">checking…</span>
      <button class="btn btn-ghost btn-sm" id="web-test">Test loop</button>
    </div>
    <div class="dim" id="web-tab" style="font-size:12px;margin-top:8px;word-break:break-all"></div>
    <div class="err" id="web-err" style="margin-top:6px;font-size:12px" hidden></div>
  `;
  const toggle = el.querySelector('#web-toggle');
  const pill = el.querySelector('#web-pill');
  const tabRow = el.querySelector('#web-tab');
  const errRow = el.querySelector('#web-err');
  const testBtn = el.querySelector('#web-test');
  let busy = false;

  async function refresh() {
    const r = await send({ type: 'get-web-status' });
    if (!r.ok) return;
    toggle.checked = !!r.webAccessEnabled;
    const b = r.bridge || {};
    if (b.online && r.webAccessEnabled) {
      pill.className = 'pill ok';
      pill.textContent = 'Bridge live · agents can use my browser';
    } else if (b.online) {
      pill.className = 'pill warn';
      pill.textContent = 'Bridge live · access is OFF';
    } else {
      pill.className = 'pill off';
      pill.textContent = 'Waiting for hub heartbeat…';
    }
    tabRow.textContent = b.activeTab && b.activeTab.url
      ? `Active tab: ${b.activeTab.title ? b.activeTab.title + ' — ' : ''}${b.activeTab.url}`
      : '';
    errRow.hidden = true;
  }

  toggle.addEventListener('change', async () => {
    if (busy) return;
    busy = true;
    try {
      await send({ type: 'set-web-access', enabled: toggle.checked });
      await refresh();
    } finally {
      busy = false;
    }
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    errRow.hidden = true;
    try {
      const r = await send({ type: 'web-test' });
      const res = r.result || {};
      if (r.ok && res.ok && res.data && res.data.online) {
        testBtn.textContent = 'Loop OK ✓';
        await refresh();
      } else if (r.ok && res.ok) {
        testBtn.textContent = 'Test loop';
        errRow.textContent = 'Hub reachable but the bridge heartbeat is missing — reload this dashboard once.';
        errRow.hidden = false;
      } else {
        testBtn.textContent = 'Test loop';
        errRow.textContent = res.error || r.error || 'Web loop failed.';
        errRow.hidden = false;
      }
    } finally {
      testBtn.disabled = false;
      setTimeout(() => (testBtn.textContent = 'Test loop'), 1500);
    }
  });

  refresh();
  setInterval(refresh, 30000);
}
