// ScreenSync MCP — site interactions
(function () {
  'use strict';

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
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => menu.classList.remove('open')));
  }

  // ---------- FAQ accordion ----------
  document.querySelectorAll('.faq-item .faq-q').forEach((q) => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
    });
  });

  // ---------- Counter animation ----------
  const counters = document.querySelectorAll('[data-count]');
  const cio = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target; cio.unobserve(el);
      const target = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      const dur = 1400; const t0 = performance.now();
      (function tick(t) {
        const p = Math.min((t - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target % 1 === 0 ? Math.round(target * eased) : (target * eased).toFixed(1)) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    });
  }, { threshold: 0.5 });
  counters.forEach((c) => cio.observe(c));

  // ---------- Screenshot gallery (lightbox-lite) ----------
  const shots = document.querySelectorAll('[data-shot]');
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightboxImg');
  if (lb && lbImg) {
    shots.forEach(s => s.addEventListener('click', () => {
      lbImg.src = s.dataset.shot;
      lb.classList.remove('hidden'); lb.classList.add('flex');
      document.body.style.overflow = 'hidden';
    }));
    lb.addEventListener('click', () => {
      lb.classList.add('hidden'); lb.classList.remove('flex');
      document.body.style.overflow = '';
    });
  }

  // ---------- Active nav highlight ----------
  const page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav a[href]').forEach(a => {
    if (a.getAttribute('href') === page) a.classList.add('text-[#6541D6]', 'font-semibold');
  });

  // ---------- Year ----------
  document.querySelectorAll('.year').forEach(y => y.textContent = new Date().getFullYear());

  // ---------- Lucide icons ----------
  if (window.lucide) window.lucide.createIcons();
})();
