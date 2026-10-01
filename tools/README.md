# ScreenSync tools - release, Play API, and app size

Ye folder ScreenSync ke release aur Google Play ka saara tooling rakhta hai.
Sab kuch isi machine par chalta hai - koi GitHub Actions ki zarurat nahi.

---

## 1. Is folder mein kya hai

| File | Kaam |
|---|---|
| `release.ps1` | Poora release: Flutter build (**play flavor** ka AAB) -> Play publish. **Entry point yahi hai.** |
| `publish_play.py` | Play API ka hissa: AAB upload, track attach, promote, staged rollout (`--user-fraction`), halt |
| `release_notes.py` | Git history se "What's new" banata aur validate karta hai (500 char rule) |
| `build_ota_apk.ps1` | Hub ke OTA update ke liye **sideload flavor** ka APK (`app-sideload-release.apk`); Play ke liye nahi |
| `play_api.py` | Baqi Play API kaam: store listing, testers, details, reviews, Reporting API |
| `bootstrap.ps1` | Ek dafa ka setup (Python venv + packages) |
| `build_changelog.py` | Website ka changelog git history se banata hai (`--check` gate) |
| `fix_site_paths.py` · `link_changelog.py` | Website ke home links aur changelog nav/sitemap links |
| `site_chrome.py` | `website/index.html` ka header + footer har hand-written page mein copy karta hai (`--check` gate) |
| `build_setup_page.py` | `website/setup-guide.json` se `website/setup.html` banata hai (`--check` gate) |
| `update_sitemap_lastmod.py` | `website/sitemap.xml` ki `lastmod` dates git se set karta hai (`--check` gate) |
| `release.config.json` | Local config (gitignored) - service account key ka path (sirf `serviceAccountPath` padha jata hai) |
| `release.config.example.json` | Usi ka template (`packageName`, `track`, `defaultNotes` koi tool nahi padhta) |
| `requirements.txt` | Python packages |

Guides:

| Guide | Kya |
|---|---|
| `../docs/LOCAL_RELEASE.md` | Setup + command cheat sheet + `release.ps1` ke saare parameters |
| `../docs/PLAY_API_GUIDE.md` | Play API kya kar sakta hai, kya nahi |
| `../docs/RELEASE_NOTES_GUIDE.md` | "What's new" ka official rule + house style |
| `../docs/APP_SIZE_GUIDE.md` | App ka size kahan se aata hai aur kitna kam ho sakta hai |
| `../.agents/skills/screensync-release/SKILL.md` | Agent ke liye release playbook |

---

## 2. Do non-negotiable rules

1. **LIVE (production) rollout ke liye insaan ki ijazat lazmi hai.**
   Bina `-ConfirmLiveRollout -ApprovedBy "<naam>"` (PowerShell) ya
   `--confirm-live-rollout --approved-by "<naam>"` (Python) production par kuch nahi jata.
   Guard credentials load hone se pehle chalta hai. **Ye flags khud se kabhi na lagayein:
   pehle user se poochein.**

2. **Release notes asli hone chahiye.**
   Play: 500 Unicode characters per language.
   "Bug fixes and improvements" jaisa filler reject hota hai (`release.ps1` har track par,
   `publish_play.py` production par; tafseel `../docs/RELEASE_NOTES_GUIDE.md`).

---

## 3. Play API - hum kya kya kar sakte hain

Ye table batati hai ke kaun sa kaam API se hota hai aur kaun sa nahi.
Tafseel `../docs/PLAY_API_GUIDE.md` mein.

| Kaam | API se? | Tool |
|---|---|---|
| Build upload, track attach, promote, staged rollout, halt | Haan | `publish_play.py` (staged rollout sirf yahin se) / `release.ps1` (staged nahi) |
| Track aur release state parhna (rollout state) | Haan | `publish_play.py --dry-run`, `play_api.py tracks` |
| Store listing text (title, short/full description) per language | Haan | `play_api.py listings-get` / `listings-set` |
| Screenshots / graphics | Haan | `edits.images` (CLI se abhi nahi - API mojood hai) |
| Closed testing testers (email / Google Groups) | Haan | `play_api.py testers-get` / `testers-set` |
| Default language, contact details | Haan | `play_api.py details-get` |
| In-app products aur subscriptions | Haan | `inappproducts` resource |
| Purchase verify / acknowledge, subscription state | Haan | `purchases.*` resource |
| User reviews parhna aur reply karna | Haan | `play_api.py reviews-list` / `reviews-reply` |
| Developer account users aur grants | Haan | `users` resource |
| Crash / ANR / install metrics | **Alag API** | `play_api.py reporting-*` (Play Developer Reporting API) |
| **Release ki review status** ("In review", "Available to users") | **Nahi** | Sirf Play Console -> Publishing overview |
| Pehli dafa app banana, account verification, production access apply | **Nahi** | Console UI only |
| App content declarations, Data safety, content rating | **Nahi** | Console UI only |
| Store listing ki approval / policy appeals | **Nahi** | Console UI only |

### Review status ka masla (yaad rakhein)
`edits.tracks.list` ka raw response mein `review`, `inReview`, `approval`, `published`,
`availableToUsers` - in mein se koi field nahi hota. Sirf `status` hota hai
(`draft` / `inProgress` / `halted` / `completed`), jo **rollout** batata hai, Google ki
approval nahi. "Live hua ya nahi" ka sab se aasaan bahar wala signal: public store
listing ka version aur "Updated on" date.

---

## 4. Doosri API enable karna - Play Developer Reporting API

`play_api.py reporting-*` commands ke liye ye API us project par **enable** honi chahiye
jis ka service account use ho raha hai (project: `<gcp-project-id>`; Play Console ->
Setup -> API access par likha hota hai).

### Kaise enable karein

**Raasta A - Cloud Console (asaan):**
1. https://console.cloud.google.com/apis/library/playdeveloperreporting.googleapis.com
2. Project `<gcp-project-id>` select karein
3. **Enable** dabayein

**Raasta B - gcloud:**
```powershell
gcloud services enable playdeveloperreporting.googleapis.com --project <gcp-project-id>
```

**Raasta C - check karein ke enable hui ya nahi:**
```powershell
gcloud services list --enabled --project <gcp-project-id> --filter="config.name:playdeveloper*"
```

### Enable karne ke baad do aur cheezein
1. **Service account ko Play Console mein permission** deni hoti hai: Play Console ->
   *Users and permissions* -> `<service-account-email>` (`play-publish@<gcp-project-id>.iam.gserviceaccount.com`
   jaisa) -> kam az kam **View app information and download bulk reports** (App information) permission.
2. Reporting API ka OAuth scope alag hai: `https://www.googleapis.com/auth/playdeveloperreporting`.

### 15 Sept 2026 ki state (dobara check karein)
`play_api.py reporting-apps` ke liye token ban gaya tha, magar API ne **HTTP 404** diya -
yani us waqt project par API **enable nahi** thi. Enable karne ke baad wahi command
app ki metrics wapas deni shuru kar degi.

---

## 5. Rozana ke commands

```powershell
# Ek dafa ka setup
.\tools\bootstrap.ps1

# Fast rehearsal - kuch publish nahi hota
.\tools\release.ps1 -DryRun -SkipTests -SkipBuild

# Internal release (notes lazmi). Naya versionCode yahin banta hai.
.\tools\release.ps1 -Track internal -BumpVersion -NotesFromGit -SinceVersion 2.5.4

# LIVE production: PEHLE user se ijazat lein. -BumpVersion production par KABHI nahi:
# internal par upload hui versionCode ko promote karte hain.
# Staged rollout (pehle 10%) sirf publish_play.py se hota hai; release.ps1 percentage set nahi kar sakta.
python .\tools\release_notes.py --since-version 2.5.4 --write build\notes.en-US.txt
python .\tools\publish_play.py --version-code <n> --track production --status inProgress --user-fraction 0.10 `
    --notes-file build\notes.en-US.txt --confirm-live-rollout --approved-by "<naam>"

# Seedha 100% (tab bhi user ki ijazat ke baad). -SkipBuild -SkipTests dena zaroori hai, warna
# release.ps1 ek AAB banata hai jo -VersionCode ke saath upload hi nahi hota.
.\tools\release.ps1 -Track production -VersionCode <n> -SkipBuild -SkipTests -NotesFromGit -SinceVersion 2.5.4 `
    -ConfirmLiveRollout -ApprovedBy "<naam>"

# Hub OTA ke liye sideload APK
.\tools\build_ota_apk.ps1

# Read-only state
python .\tools\play_api.py tracks
python .\tools\play_api.py listings-get
python .\tools\play_api.py reviews-list
python .\tools\release_notes.py --list-versions
```

`release.ps1` ke saare parameters (`-VersionCode`, `-NotesFromGit`, `-FromRevision`,
`-SinceVersion`, `-NotesLanguage`, `-TargetPlatform`, `-ConfirmLiveRollout`, `-ApprovedBy` ...)
`../docs/LOCAL_RELEASE.md` mein table mein hain.

### Flavors (kaun sa build kis ke liye)
- **Play AAB:** `flutter build appbundle --release --flavor play` (`release.ps1` yehi chalata hai).
  Output `build\app\outputs\bundle\playRelease\app-play-release.aab`. `REQUEST_INSTALL_PACKAGES`
  declare nahi hoti.
- **Hub OTA APK:** `flutter build apk --release` ya `build_ota_apk.ps1` (sideload flavor, pubspec ka default).
  Output `build\app\outputs\flutter-apk\app-sideload-release.apk`. Is mein `REQUEST_INSTALL_PACKAGES` hoti hai.
- Sideload flavor ka bundle Play par kabhi nahi jata; Gradle uska `bundleSideload*Release` refuse kar deta hai.
- Release build ko `android\app\key.properties` chahiye; warna build fail hoti hai
  (`SCREENSYNC_ALLOW_DEBUG_SIGNING=1` sirf throwaway local build ke liye, us output ko kabhi upload na karein).

---

## 6. Safety

- Service account key `tools/release.config.json` mein point ki jati hai. **Ye file
  gitignored hai** - isay repo mein commit na karein. Key ko repo ke bahar aur kisi cloud-synced
  folder (OneDrive/Dropbox/Google Drive, aur OneDrive-backed Desktop/Documents/Downloads) se
  bahar rakhein. Is repo ki tay ki hui jagah: `%LOCALAPPDATA%\ScreenSync\play-service-account.json`
  (detail `../docs/LOCAL_RELEASE.md` Section 1.2).
- Key ka file naam, key id, GCP project id, service-account email aur personal account emails
  tracked files mein na likhein; `<placeholder>` use karein.
- `play_api.py` ki write commands `--confirm-write` ke bagair kuch nahi badalti.
- Live rollout ke liye Section 2 ka rule lazmi hai.

---

## 7. Reporting API - verified surface aur enablement ki state

Discovery document se (revision 20260913) ye resources mojood hain:

| Resource | Methods |
|---|---|
| `apps` | `search`, `fetchReleaseFilterOptions` |
| `anomalies` | `list` |
| `vitals.crashrate`, `vitals.anrrate` | `get`, `query` |
| `vitals.errors.counts` | `get`, `query` |
| `vitals.errors.issues`, `vitals.errors.reports` | `search` |
| `vitals.slowstartrate`, `vitals.slowrenderingrate` | `get`, `query` |
| `vitals.excessivewakeuprate`, `vitals.stuckbackgroundwakelockrate`, `vitals.lmkrate`, `vitals.bitmapmemoryusage`, `vitals.anonrssandswapmemoryusage` | `get`, `query` |

**Note:** `apps.list` mojood nahi - `apps.search` hota hai.

### Enablement ki asli state (15 Sept 2026, dobara check karein)
- Reporting scope ka token ban gaya, magar API ne **HTTP 404** diya - yani project
  `<gcp-project-id>` par API **enable nahi** thi.
- `gcloud services enable playdeveloperreporting.googleapis.com --project <gcp-project-id>`
  chalaya gaya -> **PERMISSION_DENIED**. Wajah: gcloud us waqt ek aise personal Google account
  se authenticated tha jis ke paas us project ka access nahi.
- **Ye kaam user ko khud karna hoga** (Console, owner account se):
  https://console.cloud.google.com/apis/library/playdeveloperreporting.googleapis.com
  -> apna project -> Enable.
- Enable hone ke baad: `python tools\play_api.py reporting-apps`

---

## 8. Release notes ki language (publish karte waqt pakra gaya bug)

`edits.details.get` ne dikhaya: is app ki **default store language `en-GB`** hai, aur
store par sirf ek hi listing language hai (`en-GB`).

Pehle `publish_play.py` notes hamesha `en-US` ke saath bhejta tha. Play ne usay display
kar diya, magar sahi tareeqa ye hai ke notes ki language wahan mojood ho jo listing
language hai - warna Play ke paas un notes ko dikhane ke liye listing hi nahi hoti.

**Fix:** `--notes-language` add hua (default `en-GB`) aur `release.ps1` mein
`-NotesLanguage` (default `en-GB`). Notes file ka naam `notes.en-US.txt` sirf ek file naam hai;
language `--notes-language` se tay hoti hai. Production par jo `en-US` notes abhi live hain unhein
badalne ke liye live approval chahiye.
