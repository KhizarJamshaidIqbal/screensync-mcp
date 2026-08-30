export function updateStatusPill(el, cache) {
  const ok = cache.healthOk;
  const sse = cache.sseStatus;
  let cls = 'off';
  let label = 'Hub offline';
  if (ok && sse === 'connected') {
    cls = 'ok';
    label = `Connected · ${cache.latencyMs != null ? cache.latencyMs + 'ms' : 'live'}`;
  } else if (ok) {
    cls = cache.latencyMs != null && cache.latencyMs > 400 ? 'warn' : 'ok';
    label = `Connected · ${cache.latencyMs != null ? cache.latencyMs + 'ms' : '?'}`;
  }
  el.className = `pill ${cls}`;
  el.innerHTML = `<span class="dot ${cls} ${sse === 'connected' ? 'live' : ''}"></span><span>${label}</span>`;
  el.title = cache.sseDetail ? `SSE: ${cache.sseStatus} — ${cache.sseDetail}` : `SSE: ${sse}`;
}

export function updateSseChip(el, cache) {
  const live = cache.sseStatus === 'connected';
  el.className = `pill ${live ? 'ok' : 'off'}`;
  el.innerHTML = `<span class="dot ${live ? 'ok live' : 'off'}"></span><span>${live ? 'SSE Live' : 'SSE ' + cache.sseStatus}</span>`;
}
