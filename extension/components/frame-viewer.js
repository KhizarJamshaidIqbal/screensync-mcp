export function mountFrameViewer(root, send) {
  root.classList.add('frame-wrap');
  root.innerHTML = `<div class="frame-empty">Waiting for the first frame…<br>Tap the bubble on the phone to capture.</div>`;
  let img = null;

  async function refresh() {
    const res = await send({ type: 'get-latest-frame' });
    if (!res.ok || !res.result || !res.result.imageDataUrl) return;
    if (!img) {
      root.innerHTML = '';
      img = document.createElement('img');
      img.alt = 'Live phone screen';
      root.appendChild(img);
    }
    img.src = res.result.imageDataUrl;
  }

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
