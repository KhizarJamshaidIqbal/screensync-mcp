import { buildConnectKit } from '../lib/connect-kit.js';

export async function mountCatalog(el, send) {
  el.innerHTML = '<div class="dim">Loading MCP catalog…</div>';
  const res = await send({ type: 'get-catalog' });
  if (!res.ok) {
    el.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'err';
    d.textContent = 'Catalog unavailable: ' + (res.error || 'hub unreachable');
    el.appendChild(d);
    return;
  }
  const cat = res.result;
  const status = await send({ type: 'get-status' });
  const { hubUrl, token } = status.settings;

  el.innerHTML = '';

  // Header
  const head = document.createElement('div');
  head.className = 'catalog-header';
  const title = document.createElement('strong');
  title.textContent = `${cat.server?.name || 'screensync'} v${cat.server?.version || ''}`;
  head.appendChild(title);

  // Search
  const searchWrap = document.createElement('div');
  searchWrap.className = 'search-wrap';
  searchWrap.style.flex = '1';
  const searchIcon = document.createElement('span');
  searchIcon.className = 'search-icon';
  searchIcon.textContent = '🔍';
  const searchInput = document.createElement('input');
  searchInput.className = 'input';
  searchInput.placeholder = 'Search tools, prompts, resources…';
  searchWrap.append(searchIcon, searchInput);
  head.appendChild(searchWrap);

  const copy = document.createElement('button');
  copy.className = 'btn btn-primary btn-sm';
  copy.textContent = '📋 Copy Connect Kit';
  copy.onclick = async () => {
    const kit = buildConnectKit({
      hubUrl,
      token,
      stdioNote: cat.connection?.stdio?.note || '',
      usage: cat.recommendedUsage || [],
    });
    await navigator.clipboard.writeText(kit);
    copy.textContent = 'Copied ✓';
    setTimeout(() => (copy.textContent = '📋 Copy Connect Kit'), 1500);
  };
  head.appendChild(copy);
  el.appendChild(head);

  const stdioOnly = new Set([
    'get_ui_hierarchy', 'control_tap_text', 'control_swipe_until',
    'control_open_url', 'compare_frames', 'get_logcat',
    'record_screen', 'wait_for_frame',
  ]);

  const allSections = [];

  const section = (name, items) => {
    const sec = document.createElement('div');
    sec.className = 'cat-sec';
    const h = document.createElement('h3');
    h.textContent = `${name} (${items.length})`;
    sec.appendChild(h);
    const itemEls = [];
    for (const it of items) {
      const box = document.createElement('div');
      box.className = 'cat-item';
      box.dataset.name = (it.name || it.uri || '').toLowerCase();
      box.dataset.desc = (it.description || '').toLowerCase();

      const btn = document.createElement('button');
      const nm = document.createElement('span');
      nm.textContent = it.name || it.uri || '';
      btn.appendChild(nm);

      if (name === 'Tools' && stdioOnly.has(it.name)) {
        const note = document.createElement('span');
        note.className = 'stdio-note';
        note.textContent = 'via MCP stdio';
        btn.appendChild(note);
      }

      // Copy name button
      const cpBtn = document.createElement('span');
      cpBtn.className = 'copy-name';
      cpBtn.textContent = '📋';
      cpBtn.title = 'Copy name';
      cpBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(it.name || it.uri || '');
        cpBtn.textContent = '✓';
        setTimeout(() => (cpBtn.textContent = '📋'), 1000);
      };
      btn.appendChild(cpBtn);

      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = it.description || '';
      btn.onclick = () => box.classList.toggle('open');
      box.append(btn, desc);
      sec.appendChild(box);
      itemEls.push(box);
    }
    el.appendChild(sec);
    allSections.push({ sec, items: itemEls, heading: h, total: items.length });
  };

  section('Tools', cat.tools || []);
  section('Prompts / Skills', cat.prompts || []);
  section('Resources', cat.resources || []);

  if (Array.isArray(cat.recommendedUsage) && cat.recommendedUsage.length) {
    const sec = document.createElement('div');
    sec.className = 'cat-sec';
    const h = document.createElement('h3');
    h.textContent = 'Recommended agent workflow';
    sec.appendChild(h);
    const ol = document.createElement('ol');
    ol.style.marginLeft = '18px';
    ol.style.fontSize = 'var(--text-sm)';
    ol.style.color = 'var(--dim)';
    for (const u of cat.recommendedUsage) {
      const li = document.createElement('li');
      li.textContent = u;
      ol.appendChild(li);
    }
    sec.appendChild(ol);
    el.appendChild(sec);
  }

  // Search filter
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    for (const { items, heading, total } of allSections) {
      let visible = 0;
      for (const box of items) {
        const match = !q || box.dataset.name.includes(q) || box.dataset.desc.includes(q);
        box.style.display = match ? '' : 'none';
        if (match) visible++;
      }
      heading.textContent = heading.textContent.replace(/\(\d+\)/, `(${visible})`);
    }
  });
}
