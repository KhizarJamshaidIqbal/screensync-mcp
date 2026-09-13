const ICONS = {
  frame: '🖼️', tool: '🔧', agent_connect: '🔌', inspection: '🔍',
  patch: '🩹', web_request: '🌐', default: '📡',
};

function iconFor(type) {
  if (ICONS[type]) return ICONS[type];
  if (type?.startsWith('control_')) return '🎮';
  if (type?.startsWith('web_')) return '🌐';
  return ICONS.default;
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour12: false }); }
  catch { return ''; }
}

function filterCategory(type) {
  if (!type) return 'other';
  if (type.startsWith('control_')) return 'control';
  if (type.startsWith('web_') || type === 'agent_connect') return 'agent';
  return type;
}

export function mountFeed(el) {
  el.innerHTML = '';
  let currentFilter = 'all';
  let count = 0;

  // Header
  const header = document.createElement('div');
  header.className = 'feed-header';
  const title = document.createElement('strong');
  title.textContent = 'Activity';
  header.appendChild(title);

  const filters = document.createElement('div');
  filters.className = 'feed-filters';
  const filterNames = ['all', 'frame', 'tool', 'control', 'agent', 'inspection'];
  const filterBtns = {};

  for (const f of filterNames) {
    const btn = document.createElement('button');
    btn.className = `feed-filter-btn${f === 'all' ? ' active' : ''}`;
    btn.textContent = f;
    btn.onclick = () => {
      currentFilter = f;
      for (const k in filterBtns) filterBtns[k].classList.toggle('active', k === f);
      applyFilter();
    };
    filters.appendChild(btn);
    filterBtns[f] = btn;
  }

  const clearBtn = document.createElement('button');
  clearBtn.className = 'feed-filter-btn';
  clearBtn.textContent = '✕ Clear';
  clearBtn.onclick = () => { list.innerHTML = ''; count = 0; showEmpty(); };
  filters.appendChild(clearBtn);
  header.appendChild(filters);
  el.appendChild(header);

  // List
  const list = document.createElement('div');
  list.className = 'feed-list';
  el.appendChild(list);

  function showEmpty() {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">📡</span>No activity yet — events stream in live.</div>';
  }
  showEmpty();

  function applyFilter() {
    for (const child of list.children) {
      if (currentFilter === 'all') { child.style.display = ''; continue; }
      child.style.display = filterCategory(child.dataset.type) === currentFilter ? '' : 'none';
    }
  }

  function item(ev) {
    const d = document.createElement('div');
    d.className = 'feed-item';
    d.dataset.type = ev.type || '';

    const icon = document.createElement('span');
    icon.className = 'ev-icon';
    icon.textContent = iconFor(ev.type);

    const label = ev.type === 'tool' ? (ev.label || 'tool') :
                  ev.type === 'frame' ? 'frame' : String(ev.type || 'event');
    const badge = document.createElement('span');
    badge.className = `badge ${ev.type || ''}`;
    badge.textContent = label + (ev.ok === false ? ' ✕' : '');

    const who = document.createElement('span');
    who.className = 'ev-agent';
    who.textContent = ev.agentName || '';

    const t = document.createElement('span');
    t.className = 'ev-time';
    t.textContent = fmtTime(ev.at);

    const detail = document.createElement('div');
    detail.className = 'ev-detail';
    detail.textContent = JSON.stringify(ev, null, 2);

    d.append(icon, badge, who, t, detail);
    d.onclick = () => d.classList.toggle('expanded');
    return d;
  }

  return {
    push(ev) {
      if (count === 0) list.innerHTML = '';
      count++;
      const el = item(ev);
      list.prepend(el);
      while (list.children.length > 100) list.lastChild.remove();
      applyFilter();
    },
    setAll(evts) {
      list.innerHTML = '';
      count = 0;
      for (const ev of evts) {
        count++;
        list.appendChild(item(ev));
      }
      if (!count) showEmpty();
      applyFilter();
    },
  };
}
