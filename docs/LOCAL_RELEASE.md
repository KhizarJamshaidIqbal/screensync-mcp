# Local Release Guide  -  ScreenSync

Ye guide batati hai ke GitHub Actions ke bagair, **isi Windows machine se** naya
version build karke Google Play par kaise chadana hai.

Sab kuch in chhote tools par chalta hai:

| File | Kaam |
|---|---|
| `tools/release.ps1` | Ek command mein poora release: tests, **play flavor** ka AAB build, publish |
| `tools/publish_play.py` | Play Developer API v3 se AAB upload, promote, staged rollout, halt |
| `tools/build_ota_apk.ps1` | Hub ke OTA update ke liye **sideload flavor** ka APK (Play ke liye nahi) |
| `tools/release_notes.py` | Git history se "What's new" banata aur validate karta hai |
| `tools/bootstrap.ps1` | Ek dafa ka setup (Python venv + packages) |
| `tools/requirements.txt` | Python dependencies |
| `tools/release.config.example.json` | Config ka sample |

> `ci/github-release-workflow.yml` bhi mojood hai, magar wo **dormant** hai aur sirf
> `internal` track ke liye hardened hai (Section 9). Asli raasta local tool hai.

**Ye guide kisi bhi production command ke saath `-ConfirmLiveRollout -ApprovedBy "<naam>"`
dikhati hai. Wo flags khud se kabhi na lagayein: pehle user se poochein** (Section 10).

---

## 0. Abhi kaun sa versionCode kahan hai (padh kar bharosa karein, andaza na lagayein)

- `pubspec.yaml` mein abhi `version: 2.5.4+32` hai, yani **versionName 2.5.4, versionCode 32**.
- In docs mein aakhri record kiya hua Play state (`docs/PLAY_API_GUIDE.md` Section 8, 15 Sept 2026):
  **versionCode 31** internal aur production dono par attach tha, aur upload ki hui bundles
  `['25', '31']` thin. Yani wo aakhri versionCode hai jise docs "live" likhte hain.
- **versionCode 32 Play par upload hua ya nahi, ye repo mein kahin record nahi hai.** Andaza na
  lagayein. Pehle chalayein: `python .\tools\play_api.py tracks` (read-only) aur store listing
  dekhein (`docs/PLAY_API_GUIDE.md` Section 6.2).

---

## 1. Ek dafa ka setup (sirf pehli bar)

### 1.1 Python packages install karo

```powershell
cd 'D:\Local SEO\Site\Khizar\screensync_flutter_mcp_project'
.\tools\bootstrap.ps1
```

Ye `tools\.venv` banata hai aur `google-api-python-client` waghera install karta hai.
System Python ko chhoota nahi. Dobara chalana safe hai.

### 1.2 Service account ka path config mein do

Service account ki JSON key ko **repo ke bahar, aur kisi cloud-synced folder ke bahar** rakho:
OneDrive, Dropbox, Google Drive, aur Downloads/Desktop/Documents (agar OneDrive unka backup
leta ho) sab synced ho sakte hain, aur wahan se key kisi doosre device par pahunch jati hai.
Is repo ke liye ek hi jagah tay hai (local, unsynced):

```powershell
$dir = Join-Path $env:LOCALAPPDATA 'ScreenSync'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
# Google Cloud Console se download ki hui key ko yahan move karo:
#   %LOCALAPPDATA%\ScreenSync\play-service-account.json
```

Phir config banao:

```powershell
Copy-Item .\tools\release.config.example.json .\tools\release.config.json
notepad .\tools\release.config.json
```

`serviceAccountPath` us key ke path par set karo. **Sirf yehi key padhi jati hai**
(`publish_play.py` aur `play_api.py` dono `serviceAccountPath` hi uthate hain):

```json
{
  "serviceAccountPath": "C:\\Users\\<you>\\AppData\\Local\\ScreenSync\\play-service-account.json"
}
```

Example file mein `packageName`, `track` aur `defaultNotes` bhi hain, magar koi tool unhein
**nahi padhta**. `defaultNotes` khaas taur par bekaar aur nuqsandeh hai: wo "generic notes"
ki taraf dhakelta hai, jo release notes ke rules ke khilaf hai (Section 11). Isay config mein
mat rakho.

`tools/release.config.json` gitignored hai  -  commit nahi hota. Key file ka naam, key id, GCP
project id aur service-account email tracked files (docs, README) mein **na** likho:
`<placeholder>` use karo.

Chaho to path ke bajaye env var bhi use kar sakte ho:

```powershell
$env:PLAY_SERVICE_ACCOUNT_JSON = 'C:\path\to\service-account.json'
# ya poora JSON inline:
# $env:PLAY_SERVICE_ACCOUNT_JSON = Get-Content -Raw 'C:\path\to\service-account.json'
```

> Note: `tools/play_api.py` (line 53) mein ek purana `DEFAULT_SA` path hardcoded hai jo OneDrive
> Desktop ki taraf jata hai. Ye Section 1.2 ke rule ke khilaf hai; us file ke owner ko isay
> hatana chahiye. Tab tak `release.config.json` ya env var zaroor set rakho, taake wo default
> kabhi use na ho.

### 1.3 Ek dafa verification (kuch publish nahi hota)

```powershell
.\tools\release.ps1 -DryRun -SkipTests -SkipBuild
```

Agar ye `[dry-run] OK` keh de, to credentials, package aur API access  -  sab theek hai.
Iske baad asli release chalao.

### 1.4 Release signing (`android/app/key.properties`)

Release build ko asli `android/app/key.properties` (aur uska keystore) chahiye. Ye na ho to
Gradle release build ko **rok deta hai** (`Release build refused: android/app/key.properties
was not found`). Pehle ye chup chaap debug key se sign kar deta tha, jis se aisi APK ban jati thi
jo kisi release-signed install ko replace nahi kar sakti aur Play use reject karta hai.

Sirf throwaway local build ke liye: `$env:SCREENSYNC_ALLOW_DEBUG_SIGNING = '1'`. Us se bani hui
APK/AAB ko **kabhi Play par upload ya hub se serve na karein**; `release.ps1` us variable ke
saath (dry run ke bagair) publish karne se inkar kar deta hai.

---

## 2. Rozana ka release

Har asli (non-dry-run) release ke liye **release notes lazmi hain**: `-NotesFromGit`,
`-NotesFile` ya `-Notes` (Section 11). Neeche ke sab examples mein wo maujood hain.

### 2.1 Naya version (normal case)  -  internal par, version bump ke saath

```powershell
python .\tools\release_notes.py --list-versions      # base revision dekho
.\tools\release.ps1 -BumpVersion -Track internal -NotesFromGit -SinceVersion 2.5.4
```

`-BumpVersion` sirf build number barhata hai: abhi `2.5.4+32` hai, to ye `2.5.4+33` bana dega.
`versionName` (2.5.4) wahi rehta hai. versionName badalna ho to `pubspec.yaml`
khud edit karo, phir bina `-BumpVersion` chalao. **Production ke liye `-BumpVersion` kabhi
istemal na karein** (Section 2.3): pehle internal par upload karo, phir usi versionCode ko promote karo.

### 2.2 Sirf republish (version bump ke bagair)

```powershell
.\tools\release.ps1 -Track internal -NotesFromGit -SinceVersion 2.5.4
```

! Ye sirf tab kaam karega jab **yeh versionCode pehle upload na hua ho**.
Play ek hi versionCode do dafa qubool nahi karta.

### 2.3 Production: pehle user se poochein, phir staged rollout

Production real users ko jata hai. Ye sab **user ki saaf ijazat** ke baad hi:

1. Pehle `internal` par upload karo (Section 2.1) aur uska versionCode note karo (maslan 33).
2. **User se poochein.** Ijazat milne par, staged rollout (pehle 10%):

```powershell
python .\tools\release_notes.py --since-version 2.5.4 --write build\notes.en-US.txt
python .\tools\release_notes.py --check build\notes.en-US.txt
python .\tools\publish_play.py --version-code 33 --track production --status inProgress `
    --user-fraction 0.10 --notes-file build\notes.en-US.txt `
    --confirm-live-rollout --approved-by "<user ka naam>"
```

3. Baad mein bara percentage ya poora rollout (dobara user se poochein):

```powershell
python .\tools\publish_play.py --version-code 33 --track production --status inProgress `
    --user-fraction 0.50 --notes-file build\notes.en-US.txt `
    --confirm-live-rollout --approved-by "<user ka naam>"
python .\tools\publish_play.py --version-code 33 --track production --status completed `
    --notes-file build\notes.en-US.txt `
    --confirm-live-rollout --approved-by "<user ka naam>"
```

**`release.ps1` staged rollout nahi kar sakta.** Us mein `-UserFraction` jaisa koi parameter
nahi hai; `-Status inProgress` akela percentage set nahi karta. Percentage sirf
`publish_play.py --user-fraction` (0 se bara, 1 se chhota) se set hota hai, aur wo sirf
`--status inProgress` ya `halted` ke saath chalta hai.

Agar bina staged, seedha 100% jana ho (tab bhi user ki ijazat ke baad):

```powershell
.\tools\release.ps1 -Track production -VersionCode 33 -SkipBuild -SkipTests -NotesFromGit `
    -SinceVersion 2.5.4 -ConfirmLiveRollout -ApprovedBy "<user ka naam>"
```

`-VersionCode` sirf AAB **upload** skip karta hai. `pub get`, `analyze`, `test` aur AAB **build**
phir bhi chalte hain jab tak `-SkipTests` / `-SkipBuild` na do; promote ke liye dono do, warna
tool ek AAB banata hai jo wo upload hi nahi karega.

### 2.4 Sirf upload, Play Console se review bhejna

```powershell
.\tools\release.ps1 -BumpVersion -Track internal -Status draft -NotesFromGit -SinceVersion 2.5.4
```

`draft` matlab: AAB Play par chala gaya, magar release review ke liye submit nahi hui.
Play Console khol kar khud "Send for review" dabana parega.

---

## 3. Commands cheat sheet

```powershell
# Setup (ek dafa)
.\tools\bootstrap.ps1

# Fast validation, kuch publish nahi
.\tools\release.ps1 -DryRun -SkipTests -SkipBuild

# Poora rehearsal: build + validate, publish nahi
.\tools\release.ps1 -DryRun

# Normal (internal) release, notes git history se
.\tools\release.ps1 -BumpVersion -Track internal -NotesFromGit -SinceVersion 2.5.4

# Tests bhi skip (jaldi chahiye)
.\tools\release.ps1 -BumpVersion -SkipTests -Track internal -NotesFromGit -SinceVersion 2.5.4

# Release notes file se
.\tools\release.ps1 -BumpVersion -Track internal -NotesFile .\release-notes.txt

# Apna AAB path (play flavor ka hi hona chahiye)
.\tools\release.ps1 -Aab 'D:\builds\app-play-release.aab' -SkipBuild -Track internal -NotesFromGit -SinceVersion 2.5.4

# Sirf Play upload (Flutter build ke bagair)
python .\tools\publish_play.py --aab build\app\outputs\bundle\playRelease\app-play-release.aab --track internal `
    --notes-file build\notes.en-US.txt

# Read-only: track ka state
python .\tools\play_api.py tracks
python .\tools\publish_play.py --version-code 1 --track production --dry-run

# Mojooda upload ko production par promote karo (LIVE: pehle user se poochein) - build ya upload dobara nahi hota
python .\tools\publish_play.py --version-code 33 --track production --status completed --release-name "2.5.4" `
    --notes-file build\notes.en-US.txt --confirm-live-rollout --approved-by "<user ka naam>"

# Staged rollout: pehle 10% users ko (LIVE: pehle user se poochein)
python .\tools\publish_play.py --version-code 33 --track production --status inProgress --user-fraction 0.10 `
    --notes-file build\notes.en-US.txt --confirm-live-rollout --approved-by "<user ka naam>"

# Hub OTA ke liye sideload APK (Play ke liye nahi)
.\tools\build_ota_apk.ps1
```

### `release.ps1` ke parameters

| Parameter | Default | Kaam |
|---|---|---|
| `-Track` | `internal` | `internal` / `alpha` / `beta` / `production` |
| `-Status` | `completed` | `completed` / `draft` / `inProgress` / `halted` (percentage set nahi hota) |
| `-Notes` | khali | Release notes seedha text mein |
| `-NotesFile` | khali | Notes file ka path |
| `-NotesFromGit` | off | Notes git history se khud banao (`release_notes.py`) |
| `-FromRevision` | khali | `-NotesFromGit` ke saath: is revision ke baad ke changes |
| `-SinceVersion` | khali | `-NotesFromGit` ke saath: is version (maslan `2.5.4`) ke baad ke changes |
| `-NotesLanguage` | `en-GB` | Notes ki language; store listing ki language se milni chahiye |
| `-BumpVersion` | off | Build number +1 (production ke liye nahi) |
| `-VersionCode` | 0 | Play par pehle se upload hui versionCode ko promote karo; AAB upload skip |
| `-ConfirmLiveRollout` | off | `-Track production` ke liye human approval ka switch (user se poochein) |
| `-ApprovedBy` | khali | Approve karne wale insaan ka naam; production ke liye lazmi |
| `-DryRun` | off | Sirf validate |
| `-SkipTests` | off | analyze + test skip |
| `-SkipBuild` | off | Build skip, mojooda AAB use karo |
| `-Aab` | `build\app\outputs\bundle\playRelease\app-play-release.aab` | Apna AAB |
| `-TargetPlatform` | `android-arm,android-arm64` | Kaun se ABI build hon (x86_64 sirf emulator ke liye hai, isse AAB ~14 MB bari hoti thi; emulator ke liye `android-x64`) |

---

## 4. versionCode ka rule (ye yaad rakho)

Play har upload par **naya `versionCode`** chahta hai. versionCode `pubspec.yaml`
ki `version:` line ke `+` ke baad wala number hai:

```
version: 2.5.4+32
         ^^^^^  ^^
         name   versionCode
```

Agr wohi versionCode dobara upload karo, upload reject hoti hai. Isi liye
internal upload par hamesha `-BumpVersion` lagana behtar hai. Kaun sa versionCode
live hai, ye Section 0 mein hai.

---

## 5. Track progression

| Track | Kis liye |
|---|---|
| `internal` | Sirf tumhare 100 testers. Sabse pehla release yahin se karo. |
| `alpha` | Band testers ka bara group. |
| `beta` | Open testing, public. |
| `production` | Sab users. |

Pehle `production` par seedha push karne se Play mana kar deta hai
(`Precondition check failed`). Is liye: pehle `internal`, phir promote.

### Status values

| Status | Matlab |
|---|---|
| `draft` | Play par chala gaya, magar review ke liye submit nahi hua. |
| `inProgress` | Staged rollout  -  `userFraction` ke saath thore users ko ja raha hai. |
| `halted` | Staged rollout rok diya gaya. |
| `completed` | Poora release. |

---

## 6. Common errors aur unka fix

| Error (jo console mein aata hai) | Matlab | Fix |
|---|---|---|
| `403 ... API has not been used in project ... before or it is disabled` | Google Play Android Developer API enable nahi hai | [console.cloud.google.com/apis/library/androidpublisher.googleapis.com](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com) -> project select -> **Enable** |
| `Package not found` | App Play Console mein mojood nahi (`com.screensync.mcp`) | Pehle Play Console se manually ek AAB chada kar app banao |
| `Precondition check failed` | Production par seedha push, ya edit conflict (Console khol kar changes kar diye) | Pehle `internal` track par release karo; Console se aakhri kaam ke baad naya edit banao |
| `This release includes the REQUEST_INSTALL_PACKAGES permission, which hasn't been declared in Play Console` | Bundle sideload flavor se bana (ya purana bundle upload kiya), jo permission declare karta hai | Bundle sirf `--flavor play` se banao (`tools\release.ps1` yehi karta hai). Detail Section 6b mein. |
| `Refusing to build a release App Bundle of the 'sideload' flavor` | Gradle ne `flutter build appbundle --release` (bina `--flavor play`) ko rok diya | `flutter build appbundle --release --flavor play` ya `tools\release.ps1` |
| `Release build refused: android/app/key.properties was not found` | Release build ko asli signing key chahiye | Asli `key.properties` + keystore rakho (Section 1.4). Sirf throwaway ke liye `SCREENSYNC_ALLOW_DEBUG_SIGNING=1`, phir us output ko kabhi upload na karo |
| `APK/AAB with version code X has already been uploaded` (ya similar) | Wohi versionCode dobara | `-BumpVersion` lagao |
| `401` / `403` permission wala error, `The caller does not have permission` | Service account ko Play Console mein app permissions nahi mili, ya abhi propagate ho rahi hain | Play Console -> Users and permissions -> service account -> Manage -> App permissions -> app add karo + `Release apps to testing tracks` tick karo. Thora intezar karo. |
| `Unexpected end of JSON` / `Invalid JWT` | Service account JSON adhoora ya ghalat file | JSON dobara download karo, poora file use karo |
| `Python was not found` | Python install nahi ya PATH par nahi | Python 3.9+ install karo, phir `.\tools\bootstrap.ps1` |
| `AAB nahi mila` | Build hua hi nahi ya path ghalat | `-SkipBuild` hata do, ya `-Aab <sahi path>` do (default: `build\app\outputs\bundle\playRelease\app-play-release.aab`) |
| `Release notes lazmi hain` | Bina notes ke non-dry-run release | `-NotesFromGit` (ya `-NotesFile` / `-Notes`) do |
| `exit code 1` `flutter test` par | Tests fail hue | Pehle tests theek karo; jaldi ho to `-SkipTests` (magar ye risk hai) |

---

## 6b. Store build vs sideload build - flavors aur update kaise hota hai

App ke do Android **flavors** hain. Dono ka applicationId (`com.screensync.mcp`) aur signing key
ek hi hai; farq sirf ek manifest permission ka hai:

| Flavor | Build command | `REQUEST_INSTALL_PACKAGES` | Output | Update channel |
|---|---|---|---|---|
| `sideload` (pubspec ka `default-flavor`) | `flutter build apk --release` ya `.\tools\build_ota_apk.ps1` | **haan** - `android/app/src/sideload/AndroidManifest.xml` se | `build\app\outputs\flutter-apk\app-sideload-release.apk` | Hub OTA (hub naya APK bhejta hai, phone install karta hai) |
| `play` | `flutter build appbundle --release --flavor play` ya `.\tools\release.ps1` | **nahi** | `build\app\outputs\bundle\playRelease\app-play-release.aab` | Play In-App Updates (`com.google.android.play:app-update`) |
| debug (`flutter run`, `flutter build apk --debug`) | default flavor = sideload | haan | debug APK, `build\app\outputs\flutter-apk\` mein | Hub OTA |

Wajah: Google ki Play policy kehti hai ke `REQUEST_INSTALL_PACKAGES` ko Play ke apne
update mechanism ke bahar self-update ke liye use nahi kiya ja sakta. Is liye Play build ise
declare nahi karta, aur sideload build wahi feature use karta hai.

**Purani ghalti (flavors se pehle):** `android/app/src/release/AndroidManifest.xml` permission ko
**har release build** se hata deta tha, sideload release APK se bhi. Is liye docs ka ye daawa ke
"sideload build permission rakhta hai" sirf debug build ke liye sach tha; hub ki serve ki hui
release APK mein permission thi hi nahi. Ab wo file delete hai aur permission sirf `sideload`
flavor mein hai.

Do hifazati rules Gradle khud enforce karta hai:

- `bundleSideload*Release` **refuse** hota hai: sideload flavor ka bundle Play par jana hi nahi chahiye.
- Release build (`assemble*Release` / `bundle*Release`) ko `key.properties` chahiye (Section 1.4).

Hub `build\app\outputs\apk\sideload\release\output-metadata.json` se version parhta hai (warna
`pubspec.yaml` se) aur APK badalne par phones ko `app_update` push karta hai.

### Hub ke liye OTA APK banana

```powershell
.\tools\build_ota_apk.ps1                 # arm64 + armeabi-v7a, x86_64 ke bagair (default)
.\tools\build_ota_apk.ps1 -Arm64Only      # sab se chhoti (~30 MB); bahut purane 32-bit phones par install nahi hogi
.\tools\build_ota_apk.ps1 -DryRun         # sirf batao ke kya build hoga
```

Ye script `flutter analyze` chalati hai (skip: `-SkipTests`), phir
`flutter build apk --release --flavor sideload --target-platform ...`. Play AAB ko ye nahi chhooti.

---

## 7. Security  -  ye ghalat na karo

- Service account JSON, `key.properties`, aur `.jks`  -  **kabhi commit na karo**.
  `.gitignore` in sab ko cover karta hai (`*service-account*.json`, `*.pem`, `.env*`,
  `key.properties`, `*.jks`).
- `tools/.venv` aur `tools/release.config.json` bhi ignored hain.
- JSON key sirf is machine par, **synced folder ke bahar** rakho (Section 1.2). Share karni ho to
  Google Cloud Console se nayi key banao aur purani revoke kar do.
- Docs, README, commit messages ya chat mein key ka file naam, key id, GCP project id, service-account
  email ya personal account email na likho: `<placeholder>` use karo.
- Play Console mein service account ki permissions sirf utni do jitni chahiye
  (`Release apps to testing tracks`, aur production ke liye
  `Release to production, exclude devices, and use Play App Signing`).

---

## 8. Ye tool andar se kya karta hai

`publish_play.py` ye chaar API calls karta hai:

1. `edits.insert`  -  ek naya "edit" (draft change) kholta hai
2. `edits.bundles.upload`  -  AAB upload karta hai, naya `versionCode` milta hai
3. `edits.tracks.update`  -  us versionCode ko track par daalta hai
4. `edits.commit`  -  sab kuch save kar deta hai

Commit ke baad script ek **naya edit khol kar track dobara padhta hai** aur
confirm karta hai ke naya versionCode wahan mojood hai. Agar na mile to exit
code 1 deta hai  -  matlab "script chali" ka matlab "release ho gayi" nahi hai.

Koi bhi step fail ho to script partially-bana edit delete kar deta hai.

---

## 9. GitHub Actions wala raasta (dormant, optional)

`ci/github-release-workflow.yml` mein wahi kaam CI par ho sakta hai, magar wo **jaan boojh kar
`.github/workflows/` ke bahar** rakhi gayi hai aur is repo mein **koi active CI nahi**. Isay
enable karne se pehle:

1. Repo Settings -> Environments mein `play-internal` environment banao. Workflow ka `workflow_dispatch`
   **sirf `internal` track** deta hai, aur `v*` tag push par ye kabhi nahi chalta. Agar kabhi `production`
   option shamil kiya jaye, to job khud `production` environment se bandh jata hai, aur us environment par
   **required reviewers** lagana lazmi hai; wo approval gate ke bagair workflow enable na karein.
   Production ke liye local tool (Section 2.3) istemal karo.
2. File ko `.github/workflows/release.yml` par copy karo (GitHub web UI se
   karna behtar hai  -  token mein `workflow` scope na hone ki wajah se `git push`
   reject ho sakta hai). Copy se pehle file ke andar likhe do third-party actions ko full commit SHA par pin karo.
3. Repo secrets add karo: `PLAY_SERVICE_ACCOUNT_JSON`, `ANDROID_KEYSTORE_BASE64`,
   `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS`.
4. Actions -> *Release to Google Play (internal)* -> Run workflow. `release_notes` input lazmi hai (asli
   changes, 500 characters tak); workflow usay `tools/release_notes.py --check` se validate karta hai.
   Bundle `--flavor play` se banta hai.

Local tool ke liye in secrets ki zaroorat **nahi**  -  woh seedha is machine se
key.properties aur JSON key padhta hai.

---

## 10. Live rollout - human approval gate

Production track real users ko jata hai, is liye ab **insaan ki saaf ijazat** ke
bagair production par kuch nahi jata.

- `tools/release.ps1 -Track production` ke liye `-ConfirmLiveRollout` aur
  `-ApprovedBy "<naam>"` lazmi hain.
- `tools/publish_play.py --track production` ke liye `--confirm-live-rollout` aur
  `--approved-by "<naam>"` lazmi hain.
- **Ye flags khud se "assume" na karein.** Pehle user se poochein, phir unka naam `-ApprovedBy`
  mein do.
- Guard credentials load hone se **pehle** chalta hai, is liye adhoora publish namumkin hai.
- Sirf preview chahiye to `--dry-run` (ye allowed hai, kuch live nahi hota).

## 11. Release notes - "What's new"

Play ka rule: **500 Unicode characters per language**.
https://support.google.com/googleplay/android-developer/answer/9859348

- Notes ke bagair release nahi hoti. `-NotesFromGit` sab se asaan raasta hai.
- Git history se notes: `python .\tools\release_notes.py --since-version 2.5.4`
- Validate: `python .\tools\release_notes.py --check build\notes.en-US.txt`
- "Bug fixes and improvements" jaisa filler reject hota hai: `release.ps1` har track par
  `release_notes.py --check` chalata hai, aur `publish_play.py` production par dobara rokta hai.
  Kaun sa phrase kahan reject hota hai, ye `docs/RELEASE_NOTES_GUIDE.md` mein hai.
- Notes ki language `en-GB` hai (is app ki store listing ki default language), `-NotesLanguage`
  se badli ja sakti hai.
- Tafseel: `docs/RELEASE_NOTES_GUIDE.md`  |  API limits: `docs/PLAY_API_GUIDE.md`

## 12. Aur guides

| File | Kya |
|---|---|
| `docs/PLAY_API_GUIDE.md` | Play API se kya hota hai / kya nahi |
| `docs/RELEASE_NOTES_GUIDE.md` | "What's new" ka official rule + house style |
| `docs/APP_SIZE_GUIDE.md` | App ka size kahan se aata hai |
| `tools/README.md` | tools folder ka index |
| `.agents/skills/screensync-release/SKILL.md` | Agent ke liye release playbook |
