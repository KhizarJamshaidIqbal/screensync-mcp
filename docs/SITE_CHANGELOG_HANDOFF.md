# Site changelog - handoff, risks and rollback

What shipped: a generated public changelog at
<https://screensyncmcp.epsoldev.com/changelog.html>, clean home paths, and the rules that
keep both fresh. This file is the operating note for whoever touches it next.

---

## 1. What changed, and where

| Path | Role |
|---|---|
| `tools/build_changelog.py` | Generates `website/changelog.html` + `website/changelog.json` from git history |
| `tools/fix_site_paths.py` | Rewrites `href="index.html"` to `href="/"` so the URL bar never shows `/index.html` |
| `tools/link_changelog.py` | Adds the Changelog nav link to pages that lack it, and the sitemap entry |
| `website/changelog.html` | **Generated.** Do not hand-edit - the next run overwrites it |
| `website/changelog.json` | **Generated.** Machine-readable feed of the same data |
| `AGENTS.md` §11, `CLAUDE.md` §7 | The rules that make the above mandatory on every release |

Data sources: **App** = version markers in `pubspec.yaml`, changes from `lib/` + `android/`.
**Extension** = version markers in `extension/version.json`, changes from `extension/`.

---

## 2. How to use it

```bash
# after any version bump
python tools/build_changelog.py

# use as a gate - exits 1 when the page no longer matches history
python tools/build_changelog.py --check

# print the feed without writing (for an agent or a script)
python tools/build_changelog.py --stdout

# after adding a new page
python tools/fix_site_paths.py
python tools/link_changelog.py
```

Then publish: mirror `main:website` onto the `deploy` branch (see `CLAUDE.md` §1). `main`
is the source of truth; Hostinger serves `deploy`. **A release is not done until `deploy`
is updated** - pushing `main` alone does not change the live site.

---

## 3. Verified

| Check | Evidence |
|---|---|
| Every page serves | `/`, `/changelog.html`, `/changelog.json`, `/extension.html`, `/about.html`, `/goal.html`, `/privacy.html`, `/data-policy.html`, `/sitemap.xml`, `/robots.txt` - all HTTP 200 locally |
| Rendered structure | Accessibility tree of the real page: 8 release entries, headings, lists, Copy-link buttons, footer timestamp |
| Visual | Screenshot + OCR of the real browser: headline, 8 Releases / 53 Changes, three pill links, active filter state, no clipping or overlap |
| Filters | App → 6 of 8, Extension → 2 of 8, All → 8 of 8 (clicks driven inside the page) |
| Search | "zzzz" → 0 of 8 with the empty state visible; "pairing" → 2 of 8; cleared → 8 of 8 |
| Deep link | `#app-2.5.4` target id exists (the Copy-link button's target) |
| Live | `/`, `/changelog.html`, `/changelog.json`, `/sitemap.xml` all HTTP 200 with `Last-Modified: Tue, 15 Sep 2026 18:38:27 GMT` |
| Home paths | Live home page contains the Changelog nav link and **no** `href="index.html"` |

---

## 4. Risks, and what to do about them

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Editing the generated page by hand** | The next `build_changelog.py` run silently discards it | Change the generator or the commit history; keep `--check` in the release flow |
| **Changelog says "NEW" for a bug fix** | Entries inherit the commit's Conventional Commit type, and commits are often typed `feat` even for fixes | Fix the commit type on the way in; the generator deliberately does not guess |
| **`deploy` drifts from `main`** | Live site serves stale HTML; this already happened once (live was from 8 Sept) | Always run the mirror step; the `git diff --stat origin/deploy origin/main:website` output is the check |
| **Cloudflare cache** | A purge may be needed for changed assets to appear immediately | Hostinger pulls on push, then Cloudflare revalidates; verify with `?v=<timestamp>` |
| **A page added without `link_changelog.py`** | Nav and sitemap fall out of sync | The tool is idempotent - safe to re-run over the whole folder |
| **Commit history rewritten** | Version markers vanish and an entry disappears | The generator reads `pubspec.yaml` / `extension/version.json` history; avoid force-pushing those files' history |

**Rollback:** the site is a git branch, so rollback is a revert of `deploy`:

```bash
# back to the previous published tree
git push --force-with-lease origin <previous-deploy-sha>:deploy
```

Take `<previous-deploy-sha>` from `git log --oneline origin/deploy` (before the deploy
commit). The pre-changelog deploy was `75e1a19`. A safer alternative that keeps history is
to commit the older `website/` tree as a new commit on `deploy` using the same
`git commit-tree` mechanism used to publish.

---

## 5. Known gaps

- The changelog lists commit subjects, not polished prose. For a given release the Play
  notes (`tools/release_notes.py`) are the hand-polished version of the same change list.
- `changelog.json` is not yet consumed by the app or the extension; it exists so either can
  show an in-app "what changed" without a rebuild.
- The hub's own changes (`mcp-server/`) are not in the changelog yet - only app and
  extension, as asked.
- Deploy is still a manual branch mirror; there is no CI job enforcing `--check`.
