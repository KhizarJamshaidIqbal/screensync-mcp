// ScreenSync MCP — site interactions (shared by every page)
(function () {
  'use strict';

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Scroll reveal ----------
  const revealEls = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.05, rootMargin: '60px 0px 0px 0px' });
  revealEls.forEach((el) => io.observe(el));
  // Immediately show any element already in viewport on load (avoids blank flash)
  window.addEventListener('load', () => {
    revealEls.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        el.classList.add('visible');
        io.unobserve(el);
      }
    });
  });

  // ---------- Mobile menu ----------
  const burger = document.getElementById('burger');
  const menu = document.getElementById('mobileMenu');
  if (burger && menu) {
    burger.addEventListener('click', () => {
      menu.classList.toggle('open');
      burger.setAttribute('aria-expanded', menu.classList.contains('open'));
    });
    const closeMenu = (refocus) => {
      menu.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
      if (refocus) burger.focus();
    };
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => closeMenu(false)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('open')) closeMenu(true);
    });
  }

  // ---------- FAQ accordion ----------
  document.querySelectorAll('.faq-item .faq-q').forEach((q) => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach((i) => {
        i.classList.remove('open');
        const b = i.querySelector('.faq-q'); if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) { item.classList.add('open'); q.setAttribute('aria-expanded', 'true'); }
    });
  });

  // ---------- Counter animation ----------
  // The real number is already in the HTML (works without JS); this only animates it up from 0.
  const counters = document.querySelectorAll('[data-count]');
  if (!reduceMotion) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target; cio.unobserve(el);
        const target = parseFloat(el.dataset.count);
        const prefix = el.dataset.prefix || '';
        const suffix = el.dataset.suffix || '';
        const dur = 1400; const t0 = performance.now();
        (function tick(t) {
          const p = Math.min((t - t0) / dur, 1);
          const v = target * (1 - Math.pow(1 - p, 3));
          el.textContent = prefix + (target % 1 === 0 ? Math.round(v) : v.toFixed(1)) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        })(t0);
      });
    }, { threshold: 0.5 });
    counters.forEach((c) => cio.observe(c));
  }

  // ---------- Tool marquee: clone the chip set once so the loop is seamless ----------
  document.querySelectorAll('.marquee-track').forEach((t) => {
    t.insertAdjacentHTML('beforeend', t.innerHTML);
    t.classList.add('is-looping');
  });

  // ---------- Screenshot gallery (lightbox-lite) ----------
  const lb = document.getElementById('lightbox');
  if (lb) {
    let lbImg = document.getElementById('lightboxImg');
    if (!lbImg) { lbImg = document.createElement('img'); lbImg.id = 'lightboxImg'; lb.appendChild(lbImg); }
    lb.tabIndex = -1;
    let opener = null;
    const close = () => {
      lb.classList.add('hidden'); lb.classList.remove('flex');
      document.body.style.overflow = '';
      if (opener) opener.focus();
    };
    const open = (shot) => {
      const thumb = shot.querySelector('img');
      lbImg.src = shot.dataset.shot;
      lbImg.alt = thumb ? thumb.alt : '';
      opener = shot;
      lb.classList.remove('hidden'); lb.classList.add('flex');
      document.body.style.overflow = 'hidden';
      lb.focus();
    };
    document.querySelectorAll('[data-shot]').forEach((shot) => {
      const thumb = shot.querySelector('img');
      shot.tabIndex = 0;
      shot.setAttribute('role', 'button');
      shot.setAttribute('aria-label', 'Enlarge screenshot: ' + (thumb ? thumb.alt : ''));
      shot.addEventListener('click', () => open(shot));
      shot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(shot); }
      });
    });
    lb.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lb.classList.contains('hidden')) close();
    });
  }

  // ---------- Year ----------
  document.querySelectorAll('.year').forEach(y => y.textContent = new Date().getFullYear());

  // ---------- Lucide icons ----------
  // Lucide is loaded with `defer`. A deferred main.js runs after it; a classic main.js at the end of
  // <body> runs before it, so fall back to DOMContentLoaded (deferred scripts finish before it fires).
  let iconsDone = false;
  const icons = () => {
    if (iconsDone || !window.lucide) return;
    iconsDone = true;
    window.lucide.createIcons();
  };
  if (window.lucide) icons();
  else {
    document.addEventListener('DOMContentLoaded', icons);
    window.addEventListener('load', icons);
  }
})();
