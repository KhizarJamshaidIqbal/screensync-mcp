export function mountFrameViewer(root, send) {
  root.classList.add('frame-wrap');
  root.innerHTML = `<div class="frame-empty"><span class="empty-icon">📱</span>Waiting for the first frame…<br>Tap the bubble on the phone to capture.</div>`;
  let img = null;
  let frameAt = null;

  const coords = document.createElement('div');
  coords.className = 'frame-coords';
  root.appendChild(coords);

  const meta = document.createElement('div');
  meta.className = 'frame-meta';
  root.parentElement?.appendChild(meta);

  function updateAge() {
    if (!frameAt) return;
    const diff = Math.round((Date.now() - frameAt) / 1000);
    const cls = diff < 10 ? 'fresh' : diff < 60 ? 'stale' : 'old';
    const label = diff < 60 ? `${diff}s ago` : `${Math.floor(diff / 60)}m ago`;
    meta.textContent = label;
    meta.className = `frame-meta ${cls}`;
  }

  setInterval(updateAge, 1000);

  async function refresh() {
    const res = await send({ type: 'get-latest-frame' });
    if (!res.ok || !res.result || !res.result.imageDataUrl) return;
    if (!img) {
      root.innerHTML = '';
      img = document.createElement('img');
      img.alt = 'Live phone screen';
      root.appendChild(img);
      root.appendChild(coords);
    }
    img.src = res.result.imageDataUrl;
    frameAt = res.result.capturedAt ? new Date(res.result.capturedAt).getTime() : Date.now();
    updateAge();
  }

  root.addEventListener('mousemove', (e) => {
    if (!img) return;
    const r = img.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      coords.style.opacity = '0';
      return;
    }
    const x = Math.round(((e.clientX - r.left) / r.width) * img.naturalWidth);
    const y = Math.round(((e.clientY - r.top) / r.height) * img.naturalHeight);
    coords.textContent = `${x}, ${y}`;
    coords.style.opacity = '1';
  });

  root.addEventListener('mouseleave', () => { coords.style.opacity = '0'; });

  root.addEventListener('click', async (e) => {
    if (!img) return;
    const r = img.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    const x = Math.round(((e.clientX - r.left) / r.width) * img.naturalWidth);
    const y = Math.round(((e.clientY - r.top) / r.height) * img.naturalHeight);
    const ripple = document.createElement('span');
    ripple.className = 'tap-ripple';
    ripple.style.left = `${e.clientX - r.left}px`;
    ripple.style.top = `${e.clientY - r.top}px`;
    root.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);
    await send({ type: 'send-control', action: 'tap', body: { x, y } });
  });

  return { refresh };
}
