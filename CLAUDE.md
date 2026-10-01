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

Around them: `tools/` (Play release, release notes and changelog tooling: PowerShell + Python),
`docs/` (guides), `ci/` (one dormant workflow, see below) and `.agents/` (the canonical agent
skills and rules; the copies under `.claude/` and `.zcode/` are gitignored local conveniences).

**There is no active CI.** No `.github/` exists in any commit on any branch, so nothing runs on a
push or a PR and nothing will catch your mistake. Every guarantee below is manual.
`ci/github-release-workflow.yml` is a dormant Play-release workflow that lives outside `.github/`
on purpose. **Do not enable it** (copy it into `.github/workflows/`) without a protected
`production` environment with required reviewers; see AGENTS.md section 10.

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
6. Verify live at https://www.screensyncmcp.tech — fetch with `cache: 'no-store'` and confirm
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
- **Never push, mirror or roll back from the local `deploy` or `extension` branches.** They are not
  the remote branches. Checked 2026-09-30: local `deploy` (16 commits) shares **no history** with
  `origin/deploy` (`git merge-base deploy origin/deploy` exits 1; `origin/deploy` was re-rooted on
  2026-09-18), and local `extension` is an old ancestor of `origin/extension` (5 commits behind).
  Pushing either one is rejected at best and, forced, would overwrite the live site or the public
  extension repo. Always `git fetch origin` and work from `origin/deploy` / `origin/extension`.
  A sha that lives on no branch (`75e1a19` was once quoted as a rollback target) is not a rollback
  target either; the safe rollback procedure is in `docs/SITE_CHANGELOG_HANDOFF.md`.
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
  (`screens/dashboard/*.dart`, `screens/settings/*.dart`, `screens/mcp/*.dart`). Reusable UI goes in
  `widgets/`, a widget family gets its own subfolder.
- State is **flutter_bloc**. `*Bloc`, `*Event`, `*State`, `*Service`, `*Repository`. A bloc that
  grows splits its handlers into mixins (`blocs/*_mixin.dart`), see §4.
- Widgets: `const` constructor + `super.key`. **StatelessWidget by default** (about 126 stateless vs
  37 stateful widget classes in `lib/` on 2026-09-30) — reach for StatefulWidget only when there is
  real local state or a controller.
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
- **Every new widget follows the app theme (UI template, `docs/UI_TEMPLATE.md`).** Colours, radii,
  type, shadows and durations come from `AppTheme` / `motion.dart`, never literals. A dialog is an
  `AppDialog` (`AppDialog.show` / `AppDialog.showCustom`), never a stock `AlertDialog` /
  `SimpleDialog`; progress is `AppProgressBar`; cards are `GlassPanel`. `AppTheme.light()` / `dark()`
  also brand the stock Material dialog, text button, progress indicator and bottom sheet as a safety
  net. Check light **and** dark and 320dp. `test/theme_guardrails_test.dart` fails the build of a new
  stock dialog or a stripped global theme.
- **Imports inside `lib/` are relative** (`import '../services/settings_service.dart';` — all 344
  imports of project files under `lib/` are relative and none uses a package URI). **Only `test/`
  uses the package name:** `import 'package:screensync_flutter_project/…';` (the pubspec name is
  `screensync_flutter_project`, **not** `screensync_mcp`).

### MCP hub (`mcp-server/`)

- Flat, lowercase, one responsibility per file: `index.ts` (composition root), `config.ts`,
  `events.ts`, `storage.ts`, `mcp.ts`, `prompts.ts`, `hub.ts`, `hub-*.ts` (pairing, SSE, watchers,
  app-update routes), `device-status.ts`, `web.ts` and its `web-*.ts` siblings, `control.ts`,
  `app-update.ts`, and the tool catalogue: `catalog.ts` composes **16 `catalog*.ts` files**
  (`catalog-web*.ts`, the cognitive catalogues, `catalog-consolidated.ts`). New tool definitions go
  in the most specific existing catalogue file, never past the line limit.
- **ESM: relative imports carry a `.js` extension** (`from "./catalog.js"`) — NodeNext requires it.
- **Log to stderr only**, via `log(level, msg, ctx)` from `config.ts`. **stdout is reserved for MCP
  stdio framing** — a stray `console.log` corrupts the protocol.
- Every route that returns data or acts opens with the
  `isAuthorized(req.header("authorization"))` bearer guard. The only unauthenticated routes are
  `/health`, `/wake` and the pairing routes (`/pair`, `/api/pair`, `/api/connect-kit`, gated by the
  pairing window and loopback rules in `hub-pairing.ts`). Two documented variations exist:
  `/api/app/latest` also trusts a loopback caller, and `/apk` also accepts `?token=` (a browser
  download carries no headers). Do not add another exception.
- All ADB access funnels through `adb(args)` in `control.ts`, and user text through
  `escapeInputText()`. Never build a shell string by hand — that is a command-injection hole.
- Config comes from `SCREEN_SYNC_*` env vars with defaults in `config.ts`. Don't invent new config
  channels.
- **Adding or renaming an MCP tool.** `test/e2e.ts` only asserts a short core list plus a
  minimum count, so it will not tell you. The guards that will are:
  `test/catalog_consistency.test.ts` (every catalogue tool has a handler and every handler is
  declared; it reads source text of `catalog.ts`, `web.ts`, `control.ts` and the extension),
  `test/catalog_budget.test.ts` (byte budget of the cognitive tool surface) and
  `test/tool_count_sync.test.ts`. The published tool count in `README.md`, `extension/README.md` and
  the website is rewritten by `npm run sync:toolcount` (from `mcp-server/`; `npm run check:toolcount`
  is the gate). Run the sync in the same commit as the tool change, and update the operator skill
  (`.agents/skills/screensync-operator/SKILL.md`) when the tool surface changes.

### Browser extension (`extension/`)

- **No build step, no npm, no framework, no bundler.** Plain ES modules loaded directly by Chrome.
  Do not add a toolchain. (Linting and type-checking run from `mcp-server/` and are not part of the
  extension: see §8.)
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
- **One header and footer for the whole site.** Edit them in `website/index.html` only (desktop nav
  **and** `#mobileMenu`), then run `python tools/site_chrome.py` (copies them into every hand-written
  page) and both generators: `python tools/build_setup_page.py` (`setup.html`, from
  `setup-guide.json`) and `python tools/build_changelog.py`. Never hand-edit `setup.html` or
  `changelog.html`. Gates: `site_chrome.py --check`, `build_setup_page.py --check`,
  `build_changelog.py --check`, `link_changelog.py --audit`, `update_sitemap_lastmod.py --check`.
- The blog at `/blogs/` (CBM site 1961 on blog.epsoldev.com, through a Cloudflare Worker) frames
  `website/embed/header.html` and `embed/footer.html`. They are standalone copies with absolute
  links: when the site nav changes, change them too, or the blog keeps the old menu.
- The nav is width-constrained; adding an item can overflow at 768px. Verify no horizontal overflow
  at **375 / 768 / 1024 / 1280** before shipping. `#mobileMenu.open` has a `max-height` cap in
  `custom.css` — raise it when you add a menu item or the last one gets clipped.
- `.reveal` hides content only under `html.js` (set by an inline script before Tailwind), so the page
  is readable without JS. Keep the hero out of `.reveal`: it is the LCP element.
- `website/robots.txt` is not what crawlers see on its own: Cloudflare can prepend its managed
  AI-crawler block at the edge. Check the live file after changing either.
- `website/.htaccess` (LiteSpeed) carries the redirects (`/index.html`, extensionless pages,
  `/blogs` → `/blogs/`), the branded 404, security headers and the `serve.js` block. Verify it live
  with curl after every deploy that touches it.
- Preview locally with `node website/serve.js` (port 8899).

---

## 4. File size: 500 lines maximum

**No source file may exceed 500 lines.** When a file you are editing would cross 500, split it in
the same change — do not ship the breach and do not delete code to squeeze under. The limit is the
same in `AGENTS.md` and `.cursorrules`; there is no "500 to 600" allowance.

The rule counts code (`.dart .ts .js .py .kt .html .css .ps1 .gradle`). Prose docs and generated
files (`website/changelog.json`, the regenerated `changelog.html`) are not counted.

Measured 2026-09-30 with `wc -l`: **15 of 485 source files** break it. Known debt — **split these
when you next touch them**, do not add to them:

| Lines | File                                            |
| ----- | ----------------------------------------------- |
| 1075  | `extension/styles/components.css`               |
| 972   | `lib/screens/region_crop_screen.dart`           |
| 706   | `lib/screens/tabs/gallery_tab.dart`             |
| 704   | `lib/widgets/connection_hero/packet_flow_illustration.dart` |
| 661   | `tools/build_changelog.py`                      |
| 631   | `mcp-server/test/web_bridge.e2e.ts`             |
| 598   | `extension/lib/web-unit-interact.js`            |
| 592   | `extension/lib/web-adv-net.js`                  |
| 572   | `extension/lib/cognitive-memory-ext.js`         |
| 571   | `lib/screens/home_screen.dart`                  |
| 569   | `tools/play_api.py`                             |
| 551   | `tools/publish_play.py`                         |
| 544   | `lib/widgets/ref_widgets.dart`                  |
| 534   | `extension/lib/web-unit-extract.js`             |
| 523   | `mcp-server/catalog.ts` (`test/catalog_consistency.test.ts` reads its source, so update that test in the same change as any split) |

The 2026-09 live-mirror / update-flow / OTA-flavors work took `lib/blocs/screen_capture_bloc.dart`
(856 → 500), `lib/screens/tabs/settings_tab.dart` (714 → 312),
`lib/widgets/connection_hero/connection_hero.dart` (621 → 207) and
`lib/screens/pair_scan_screen.dart` (659 → 451) under the limit and split `MainActivity.kt`
(595 → 322). Re-measure before relying on this table.

Dart splits are mechanical widget extraction into a sibling folder — no behaviour change, no public
API churn. `lib/blocs/screen_capture_bloc.dart` is the worked example of splitting a bloc: its
handlers live in mixins (`hub_maintenance_mixin.dart`, `live_mirror_mixin.dart`,
`live_hub_events_mixin.dart`, `capture_sync_mixin.dart`), and
`test/screen_capture_bloc_wiring_test.dart` guards that every `on<>` is still registered exactly
once — re-run it after touching the mixins.

**Watch the cliff edge.** These sit at 450–500 and are the next to breach; extract before adding to
them: `lib/blocs/screen_capture_bloc.dart` (**500, exactly at the limit**),
`mcp-server/catalog-web-agent.ts` (498), `extension/lib/web-unit-action.js` (490),
`mcp-server/cognitive-memory.ts` (485), `extension/lib/web-tools.js` (482),
`lib/services/app_update_service.dart` (481), `website/index.html` (479),
`mcp-server/mcp.ts` (473) and `android/.../ScreenCaptureService.kt` (469).
`mcp-server/catalog.ts` is already over the limit and grows every time an MCP tool is added, so
split it (e.g. phone tools vs `web_*` tools) *before* adding the tool, not after.

`website/index.html` grows with marketing copy, not logic. If it crosses 500, raise it with the
user rather than silently exempting it.

---

## 5. Commits

Conventional Commits, `type(scope): subject`. Checked 2026-09-30 on `origin/main` (**291 commits**):
nearly all follow it, and the exceptions are known ones, not a licence:

- **Types in use:** `feat` `fix` `docs` `chore` `test` `refactor` `style` `build`, plus `merge:` for
  13 merge commits and two plain `Merge branch '…'` commits. `tools/release_notes.py` and
  `tools/build_changelog.py` also understand `perf` and `revert`. On `deploy`: `deploy(web):`.
- **Scopes in use** (roughly by frequency): `mcp`, `ext`, `release`, `website`, `cognitive`, `web`,
  `extension`, `tools`, `skill`, `site`, `scanner`, `gate`, `flutter`, `app`, `update`, and a long
  tail of one-offs. Multi-scope has no space: `feat(web,ext):`. Prefer an existing scope.
- **Lowercase subject** (recent convention), imperative, no trailing period. Capitalised subjects
  exist in older history (`feat: Add OS desktop automation …`); do not copy them.
- **No BOM.** Eleven commits from 2026-09-14 begin with an invisible U+FEFF before the type (a
  Windows editor wrote the message with a BOM). The release-notes and changelog tools strip it, but
  write messages with `git commit -m` or a BOM-less file so it does not happen again.
- App version bumps are `chore(release): <version> - <what changed for a user>`; regenerated site
  changelogs are `docs(website): regenerate the changelog for <release>` (§10).
- Body only when the *why* isn't obvious; hard-wrap ~72 chars.

**Never `git add -A` or `git add .`** Stage files by name. `.claude/`, `.zcode/`, `.mcp.json` and
`.cursorrules` are gitignored now, but this is a shared working tree: other agents' half-finished
files, generated output (`GeneratedPluginRegistrant.java` flips line endings whenever Flutter
regenerates it) and stray scratch files would still be swept in.

---

## 6. Extension releases need two pushes

`origin/extension` and `ext-public/main`
(github.com/KhizarJamshaidIqbal/screensync-extension) must both be pushed — users are told to clone
the public repo, so pushing only one leaves them on stale code.

The extension branch is **not** a raw copy of `main:extension/`: it **omits `scripts/package.ps1`**
and keeps its own public `README.md` and `.gitignore`. Commit style:
`chore(extension): sync from main@<short-sha>` — stamp the real sha. Build that commit from
`origin/extension`, never from the local `extension` branch (see §1: it is behind).

**The committed zips go stale silently.** `website/downloads/screensync-extension.zip` and
`screensync-hub.zip` are tracked binaries, not build output, while the page claims "always the
latest build". Rebuild both from `mcp-server/` with

```bash
npm run build && npm run package:all
```

**`package:all` does not compile.** It runs `extension/scripts/package.ps1` (extension zip, also
copied to `website/downloads/`) and `mcp-server/scripts/package-hub.ps1`, which zips whatever is
already in `mcp-server/dist/` (minus `dist/test/`). Without `npm run build` first, the hub zip ships
a **stale hub**. Assembling either archive by hand is the one thing that has actually drifted.
**Build zips on `main` and commit them there, then mirror** — rebuilding them directly on `deploy`
is the one place this mirror has actually drifted.

---

## 7. Never commit

- `android/app/key.properties`, any `*.jks` / keystore — gitignored four ways. If a release build
  fails without them, **do not** inline the values into `build.gradle`.
- Play / GCP **service-account keys** (`*service-account*.json`), `*.pem`, and any `.env` or
  `.env.*` file. All four patterns are in `.gitignore` (added 2026-09-30; `.env.example` templates
  are still allowed). Keep the Play key **outside the repo and outside any synced folder**
  (OneDrive, Dropbox, Downloads); `tools/release.config.json` only points at it and is gitignored.
  Do not paste the key's file name, its key id, the GCP project id, the service-account email or
  personal account emails into tracked files; use `<placeholders>`.
- `mcp-server/data/` (captured screenshots are sensitive), hub logs (`hub_*.log`), root `*.png`
  scratch files, `analyze_out.txt`.
- A real pairing token. `"screensync-local-dev"` in `config.ts` is a deliberate LAN dev default —
  leave it; never replace it with a user's token.
- `CONNECT_KIT.md` regenerated with someone else's LAN IP or local paths.
- A `google-services.json` — OAuth config is supplied out-of-band by design.

---

## 8. Build, run, test

```bash
cd mcp-server && npm install && npm run build   # tsc → dist/
cd mcp-server && npm start                      # hub :3000 + MCP stdio
cd mcp-server && npm run dev                    # tsx, no build
cd mcp-server && npm test                       # hub suites, then the extension suite (npm run test:ext); run build first
```

```bash
flutter pub get && flutter analyze && flutter test
flutter build apk --release                                # sideload flavor (pubspec default-flavor): hub OTA APK
flutter build appbundle --release --flavor play            # Google Play bundle
```

**Android flavors.** The app has two flavors with the same applicationId and the same signing key:
`sideload` (declares `REQUEST_INSTALL_PACKAGES` in `android/app/src/sideload/AndroidManifest.xml`,
so the hub OTA installer works) and `play` (does not, because Play forbids it for a store build).
`pubspec.yaml` sets `default-flavor: sideload`, so plain `flutter run`, `flutter build apk` and
`flutter test` keep working. Gradle **refuses** `bundleSideload*Release`: a bundle for Play must be
built with `--flavor play`. Outputs: `build/app/outputs/flutter-apk/app-sideload-release.apk`
(plus `apk/sideload/release/output-metadata.json`, which the hub reads for the version) and
`build/app/outputs/bundle/playRelease/app-play-release.aab`. `tools/build_ota_apk.ps1` wraps the
sideload APK (drops x86_64 by default) and `tools/release.ps1` wraps the Play bundle and upload.

**Release signing.** A release build (`assemble*Release` / `bundle*Release`) now **fails** when
`android/app/key.properties` is missing. It used to fall back to the debug key silently, which
produced an APK that cannot replace a release-signed install. For a throwaway local build only, set
`SCREENSYNC_ALLOW_DEBUG_SIGNING=1`; never upload or serve that output. `tools/release.ps1` refuses
to publish while that variable is set.

**Lint and types.** Dart lint is stock `flutter_lints` (`analysis_options.yaml`). The extension has
ESLint and a type-check: root `eslint.config.js`, and from `mcp-server/`: `npm run lint:ext`,
`npm run typecheck:ext` (`tsc` over `extension/jsconfig.json`), `npm run verify:ext` for both.
`eslint` is not a devDependency, so `npx` fetches it on first use. There is no Prettier or
stylelint, and `website/` has no linter and no package.json.

**Tests** (counted 2026-09-30):

- Dart: 27 `*_test.dart` files under `test/` (services, bloc mixin wiring, widgets, layout at
  320/360/393dp, one golden), 223 tests in total.
- Hub: about 60 suites under `mcp-server/test/` (`*.test.ts` and `*.e2e.ts`); `npm test` chains
  them and finishes with `npm run test:ext`.
- Extension: 37 `*.test.js` files under `extension/test/`, run by `npm run test:ext`
  (`node ../extension/test/run_all.js`).
- `website/` has no tests beyond the tool-count script guard. The **Kotlin side has zero tests**:
  compile both flavors as a minimum (from `android/`: `gradlew.bat :app:compileSideloadDebugKotlin
  :app:compilePlayDebugKotlin`; `JAVA_HOME` must point at a JDK, Android Studio's bundled one works)
  and verify behaviour on a device.

---

## 9. Verify before you claim done

- Website change → loaded in a browser at 375/768/1024/1280, no horizontal overflow, and confirmed
  **live** with a no-store fetch after the `deploy` push.
- Hub change → `npm run build && npm test` green.
- Flutter change → `flutter analyze && flutter test`, and the screen exercised at ≤360dp.
- Anything that touches the live mirror, the pairing token, the update flow or the Android
  manifests/services is only **proven on a phone**: the unit tests use mocked channels and files.
  Say so in your report if you did not run it on a device.
- "It should work" is not verification. Neither is a green type-check for a UI change.

---

## 10. Changelog - every build gets an entry

The public changelog lives at `website/changelog.html`, generated by
`tools/build_changelog.py` from git history. It covers **both** streams:

- **App** - version markers from `pubspec.yaml`, changes from `lib/` and `android/`
- **Extension** - version markers from `extension/version.json`, changes from `extension/`

The generator reads **committed** history (`git log -p -- pubspec.yaml`), so a version bump cannot
be regenerated in its own commit: the entry does not exist until the bump is committed. The order is:

```bash
# 1. commit the version bump on its own:  chore(release): <version> - <what changed for a user>
python tools/build_changelog.py            # 2. rewrite changelog.html + changelog.json
python tools/build_changelog.py --check    # 3. exit 1 if stale - use this as a gate
# 4. commit website/changelog.html + website/changelog.json as a SEPARATE commit:
#    docs(website): regenerate the changelog for <release>
# 5. mirror main:website onto the deploy branch (section 1) so the site updates
```

Do not hand-edit the generated page; it is overwritten on every run. Housekeeping commits
(`chore`, `docs`, `test`, `style`, `build`, `ci`) are deliberately excluded, so a changelog
entry only appears for something a user can notice.

Related: `tools/fix_site_paths.py` (keeps home links at `/`), `tools/link_changelog.py`
(nav + sitemap for new pages; `--audit` checks every page). Operating notes and the safe rollback
procedure: `docs/SITE_CHANGELOG_HANDOFF.md`.
