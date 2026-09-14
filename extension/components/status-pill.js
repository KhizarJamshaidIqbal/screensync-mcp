export function updateStatusPill(el, cache) {
  const ok = cache.healthOk;
  const sse = cache.sseStatus;
  let cls = 'off';
  let label = 'Hub offline';
  if (ok && sse === 'connected') {
    cls = cache.latencyMs != null && cache.latencyMs > 400 ? 'warn' : 'ok';
    label = `Connected · ${cache.latencyMs != null ? cache.latencyMs + 'ms' : 'live'}`;
  } else if (ok && (sse === 'connecting' || sse === 'reconnecting')) {
    cls = 'warn';
    label = `SSE connecting… (${cache.latencyMs != null ? cache.latencyMs + 'ms' : 'hub ok'})`;
  } else if (ok) {
    cls = 'off';
    label = `SSE offline · Hub ${cache.latencyMs != null ? cache.latencyMs + 'ms' : 'up'}`;
  }

  // Animate text change
  const prev = el.getAttribute('data-label');
  if (prev && prev !== label) {
    el.style.opacity = '0';
    setTimeout(() => {
      el.className = `pill ${cls}`;
      el.innerHTML = `<span class="dot ${cls} ${sse === 'connected' ? 'live' : ''}"></span><span>${label}</span>`;
      el.setAttribute('data-label', label);
      el.style.opacity = '1';
    }, 150);
  } else {
    el.className = `pill ${cls}`;
    el.innerHTML = `<span class="dot ${cls} ${sse === 'connected' ? 'live' : ''}"></span><span>${label}</span>`;
    el.setAttribute('data-label', label);
  }
  el.style.transition = 'opacity .15s ease';
  el.title = cache.sseDetail ? `SSE: ${cache.sseStatus} — ${cache.sseDetail}` : `SSE: ${sse}`;
}

export function updateSseChip(el, cache) {
  const live = cache.sseStatus === 'connected';
  el.className = `pill ${live ? 'ok' : 'off'}`;
  el.innerHTML = `<span class="dot ${live ? 'ok live' : 'off'}"></span><span>${live ? 'SSE Live' : 'SSE ' + cache.sseStatus}</span>`;
}
