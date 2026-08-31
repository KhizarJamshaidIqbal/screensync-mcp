import { updateStatusPill, updateSseChip } from '../components/status-pill.js';
import { mountFrameViewer } from '../components/frame-viewer.js';
import { mountFeed } from '../components/activity-feed.js';
import { mountControlPad } from '../components/control-pad.js';
import { mountCatalog } from '../components/catalog-browser.js';
import { mountWebAccess } from '../components/web-access.js';
import { renderViewers } from '../components/inspection-viewer.js';

const send = (msg) => chrome.runtime.sendMessage(msg);

const pill = document.getElementById('status-pill');
const sseChip = document.getElementById('sse-chip');
const deviceChip = document.getElementById('device-chip');

const frame = mountFrameViewer(document.getElementById('frame'), send);
const feed = mountFeed(document.getElementById('feed'));
mountControlPad(document.getElementById('control'), send, document.getElementById('pad-result'));
mountCatalog(document.getElementById('catalog'), send);
mountWebAccess(document.getElementById('web-access'), send);
renderViewers(document.getElementById('viewers'), send);

document.getElementById('btn-pair').onclick = async () => {
  const s = await send({ type: 'get-status' });
  chrome.tabs.create({ url: s.settings.hubUrl.replace(/\/$/, '') + '/pair' });
};
document.getElementById('btn-setup').onclick = () => {
  location.href = 'onboarding.html';
};

function applySnapshot(cache) {
  updateStatusPill(pill, cache);
  updateSseChip(sseChip, cache);
  feed.setAll(cache.events || []);
}

const port = chrome.runtime.connect({ name: 'dashboard' });
port.onMessage.addListener((msg) => {
  switch (msg.kind) {
    case 'snapshot':
      applySnapshot(msg.cache);
      break;
    case 'sse':
      feed.push(msg.event);
      if (msg.event.type === 'frame') frame.refresh();
      if (msg.event.type === 'inspection' || msg.event.type === 'patch') {
        renderViewers(document.getElementById('viewers'), send);
      }
      break;
    case 'sse-status':
    case 'health':
      send({ type: 'get-status' }).then((r) => {
        updateStatusPill(pill, r.cache);
        updateSseChip(sseChip, r.cache);
      });
      break;
  }
});

async function refreshDevice() {
  const r = await send({ type: 'get-device-status' });
  if (r.ok && r.result) {
    deviceChip.hidden = false;
    deviceChip.className = 'pill ' + (r.result.connected ? 'ok' : 'off');
    deviceChip.textContent = r.result.deviceModel
      ? `${r.result.deviceModel} · ${r.result.retainedFrames} frames`
      : 'no device';
  }
}

frame.refresh();
refreshDevice();
setInterval(refreshDevice, 30000);
