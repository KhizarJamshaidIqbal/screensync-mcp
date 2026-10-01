# Changelog link - placement, handoff, risks and rollback

Where the Changelog link lives on <https://www.screensyncmcp.tech>, why, and how to
keep it correct. This is the operating note for whoever touches the site next.

---

## 1. Placement analysis - where the link lives, and why

| Location | Status | Reasoning |
|---|---|---|
| **Header - desktop nav bar** | Linked on **all 7 pages** | The nav is the primary wayfinding surface, and "Changelog" is a destination a returning visitor looks for. It sits directly after **Extension** because both answer "what else is there"; it is the last item before the `Get Connected` CTA so the CTA keeps its position at the end. |
| **Header - mobile menu** | Linked on **all 7 pages** | The desktop bar is `hidden md:flex`, so at mobile widths the only nav is `#mobileMenu`. Without a copy there, the link would be unreachable on a phone. Same position - last before the CTA. |
| **Footer - "Pages" group** | Linked on **all 6 content pages** | The footer group is the second index and the one crawlers follow reliably. It is the last `<li>` after **Browser Extension**. |
| **Interior pages (contextual)** | `index.html`, `about.html`, `goal.html`, `extension.html` | A one-line pointer above the footer: "Every release is written down - read the changelog for what changed in the Android app and the browser extension, build by build." Those four are the pages where a visitor is deciding whether to trust and install. |
| **Deliberately rejected: `privacy.html`, `data-policy.html` contextual** | Not added | These are legal pages read for compliance, not for product news; a release-note promo there reads as noise. They still carry the header and footer link, so the destination is never unreachable. |
| **Deliberately rejected: renaming any existing link** | - | Nothing was replaced. Changelog was added beside Extension everywhere, so no existing navigation label changed. |
| **Changelog page itself** | Carries the site header + footer, with the Changelog item marked active | Its own header/footer mean the page is not a dead end, and `aria-current="page"` plus `text-[#6541D6] font-semibold` shows the active state. |

**One consistent label everywhere:** `Changelog` (the contextual sentence links the words
"read the changelog", which is the only intentional variation).

---

## 2. Files

| Path | Role |
|---|---|
| `tools/build_changelog.py` | Generates `website/changelog.html` + `website/changelog.json` from git history |
| `tools/fix_site_paths.py` | Rewrites `href="index.html"` to `href="/"` |
| `tools/link_changelog.py` | Adds the nav, mobile-menu, footer and contextual links; `--audit` verifies all four regions |
| `website/changelog.html` | **Generated.** Header + footer + reading-first entries |
| `website/changelog.json` | **Generated.** Machine-readable feed |
| `AGENTS.md` §11, `CLAUDE.md` §10 ("Changelog") | Rules that make regeneration mandatory on every release. (`CLAUDE.md` used to have two sections numbered 7; the changelog one is now §10, and §7 is "Never commit".) |

Sources of truth: **App** = version markers in `pubspec.yaml`, changes from `lib/` + `android/`.
**Extension** = version markers in `extension/version.json`, changes from `extension/`.

---

## 3. Adding the next changelog entry

Nothing is hand-written. The entry appears when the version bumps:

```bash
# 1. bump the app (pubspec.yaml version:) or the extension (extension/version.json) and COMMIT the bump
#    (chore(release): <version> - <summary>). The generator reads committed history, so the entry
#    cannot exist before the bump is a commit.
# 2. regenerate - the new release entry is built from the commits since the last bump
python tools/build_changelog.py

# 3. gate: exit 1 if the page no longer matches history
python tools/build_changelog.py --check

# 4. commit changelog.html + changelog.json as their OWN commit:
#    docs(website): regenerate the changelog for <release>

# 5. only if a brand new page was added
python tools/fix_site_paths.py
python tools/link_changelog.py

# 6. publish: mirror main:website onto the deploy branch (CLAUDE.md §1)
```

Housekeeping commits (`chore`, `docs`, `test`, `style`, `build`, `ci`) never produce an
entry. The changelog groups what is left into **NEW / IMPROVED / FIXED** from the commit's
Conventional Commit type.

---

## 4. Verified

### Re-checked 2026-09-30 (offline, from the repo)

| Check | Result |
|---|---|
| Pages | **7** `website/*.html` (`index`, `about`, `goal`, `extension`, `privacy`, `data-policy`, `changelog`): the nav, mobile menu and footer regions still cover all 7, the contextual line is on 4 |
| Region audit | `python tools/link_changelog.py --audit` → "header (desktop + mobile) and footer link the changelog on every page" |
| Generated page | `python tools/build_changelog.py --check` → up to date: **19 releases** (6 app, 13 extension), **113 changes** (`changelog.json` → `stats`) |
| Live vs `main` | The live site is what `origin/deploy` holds. On 2026-09-30 `origin/deploy` was at extension 1.14.2 while `main` already carried 1.14.3 (changelog regenerated, zips rebuilt), so the mirror step had not been run yet. Check `git diff --stat origin/deploy origin/main:website` before assuming the site is current. |

### As verified on 2026-09-15 (historical; the counts have since grown)

| Check | Result |
|---|---|
| Changelog anchors | **25** across the site: 3 regions on every page, 4 pages with the contextual line |
| Region audit | `python tools/link_changelog.py --audit` → "all three regions linked on every page" |
| Internal links | **232** `href`/`src` checked, **0 broken** |
| Duplicate/legacy paths | **0** pages still link `index.html`; **1** absolute changelog URL, no trailing-slash variant |
| Generated page structure | single `</body>`, single `</html>`, one `#cl-data`, header + mobile menu + footer present, active state present |
| Rendering | served locally: `/`, `/changelog.html`, `/changelog.json`, `/extension.html`, `/about.html`, `/goal.html`, `/privacy.html`, `/data-policy.html`, `/sitemap.xml`, `/robots.txt` all HTTP 200 |
| Interaction | With the 8 entries of that day: App filter → 6 of 8 · Extension → 2 of 8 · All → 8 of 8 · search "zzzz" → empty state visible · "pairing" → 2 of 8 · clear → 8 of 8 · deep-link `#app-2.5.4` present. Re-run in a browser after a regeneration; the totals now differ. |
| Accessibility | semantic header/nav with `aria-label`, burger has `aria-expanded`, `#mobileMenu` wraps its links, active item carries `aria-current="page"`, decorative icons hidden from the a11y tree by lucide |
| Live | `/changelog.html`, `/changelog.json`, `/`, `/sitemap.xml` HTTP 200 |

**Known gap:** the live page's own screenshot could not be captured - the ScreenSync MCP
browser bridge returned `Timed out waiting for the browser extension` for `web_click` /
`web_navigate` while every other tool answered. Local screenshots of the same bytes exist.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Hand-editing the generated page | The next `build_changelog.py` run overwrites it. Change the generator or the commit history |
| A new page forgets the links | `python tools/link_changelog.py --audit` exits 1 and names the page and the missing region |
| `deploy` drifts from `main` | Live HTML silently goes stale (it already did once: live was 8 Sept). Always run the mirror step |
| An entry says NEW for a fix | Entries inherit the commit's type; fix the commit type on the way in. The generator does not guess |
| Tailwind CDN scoped change | The changelog page now loads Tailwind for the shared header/footer; its content styles are explicit so preflight does not shift the layout |

**Rollback:** the site is what `origin/deploy` holds, and a rollback is a **new commit on top of
`origin/deploy` that carries an older `website/` tree**. Never force-push `deploy`.

> The old note here told you to run `git push --force-with-lease origin 75e1a19:deploy`. Do not.
> `75e1a19` is on no branch (a dangling commit), and `origin/deploy` was re-rooted on 2026-09-18, so
> nothing from before that date is an ancestor of it: that push would have replaced the live site
> with an orphan history. The same goes for the local `deploy` branch, which shares no history with
> `origin/deploy`. Only ever start from `origin/...` refs.

```bash
git fetch origin

# 1. Find a commit on origin/main whose website/ was good, and check it resolves to a tree.
git log --oneline origin/main -- website          # pick <good-sha>
T=$(git rev-parse <good-sha>:website)

# 2. See exactly what would change on the live site. Read this diff; it is the rollback.
git diff --stat origin/deploy $T
git ls-tree --name-only $T                        # index.html at the top level, NO website/ entry,
                                                  # and never lib/, android/ or mcp-server/

# 3. Only if that is what you want: build the commit on top of origin/deploy (linear history, no force).
C=$(git commit-tree $T -p origin/deploy -m "deploy(web): roll back the site to the website tree of <good-sha>")

# 4. Push it as a normal fast-forward.
git push origin $C:deploy

# 5. Confirm live with a no-store fetch (CLAUDE.md section 1).
```

The site tree includes `website/downloads/*.zip`, so a rollback also puts the older extension and hub
zips back in front of users. Read the step 2 diff for that before you push. To roll forward again,
run the normal mirror from `origin/main:website` (`CLAUDE.md` section 1).
