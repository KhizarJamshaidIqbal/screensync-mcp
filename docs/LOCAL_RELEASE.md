# Local Release Guide  -  ScreenSync

Ye guide batati hai ke GitHub Actions ke bagair, **isi Windows machine se** naya
version build karke Google Play par kaise chadana hai.

Sab kuch do chhote tools par chalta hai:

| File | Kaam |
|---|---|
| `tools/release.ps1` | Ek command mein poora release: tests, build, publish |
| `tools/publish_play.py` | Play Developer API v3 se AAB upload aur commit |
| `tools/bootstrap.ps1` | Ek dafa ka setup (Python venv + packages) |
| `tools/requirements.txt` | Python dependencies |
| `tools/release.config.example.json` | Config ka sample |

> `ci/github-release-workflow.yml` bhi mojood hai, magar ab **optional** hai.
> Default raasta local tool hai.

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

```powershell
Copy-Item .\tools\release.config.example.json .\tools\release.config.json
notepad .\tools\release.config.json
```

`serviceAccountPath` apni JSON key ke path par set kar do, misal:

```json
{
  "packageName": "com.screensync.mcp",
  "serviceAccountPath": "C:\\Users\\epsol\\Downloads\\advance-archery-505415-r2-bebbb831a92d.json",
  "track": "internal",
  "defaultNotes": "Bug fixes and improvements."
}
```

`tools/release.config.json` gitignored hai  -  commit nahi hota.

**Behtar tareeqa (optional):** JSON key ko repo ke bahar kisi safe folder mein
rakho aur wahan se path do, taake Downloads khali karna usay na toray.

Chaho to path ke bajaye env var bhi use kar sakte ho:

```powershell
$env:PLAY_SERVICE_ACCOUNT_JSON = 'C:\path\to\service-account.json'
# ya poora JSON inline:
# $env:PLAY_SERVICE_ACCOUNT_JSON = Get-Content -Raw 'C:\path\to\service-account.json'
```

### 1.3 Ek dafa verification (kuch publish nahi hota)

```powershell
.\tools\release.ps1 -DryRun -SkipTests -SkipBuild
```

Agar ye `[dry-run] OK` keh de, to credentials, package aur API access  -  sab theek hai.
Iske baad asli release chalao.

---

## 2. Rozana ka release

### 2.1 Naya version (normal case)  -  version bump ke saath

```powershell
.\tools\release.ps1 -BumpVersion -Track internal -Notes "Bug fixes and improvements"
```

`-BumpVersion` sirf build number barhata hai: `2.5.4+29` -> `2.5.4+30`.
`versionName` (2.5.4) wahi rehta hai. versionName badalna ho to `pubspec.yaml`
khud edit karo, phir bina `-BumpVersion` chalao.

### 2.2 Sirf republish (version bump ke bagair)

```powershell
.\tools\release.ps1 -Track internal -Notes "Same version, re-upload"
```

! Ye sirf tab kaam karega jab **yeh versionCode pehle upload na hua ho**.
Play ek hi versionCode do dafa qubool nahi karta.

### 2.3 Production staged rollout (10% users ko pehle)

```powershell
.\tools\release.ps1 -BumpVersion -Track production -Status inProgress -Notes "Rolling out"
# Baad mein poori tarah release karna ho to:
.\tools\release.ps1 -Track production -Status completed
```

Note: `-Status inProgress` (ya `halted`) ke saath hi staged rollout hota hai.
Percent set karne ke liye abhi `publish_play.py --user-fraction 0.1` seedha chalao.

### 2.4 Sirf upload, Play Console se review bhejna

```powershell
.\tools\release.ps1 -BumpVersion -Track internal -Status draft
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

# Normal release
.\tools\release.ps1 -BumpVersion -Track internal -Notes "What's new"

# Tests bhi skip (jaldi chahiye)
.\tools\release.ps1 -BumpVersion -SkipTests -Track internal

# Release notes file se
.\tools\release.ps1 -BumpVersion -NotesFile .\release-notes.txt

# Apna AAB path
.\tools\release.ps1 -Aab 'D:\builds\app-release.aab' -SkipBuild

# Sirf Play upload (Flutter build ke bagair)
python .\tools\publish_play.py --aab build\app\outputs\bundle\release\app-release.aab --track internal
```

### `release.ps1` ke parameters

| Parameter | Default | Kaam |
|---|---|---|
| `-Track` | `internal` | `internal` / `alpha` / `beta` / `production` |
| `-Status` | `completed` | `completed` / `draft` / `inProgress` / `halted` |
| `-Notes` | khali | Release notes |
| `-NotesFile` | khali | Notes file ka path |
| `-BumpVersion` | off | Build number +1 |
| `-DryRun` | off | Sirf validate |
| `-SkipTests` | off | analyze + test skip |
| `-SkipBuild` | off | Build skip, mojooda AAB use karo |
| `-Aab` | default AAB path | Apna AAB |

---

## 4. versionCode ka rule (ye yaad rakho)

Play har upload par **naya `versionCode`** chahta hai. versionCode `pubspec.yaml`
ki `version:` line ke `+` ke baad wala number hai:

```
version: 2.5.4+29
         ^^^^^  ^^
         name   versionCode
```

Agr wohi versionCode dobara upload karo, upload reject hoti hai. Isi liye
hamesha `-BumpVersion` lagana behtar hai.

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
| `This release includes the REQUEST_INSTALL_PACKAGES permission, which hasn't been declared in Play Console` | Play ki restricted-permission policy: app Play ke bahar se khud ko update nahi kar sakti | `android/app/src/release/AndroidManifest.xml` is permission ko release build se hata deta hai (pehle se laga hua hai). Store builds Play In-App Updates se update hote hain, sideloaded builds hub OTA se. |
| `APK/AAB with version code X has already been uploaded` (ya similar) | Wohi versionCode dobara | `-BumpVersion` lagao |
| `401` / `403` permission wala error, `The caller does not have permission` | Service account ko Play Console mein app permissions nahi mili, ya abhi propagate ho rahi hain | Play Console -> Users and permissions -> service account -> Manage -> App permissions -> app add karo + `Release apps to testing tracks` tick karo. Thora intezar karo. |
| `Unexpected end of JSON` / `Invalid JWT` | Service account JSON adhoora ya ghalat file | JSON dobara download karo, poora file use karo |
| `Python was not found` | Python install nahi ya PATH par nahi | Python 3.9+ install karo, phir `.\tools\bootstrap.ps1` |
| `AAB nahi mila` | Build hua hi nahi ya path ghalat | `-SkipBuild` hata do, ya `-Aab <sahi path>` do |
| `exit code 1` `flutter test` par | Tests fail hue | Pehle tests theek karo; jaldi ho to `-SkipTests` (magar ye risk hai) |

---

## 6b. Store build vs sideload build - update kaise hota hai

| Build | `REQUEST_INSTALL_PACKAGES` | Update channel |
|---|---|---|
| Release / Play (`.aab` se) | **nahi** - `android/app/src/release/AndroidManifest.xml` ise hata deta hai | Play In-App Updates (`com.google.android.play:app-update`) |
| Debug / sideload | haan - `src/main` se aata hai | Hub OTA (hub naya APK bhejta hai, phone install karta hai) |

Wajah: Google ki Play policy kehti hai ke `REQUEST_INSTALL_PACKAGES` ko Play ke apne
update mechanism ke bahar self-update ke liye use nahi kiya ja sakta. Is liye store
build ise declare nahi karta, aur sideload build wahi feature use karta rehta hai.

Agar tumhe release build par bhi hub OTA chahiye to `src/release/AndroidManifest.xml`
ko hata do - magar phir Play Console mein Permissions Declaration Form bharna parega,
aur Google us use case ko reject kar sakta hai.
## 7. Security  -  ye ghalat na karo

- Service account JSON, `key.properties`, aur `.jks`  -  **kabhi commit na karo**.
  Teeno `.gitignore` mein hain.
- `tools/.venv` aur `tools/release.config.json` bhi ignored hain.
- JSON key sirf is machine par rakho. Share karni ho to Google Cloud Console se
  nayi key banao aur purani revoke kar do.
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

## 9. GitHub Actions wala raasta (optional)

`ci/github-release-workflow.yml` mein wahi kaam CI par hota hai. Use karna ho to:

1. Us file ko `.github/workflows/release.yml` par copy karo (GitHub web UI se
   karna behtar hai  -  token mein `workflow` scope na hone ki wajah se `git push`
   reject ho sakta hai).
2. Repo secrets add karo: `PLAY_SERVICE_ACCOUNT_JSON`, `ANDROID_KEYSTORE_BASE64`,
   `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS`.
3. Actions -> *Release to Google Play* -> Run workflow.

Local tool ke liye in secrets ki zaroorat **nahi**  -  woh seedha is machine se
key.properties aur JSON key padhta hai.
