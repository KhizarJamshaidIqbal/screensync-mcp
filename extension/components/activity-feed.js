function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour12: false });
  } catch {
    return '';
  }
}

export function mountFeed(el) {
  el.classList.add('feed-list');
  el.innerHTML = '<div class="dim" style="font-size:12.5px">No activity yet — events stream in live.</div>';
  let count = 0;

  function item(ev) {
    const d = document.createElement('div');
    d.className = 'feed-item';
    const label =
      ev.type === 'tool' ? ev.label || 'tool' :
      ev.type === 'frame' ? 'frame' :
      String(ev.type || 'event');
    const badge = document.createElement('span');
    badge.className = `badge ${ev.type}`;
    badge.textContent = label + (ev.ok === false ? ' ✕' : '');
    const who = document.createElement('span');
    who.className = 'dim';
    who.textContent = ev.agentName || '';
    const t = document.createElement('span');
    t.className = 't';
    t.style.marginLeft = 'auto';
    t.textContent = fmtTime(ev.at);
    d.append(badge, who, t);
    return d;
  }

  return {
    push(ev) {
      if (count === 0) el.innerHTML = '';
      count++;
      el.prepend(item(ev));
      while (el.children.length > 50) el.lastChild.remove();
    },
    setAll(list) {
      el.innerHTML = '';
      count = 0;
      for (const ev of list) {
        count++;
        el.appendChild(item(ev));
      }
      if (!count) el.innerHTML = '<div class="dim" style="font-size:12.5px">No activity yet — events stream in live.</div>';
    },
  };
}
