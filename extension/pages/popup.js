import { updateStatusPill } from '../components/status-pill.js';

const send = (msg) => chrome.runtime.sendMessage(msg);

const r = await send({ type: 'get-status' });
updateStatusPill(document.getElementById('pill'), r.cache);

const meta = document.getElementById('meta');
if (r.cache.lastFrameAt) {
  meta.textContent = 'Last frame: ' + new Date(r.cache.lastFrameAt).toLocaleTimeString();
} else {
  meta.textContent = 'No frames yet — tap the bubble on the phone.';
}

if (!r.settings.onboardingComplete) {
  location.href = 'onboarding.html';
}

send({ type: 'get-latest-frame' }).then((f) => {
  if (f.ok && f.result && f.result.imageDataUrl) {
    const img = document.getElementById('thumb');
    img.src = f.result.imageDataUrl;
    img.hidden = false;
  }
});

document.getElementById('open').onclick = () => send({ type: 'open-dashboard' });
document.getElementById('setup').onclick = () => { location.href = 'onboarding.html'; };
