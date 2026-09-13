export async function renderViewers(el, send) {
  el.innerHTML = '';
  const h = document.createElement('strong');
  h.textContent = 'AI Findings';
  el.appendChild(h);

  const [insp, patch] = await Promise.all([
    send({ type: 'get-inspection' }),
    send({ type: 'get-patch' }),
  ]);

  const box = (title, bodyFn) => {
    const card = document.createElement('div');
    card.className = 'card findings-card';
    const t = document.createElement('div');
    t.style.fontWeight = '700';
    t.style.fontSize = 'var(--text-sm)';
    t.style.marginBottom = 'var(--sp-2)';
    t.textContent = title;
    card.appendChild(t);
    bodyFn(card);
    el.appendChild(card);
  };

  if (insp.ok && insp.result) {
    box(`Inspection · ${insp.result.bugs?.length || 0} region(s)`, (card) => {
      const p = document.createElement('p');
      p.className = 'dim';
      p.style.fontSize = 'var(--text-sm)';
      p.textContent = insp.result.summary || '(no summary)';
      card.appendChild(p);
      for (const b of insp.result.bugs || []) {
        const li = document.createElement('div');
        li.className = 'bug-item';
        const sev = document.createElement('span');
        const sevLevel = (b.severity || 'info').toLowerCase();
        sev.className = `bug-severity ${sevLevel === 'critical' ? 'critical' : sevLevel === 'warning' ? 'warning' : 'info'}`;
        sev.textContent = b.severity || 'info';
        const desc = document.createElement('span');
        desc.textContent = `${b.label || b.type || 'region'} @ ${Math.round((b.x || 0) * 100)}%,${Math.round((b.y || 0) * 100)}%`;
        li.append(sev, desc);
        card.appendChild(li);
      }
    });
  } else {
    box('Inspection', (c) => {
      const p = document.createElement('p');
      p.className = 'dim';
      p.style.fontSize = 'var(--text-sm)';
      p.textContent = 'No inspection published yet.';
      c.appendChild(p);
    });
  }

  if (patch.ok && patch.result) {
    box('Latest Patch', (card) => {
      const p = document.createElement('p');
      p.className = 'dim';
      p.style.fontSize = 'var(--text-sm)';
      p.textContent = patch.result.description || '';
      card.appendChild(p);
      const pre = document.createElement('pre');
      pre.className = 'code-block patch-viewer mt';
      // Basic syntax highlighting for diff
      const raw = (patch.result.patch || '').slice(0, 2000);
      const lines = raw.split('\n');
      for (const line of lines) {
        const span = document.createElement('span');
        if (line.startsWith('+')) span.className = 'line-add';
        else if (line.startsWith('-')) span.className = 'line-del';
        else if (line.startsWith('@@')) span.className = 'line-hdr';
        span.textContent = line + '\n';
        pre.appendChild(span);
      }
      card.appendChild(pre);
    });
  } else {
    box('Patch', (c) => {
      const p = document.createElement('p');
      p.className = 'dim';
      p.style.fontSize = 'var(--text-sm)';
      p.textContent = 'No patch published yet.';
      c.appendChild(p);
    });
  }
}
