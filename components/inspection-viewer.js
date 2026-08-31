// Inspection + patch viewers — hub JSON rendered with safe DOM only.
export async function renderViewers(el, send) {
  el.innerHTML = '';
  const h = document.createElement('strong');
  h.textContent = 'AI findings';
  el.appendChild(h);

  const [insp, patch] = await Promise.all([
    send({ type: 'get-inspection' }),
    send({ type: 'get-patch' }),
  ]);

  const box = (title, bodyFn) => {
    const card = document.createElement('div');
    card.className = 'card mt';
    const t = document.createElement('div');
    t.style.fontWeight = '700';
    t.style.fontSize = '12.5px';
    t.style.marginBottom = '6px';
    t.textContent = title;
    card.appendChild(t);
    bodyFn(card);
    el.appendChild(card);
  };

  if (insp.ok && insp.result) {
    box(`Inspection · ${insp.result.bugs?.length || 0} region(s)`, (card) => {
      const p = document.createElement('p');
      p.className = 'dim';
      p.style.fontSize = '12.5px';
      p.textContent = insp.result.summary || '(no summary)';
      card.appendChild(p);
      for (const b of insp.result.bugs || []) {
        const li = document.createElement('div');
        li.className = 'mono mt';
        li.textContent = `[${b.severity || 'info'}] ${b.label || b.type || 'region'} @ ${Math.round((b.x || 0) * 100)}%,${Math.round((b.y || 0) * 100)}%`;
        card.appendChild(li);
      }
    });
  } else {
    box('Inspection', (c) => {
      const p = document.createElement('p');
      p.className = 'dim';
      p.style.fontSize = '12.5px';
      p.textContent = 'No inspection published yet.';
      c.appendChild(p);
    });
  }

  if (patch.ok && patch.result) {
    box('Latest patch', (card) => {
      const p = document.createElement('p');
      p.className = 'dim';
      p.style.fontSize = '12.5px';
      p.textContent = patch.result.description || '';
      card.appendChild(p);
      const pre = document.createElement('pre');
      pre.className = 'code-block mt';
      pre.textContent = (patch.result.patch || '').slice(0, 2000);
      card.appendChild(pre);
    });
  } else {
    box('Patch', (c) => {
      const p = document.createElement('p');
      p.className = 'dim';
      p.style.fontSize = '12.5px';
      p.textContent = 'No patch published yet.';
      c.appendChild(p);
    });
  }
}
