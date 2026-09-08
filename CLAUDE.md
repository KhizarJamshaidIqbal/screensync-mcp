# CLAUDE.md — Agent Rules for ScreenSync MCP

Rules every AI agent working in this repo MUST follow. Not suggestions.

**Project:** Android phone → live screen capture + device control for AI agents over the Model
Context Protocol. Four codebases in one repo:

| Path          | What it is                | Stack                                          |
| ------------- | ------------------------- | ---------------------------------------------- |
| `lib/`        | Flutter phone app         | Dart 3, flutter_bloc, Material 3               |
| `mcp-server/` | Desktop hub + MCP server  | Node ESM + TypeScript, Express 5, MCP SDK      |
| `extension/`  | MV3 browser extension     | Plain ES modules, **no build step, no npm**    |
| `website/`    | Marketing site            | Static HTML + Tailwind CDN + vanilla JS        |

**There is no CI.** No `.github/` exists on any branch. Nothing is automated, nothing will catch
your mistake. Every guarantee below is manual.

---

## 1. Deploying the website — the rule that gets broken

> **Pushing to `main` does NOT update the live site.** Hostinger auto-pulls **`origin/deploy`
> only**. This has already caused one silent failed deploy.

`deploy` holds the website files **at the repo root** (`index.html`, not `website/index.html`).
Its tree must be a **byte-exact mirror** of `main`'s `website/` directory, hoisted up one level.

### Shipping a website change

1. Edit under `website/` on a branch off `main`. Commit, push to `origin/main`. **Not shipped yet.**
2. If you touched `extension/` or the hub, rebuild the committed zips first — see §6.
3. Mirror `main:website/` onto the `deploy` branch root.
4. Commit on `deploy` as `deploy(web): <lowercase summary>`. Keep history **linear**.
5. Push to `origin/deploy`. **This is the step that actually ships.**
6. Verify live at https://screensyncmcp.epsoldev.com — fetch with `cache: 'no-store'` and confirm
   `last-modified` is now, not a cached copy.

### Mirroring safely

`deploy` is usually claimed by a stale worktree, so `git checkout deploy` fails. Either
`git worktree prune` first, or mirror without a checkout using plumbing — preferred, since it
cannot pick up stray files:

```bash
git fetch origin && T=$(git rev-parse origin/main:website) && C=$(git commit-tree $T -p origin/deploy -m "deploy(web): <summary>") && git diff --stat origin/deploy $T && git push origin $C:deploy
```

Always verify before pushing: `git diff --stat origin/deploy origin/main:website` must be **empty**
after the mirror, and `git ls-tree --name-only origin/deploy` must show `index.html` at top level
with **no `website` entry**.

### Never do these

- **Never merge, rebase, cherry-pick or subtree-pull between `main` and `deploy`.** Their histories
  are disjoint (`git merge-base origin/main origin/deploy` exits 1). With
  `--allow-unrelated-histories` you would dump `lib/`, `android/` and `mcp-server/` into
  `public_html` and **publish private source on the open web**. The mirror is a content copy, only.
- **Never mirror from a stale local ref.** Local `main`/`deploy` are routinely behind. Compare
  `origin/main:website` against `origin/deploy^{tree}` — never bare `main:website`. Mirroring from a
  stale `main` silently **reverts** live changes.
- **Never touch `gh-pages`.** Dead single-commit branch from the pre-Hostinger era. Shipping there
  ships nothing.
- **Never commit anything but the website tree to `deploy`.** It is served verbatim as `public_html`
  — world-readable.

---

## 2. Branch workflow: merge, then delete

1. Work on a branch off `main` — never commit directly to `main`.
2. When the work is done: **merge into `main`**, push, then **delete the branch** (local, and remote
   if it was pushed). Do not leave finished branches lying around.
3. If the work touched `website/`, the job is not done until §1 is also complete.
4. Clean up the worktree if you made one (`git worktree remove`, then `git worktree prune`).

**The merge rule applies to `main` only.** `deploy` and `extension` are never merge targets — they
are content mirrors (§1, §6). "Merge then delete" and "never merge into deploy" are not in conflict:
feature branches merge into `main`; `main`'s content is *copied* onto `deploy`.

Before deleting, confirm nothing is lost: `git log --oneline origin/main..<branch>` must be empty.

---

## 3. Architecture guidelines — follow the existing patterns

Read neighbouring files before writing. Match what is there; do not import a new paradigm.

### Flutter app (`lib/`)

- Layers are top-level folders: `blocs/ core/ models/ repositories/ screens/ services/ widgets/`.
  Respect them — no business logic in widgets, no UI in services.
- `snake_case.dart` filenames. Screens are `screens/<thing>_screen.dart`; hub sub-pages are
  `screens/tabs/<thing>_tab.dart`; a big screen's extracted parts live in a folder named after it
  (`screens/dashboard/*.dart`). Reusable UI goes in `widgets/`, a widget family gets its own
  subfolder.
- State is **flutter_bloc**. `*Bloc`, `*Event`, `*State`, `*Service`, `*Repository`.
- Widgets: `const` constructor + `super.key`. **StatelessWidget by default** (63 stateless vs 9
  stateful today) — reach for StatefulWidget only when there is real local state or a controller.
- File-private helper widgets are `class _Foo extends StatelessWidget` at the bottom of the file
  that uses them.
- Models extend `Equatable`, expose `props`, and **parse defensively**:
  `(json['x'] as num?)?.toDouble() ?? 0`, `Enum.values.asNameMap()[json['k']] ?? fallback`.
- **All design tokens live in `lib/core/app_theme.dart`** (`AppTheme.primary`, `radiusL/M/S`,
  `typeDisplay`, `gradPrimary`, …) and motion tokens in `lib/core/motion.dart`. Never hardcode a
  colour, radius or duration in a widget.
- Entry motion uses the house flutter_animate recipe:
  `.animate(delay: N.ms).fadeIn(duration: 420.ms).slideY(begin: 0.06, end: 0, duration: 420.ms, curve: Curves.easeOutCubic)`
- **Never break mobile responsiveness** — the project's stated golden rule. Use
  `Flexible`/`Expanded`/`Wrap`/`LayoutBuilder`, test at ≤360dp, zero RenderFlex overflow.
- Imports use the pubspec name `package:screensync_flutter_project/…` (**not** `screensync_mcp`).

### MCP hub (`mcp-server/`)

- Flat, lowercase, one responsibility per file: `index.ts` (composition root), `config.ts`,
  `events.ts`, `storage.ts`, `catalog.ts` / `catalog-web.ts`, `mcp.ts`, `prompts.ts`, `hub.ts`,
  `web.ts`, `control.ts`.
- **ESM: relative imports carry a `.js` extension** (`from "./catalog.js"`) — NodeNext requires it.
- **Log to stderr only**, via `log(level, msg, ctx)` from `config.ts`. **stdout is reserved for MCP
  stdio framing** — a stray `console.log` corrupts the protocol.
- Every `/api/*` route opens with the `isAuthorized(req.header("authorization"))` bearer guard.
  No exceptions.
- All ADB access funnels through `adb(args)` in `control.ts`, and user text through
  `escapeInputText()`. Never build a shell string by hand — that is a command-injection hole.
- Config comes from `SCREEN_SYNC_*` env vars with defaults in `config.ts`. Don't invent new config
  channels.
- **Adding or renaming an MCP tool breaks `test/e2e.ts`**, which asserts a hard-coded sorted tool
  list. Update it in the same commit.

### Browser extension (`extension/`)

- **No build step, no npm, no framework, no bundler.** Plain ES modules loaded directly by Chrome.
  Do not add a toolchain.
- Folder roles are strict: `lib/` shared logic, `components/` UI pieces, `pages/` extension pages,
  `styles/` CSS. Brand palette and constants live in `lib/constants.js`; settings go through
  `lib/storage.js` (`DEFAULTS` + `getSettings`/`saveSettings`); all hub calls go through
  `lib/api.js`.

### Website (`website/`)

- **Locked stack (from `WEBSITE_PLAN.md` §0): pure HTML + CSS + Tailwind CDN + vanilla JS.
  Explicitly NO React, NO Next.js, NO build step.** Do not "modernise" this.
- Brand: `#6541D6` / `#150E27` / `#EFEAF9`, light theme, Lucide icons, Plus Jakarta Sans.
- Custom CSS beyond Tailwind goes in `css/custom.css`; reuse `.btn-primary` / `.btn-secondary` /
  `.lux-card` / `.grad-text` rather than inventing button styles.
- Every page repeats the nav twice — **desktop nav and `#mobileMenu`**. Change both, or the mobile
  menu silently loses the item.
- The nav is width-constrained; adding an item can overflow at 768px. Verify no horizontal overflow
  at **375 / 768 / 1024 / 1280** before shipping. `#mobileMenu.open` has a `max-height` cap in
  `custom.css` — raise it when you add a menu item or the last one gets clipped.
- Preview locally with `node website/serve.js` (port 8899).

---

## 4. File size: 500 lines maximum

**No source file may exceed 500 lines.** When a file you are editing would cross 500, split it in
the same change — do not ship the breach and do not delete code to squeeze under.

This is realistic today: **7 of 152 source files** break it, all Dart. No TypeScript, JS, HTML, CSS,
Kotlin or test file breaks it anywhere.

Known debt — **split these when you next touch them**, do not add to them:

| Lines | File                                            |
| ----- | ----------------------------------------------- |
| 972   | `lib/screens/region_crop_screen.dart`           |
| 739   | `lib/blocs/screen_capture_bloc.dart`            |
| 707   | `lib/screens/tabs/gallery_tab.dart`             |
| 704   | `lib/widgets/connection_hero/packet_flow_illustration.dart` |
| 668   | `lib/screens/tabs/settings_tab.dart`            |
| 621   | `lib/widgets/connection_hero/connection_hero.dart` |
| 544   | `lib/widgets/ref_widgets.dart`                  |

Six are presentation code where the fix is mechanical widget extraction into a sibling folder — no
behaviour change, no public API churn. The real one is `screen_capture_bloc.dart` (~35 handlers in
one class); `lib/blocs/hub_maintenance_mixin.dart` is the in-repo precedent for splitting it.

**Watch the cliff edge — 9 files sit at 400–500.** `mcp-server/catalog.ts` is at **497** and grows
every time an MCP tool is added, so it breaches on the next feature: split it (e.g. phone tools vs
`web_*` tools) *before* adding the tool, not after. `lib/screens/home_screen.dart` (494) and
`android/.../ScreenCaptureService.kt` (481) are next.

`website/index.html` is at 468 and grows with marketing copy, not logic. If it crosses 500, raise it
with the user rather than silently exempting it.

---

## 5. Commits

Conventional Commits, `type(scope): subject` — all 24 commits in history follow it, none are bare.

- Types in use: `feat` `fix` `docs` `chore`. On `deploy`: `deploy(web):`.
- Scopes: `website` (the marketing site), `web` (the hub's browser-bridge feature), `ext` /
  `extension`, `app` (Flutter), `release`. Multi-scope has no space: `feat(web,ext):`.
- **Lowercase subject** (recent convention), imperative, no trailing period.
- Body only when the *why* isn't obvious; hard-wrap ~72 chars.

**Never `git add -A` or `git add .`** — `.claude/` is not in this repo's `.gitignore` and would be
swept in. Stage files by name.

---

## 6. Extension releases need two pushes

`origin/extension` and `ext-public/main`
(github.com/KhizarJamshaidIqbal/screensync-extension) must both be pushed — users are told to clone
the public repo, so pushing only one leaves them on stale code.

The extension branch is **not** a raw copy of `main:extension/`: it **omits `scripts/package.ps1`**
and keeps its own public `README.md` and `.gitignore`. Commit style:
`chore(extension): sync from main@<short-sha>` — stamp the real sha.

**The committed zips go stale silently.** `website/downloads/screensync-extension.zip` and
`screensync-hub.zip` are tracked binaries, not build output, while the page claims "always the
latest build". Rebuild the extension zip with `extension/scripts/package.ps1`; the hub zip has **no
build script** and is assembled by hand — it is the artifact most often forgotten. **Build zips on
`main` and commit them there, then mirror** — rebuilding them directly on `deploy` is the one place
this mirror has actually drifted.

---

## 7. Never commit

- `android/app/key.properties`, any `*.jks` / keystore — gitignored four ways. If a release build
  fails without them, **do not** inline the values into `build.gradle`.
- `mcp-server/data/` (captured screenshots are sensitive), hub logs (`hub_*.log`), root `*.png`
  scratch files, `analyze_out.txt`.
- A real pairing token. `"screensync-local-dev"` in `config.ts` is a deliberate LAN dev default —
  leave it; never replace it with a user's token.
- `CONNECT_KIT.md` regenerated with someone else's LAN IP or local paths.
- A `google-services.json` — OAuth config is supplied out-of-band by design.
- If you introduce a `.env`, add it to `.gitignore` **in the same change** — it is not covered today.

---

## 8. Build, run, test

```bash
cd mcp-server && npm install && npm run build   # tsc → dist/
cd mcp-server && npm start                      # hub :3000 + MCP stdio
cd mcp-server && npm run dev                    # tsx, no build
cd mcp-server && npm test                       # e2e + flow (run build first)
```

```bash
flutter pub get && flutter analyze && flutter test
flutter build apk --release
```

Lint is stock `flutter_lints` only (`analysis_options.yaml`) — there is no ESLint, Prettier or
stylelint anywhere. `extension/` and `website/` have no linter and no package.json.

Tests exist only for Dart services (5 files) and the hub E2E. `extension/`, `website/` and the
Kotlin side have **zero tests** — verify those by actually running them in a browser/device.

---

## 9. Verify before you claim done

- Website change → loaded in a browser at 375/768/1024/1280, no horizontal overflow, and confirmed
  **live** with a no-store fetch after the `deploy` push.
- Hub change → `npm run build && npm test` green.
- Flutter change → `flutter analyze && flutter test`, and the screen exercised at ≤360dp.
- "It should work" is not verification. Neither is a green type-check for a UI change.
