# ScreenSync MCP — Marketing Website Master Plan (epsoldev.com)

> **Status:** IN PROGRESS — check ✅ boxes below as steps complete.
> **Resume rule:** Agar naya account/session start ho, YEH FILE parho, "Progress Tracker"
> dekho, aur jahan se ruka wahan se continue karo. Sab decisions is file mein locked hain.
> **Date started:** 2026-08-29

---

## 0. Locked Decisions (DO NOT re-ask the user)

| Decision | Value |
|---|---|
| Stack | **Pure HTML + CSS + Tailwind CSS (CDN or CLI) + Vanilla JavaScript** — ❌ NO React/Next.js |
| Theme | **LIGHT theme** (luxury, premium, polished — NOT dark) |
| Design feel | Fully modern, luxury, polish — glassmorphism-lite, soft shadows, generous whitespace, premium typography |
| Responsive | Desktop + mobile 100% friendly (mobile-first breakpoints) |
| Icons | Modern icon set (Lucide icons via CDN / inline SVG) |
| Animations | Scroll-reveal (IntersectionObserver), smooth micro-interactions, hero animations — tasteful, performance-safe |
| SEO | Google + AI friendly: semantic HTML5, meta/OG tags, JSON-LD structured data, sitemap.xml, robots.txt, fast LCP |
| Domain | **https://epsoldev.com/** |
| Contact email | use `contact@epsoldev.com` (placeholder — user owns domain) |
| Brand colors | Purple family from app logo: primary `#6541D6`, deep `#150E27`, light lavender `#EFEAF9`, white `#FFFFFF` |
| Logo asset | `assets/branding/app_icon.png` (v4_icon_clean) + `logo_options/v6_splash_flat.png` |
| Output folder | `C:\Users\epsol\Downloads\screensync_flutter_mcp_project\website\` |

## 1. Pages (5 total — same shared layout/navbar/footer, Home gets extra-premium design)

1. **index.html** — Home / Landing (hero, features, how-it-works, MCP tools, screenshots gallery, architecture diagram, FAQ, CTA)
2. **privacy.html** — Privacy Policy (FULL huge detail — covers everything the app actually does)
3. **about.html** — About Us (EpsolDev, mission, product story)
4. **data-policy.html** — Data Policy (what data, where stored, LAN vs Drive, retention, security)
5. **goal.html** — Goal / Vision page

## 2. Site Structure

```
website/
├── index.html
├── privacy.html
├── about.html
├── data-policy.html
├── goal.html
├── css/custom.css          (extra polish beyond tailwind)
├── js/main.js              (nav, scroll reveal, animations, FAQ accordion)
├── assets/
│   ├── logo.png            (app icon)
│   ├── favicon.png
│   └── screenshots/        (real app screenshots from emulator)
├── sitemap.xml
└── robots.txt
```

## 3. Content Source of Truth (from the actual app — verified)

- **App:** ScreenSync MCP v2.5 (Flutter, Android) — floating-bubble screen capture + LAN/Google Drive sync
- **Tagline:** "Your AI, watching over your shoulder" / THIS PHONE ⟷ YOUR AI
- **Hub:** Node/TS MCP hub, HTTP :3000 + MCP stdio, mDNS discovery (`192.168.1.x:3000`), bearer-token security
- **Transports:** LAN (mDNS + token) → Google Drive BYOS fallback → Hybrid
- **Live:** SSE stream (/api/events), latency sparkline, ConnectionHero diagram
- **MCP tools (25+):** get_latest_screenshot, list_recent_screens, get_device_status, publish_inspection, publish_patch, get_mcp_catalog, get_skills, get_recent_screenshots, control_status, control_screenshot, control_tap, control_long_press, control_swipe, control_scroll, control_type, control_key, control_launch_app, get_ui_hierarchy, control_tap_text, control_swipe_until, control_open_url, compare_frames, wait_for_frame, get_logcat, record_screen
- **MCP prompts:** inspect_latest_mobile_screen, autonomous_ui_test, reproduce_bug, accessibility_audit
- **App features:** floating bubble capture, shake-to-capture, quality presets (Stream/Fast/Inspect), Connect-Kit QR pairing, permission checklist, capture history (SQLite), gallery, diagnostics, telemetry, privacy policy screen, onboarding flow, light/dark theme
- **Screens:** Dashboard, Gallery, Diagnose, MCP catalog, Telemetry, Settings, Onboarding, Pair-scan (QR), Region crop, Annotate, Diff

## 4. Progress Tracker  ← RESUME HERE

- [x] **P1. Screenshots capture** ✅ DONE — dashboard.png, hub.png, gallery.png, diagnose.png, mcp.png, telemetry.png, settings.png saved in website/assets/screenshots/ — emulator se app ke sab main screens ke screenshots lo →
      `website/assets/screenshots/` (dashboard.png, gallery.png, hub.png, settings.png,
      onboarding.png, mcp.png, diagnose.png ...). ADB: `adb -s emulator-5554 exec-out screencap -p > file.png`
      App package: `com.screensync.mcp/.MainActivity`
- [x] **P2. Scaffold** ✅ — website/ + custom.css (reveal, lux-card, marquee, faq, phone-frame) + main.js (scroll reveal, mobile menu, faq, counters, lightbox)
- [x] **P3. index.html** ✅ — hero + stats + diagram + 3 steps + 9 feature cards + tools marquee + 4 prompt cards + screenshot gallery (7 shots + lightbox) + architecture ASCII + FAQ (5) + CTA + footer
- [x] **P4. privacy.html** ✅ — 15 sections full detail (MediaProjection, permissions table, LAN, Drive BYOS, retention, AI agents, security, children, GDPR/CCPA rights, site, changes, contact)
- [x] **P5. data-policy.html** ✅ — data map table, frame flow, transport security table, retention, complete-wipe guide, never-handled list, incident handling
- [x] **P6. about.html** ✅ — story, see/act/trust, beliefs, contact
- [x] **P7. goal.html** ✅ — mission, roadmap timeline (shipped/in-progress/next/horizon), stats, CTA
- [x] **P8. SEO** ✅ — meta/OG/JSON-LD all pages, sitemap.xml, robots.txt, favicon, canonical
- [x] **P9. QA** ✅ — headless Chrome desktop 1440px (9.5/10) + mobile 390px (8.5/10), no broken images/overflow/overlap. Screenshots: site_desktop.png, site_mobile.png
- [x] **P10. Final verify** ✅ — all 5 pages HTTP 200 on local server (`node website/serve.js` → http://localhost:8899)

## ✅ PROJECT COMPLETE — 2026-08-29
Website live-ready in `website/` folder. Deploy: upload website/ contents to epsoldev.com hosting root.

## 5. Design System (Home page premium)

- Font: Inter / Plus Jakarta Sans (Google Fonts), headings tight tracking
- Light luxury: `bg-[#FAFAFC]`, white cards, `shadow-[0_8px_40px_rgba(101,65,214,0.08)]`,
  1px borders `#EDE9F7`, rounded-3xl, purple gradient accents `#6541D6 → #8B6AEC`
- Hero: soft radial lavender glow, floating phone mockup with real screenshot, sparkle accents
- Animations: fade-up on scroll (IntersectionObserver + CSS), hover lift on cards,
  animated dashed connection line (SVG), counter animations for stats
- Nav: sticky glass (backdrop-blur), mobile hamburger
- Footer: epsoldev.com, contact@epsoldev.com, page links, © EpsolDev

---
> Jab bhi ek step complete ho — is file mein checkbox ✅ karo. Naya session ho to yahan se resume.
