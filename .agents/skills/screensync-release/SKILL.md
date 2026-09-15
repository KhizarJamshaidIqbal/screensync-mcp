---
name: screensync-release
description: Use when shipping, promoting, halting, or rolling back a ScreenSync Android release on Google Play, or when writing/validating Play release notes. Covers the live-rollout human-approval gate, the 500-character "What's new" rule, staged rollouts, and which Play tasks the API cannot do.
---

# ScreenSync Release - Play releases done safely

Ye skill ScreenSync ka **release playbook** hai. Isay tab use karein jab bhi:

- naya Android build Play par jana ho (internal / alpha / beta / production),
- mojooda upload ko doosre track par promote karna ho,
- release notes ("What's new") likhni ya validate karni hon,
- rollout halt karna ho,
- ya user poochhe "naya version live hua ya nahi?".

Files:

| File | Kaam |
|---|---|
| `tools/release.ps1` | Poora build + publish (Flutter build -> Play) |
| `tools/publish_play.py` | Play API wala hissa (upload / promote / track attach) |
| `tools/release_notes.py` | Git history se release notes + 500-char validation |
| `docs/LOCAL_RELEASE.md` | Setup aur command cheat sheet |
| `docs/PLAY_API_GUIDE.md` | API kya kar sakta hai, kya nahi |
| `docs/RELEASE_NOTES_GUIDE.md` | Notes ka official rule + house style |

---

## 0 - Sab se pehle: ye 3 non-negotiable rules

1. **LIVE rollout ke liye insaan ki ijazat lazmi hai.**
   `production` track par publish karne se pehle **user se saaf ijazat lein**.
   Bina `-ConfirmLiveRollout -ApprovedBy "<naam>"` tool khud block kar deta hai.
   Kabhi bhi ye switches khud se "assume" na karein - pehle poochein.

2. **Release notes lazy ya generic nahi ho sakte.**
   "Bug fixes and improvements" jaisa text production par reject hota hai.
   Notes `tools/release_notes.py` se banayein, aur **parh kar** approve karein.

3. **Commit ya push karne se kuch live nahi hota.**
   GitHub par push aur Play par publish do alag cheezein hain. Live rollout sirf
   `release.ps1` / `publish_play.py` se hota hai - aur woh approval ke bagair nahi chalta.

---

## 1 - Naya version ship karna (internal par pehle)

```powershell
# Base revision dekho: kaun si release se compare karna hai
python .\tools\release_notes.py --list-versions

# Internal par release (notes lazmi)
.\tools\release.ps1 -Track internal -BumpVersion -NotesFromGit -SinceVersion 2.5.0
```

`release.ps1` andar se ye karta hai:
`flutter pub get` -> `flutter analyze` -> `flutter test` -> `flutter build appbundle --release`
-> notes generate + validate -> `publish_play.py` -> track par verify.

Fast rehearsal (kuch publish nahi hota):

```powershell
.\tools\release.ps1 -DryRun -SkipTests -SkipBuild
```

---

## 2 - Production (LIVE) rollout

**Pehle user se poochein.** Ijazat milne ke baad:

```powershell
.\tools\release.ps1 -Track production -VersionCode 32 -NotesFromGit -SinceVersion 2.5.4 `
    -ConfirmLiveRollout -ApprovedBy "<user ka naam>"
```

Ya sirf Play API wala hissa:

```powershell
python .\tools\publish_play.py --version-code 32 --track production --status completed `
    --notes-file build\notes.en-US.txt `
    --confirm-live-rollout --approved-by "<user ka naam>"
```

Staged rollout (pehle 10% users):

```powershell
python .\tools\publish_play.py --version-code 32 --track production --status inProgress `
    --user-fraction 0.10 --notes-file build\notes.en-US.txt `
    --confirm-live-rollout --approved-by "<naam>"
```

Promote (naya build ya upload nahi, mojooda versionCode doosre track par):

```powershell
python .\tools\publish_play.py --version-code 31 --track production --status completed `
    --notes-file build\notes.en-US.txt `
    --confirm-live-rollout --approved-by "<naam>"
```

### Gate kaise kaam karta hai
Guard `parse_args` mein hai, yani **koi bhi network call ya credential load hone se
pehle**. Bina approval production par kuch nahi hota - adhoora publish namumkin hai.

---

## 3 - Release notes (zaroori)

Official rule: **500 Unicode characters per language**.
<https://support.google.com/googleplay/android-developer/answer/9859348>

```powershell
# Git history se notes (screen par)
python .\tools\release_notes.py --since-version 2.5.0

# File mein likho
python .\tools\release_notes.py --since-version 2.5.0 --write build\notes.en-US.txt

# Validate karo
python .\tools\release_notes.py --check build\notes.en-US.txt
```

Style: groups **NEW / IMPROVED / FIXED**, sirf woh cheezein jo user mehsoos kare,
koi commit hash / ticket number / internal naam nahi, aur "bug fixes and
improvements" jaisa filler bilkul nahi. Tafseel: `docs/RELEASE_NOTES_GUIDE.md`.

Tool khud se `chore` / `docs` / `test` / `style` / `build` / `ci` commits skip karta hai.

---

## 4 - "Live ho gaya ya nahi?" check karna

**API se review state nahi milti.** `edits.tracks.list` ka raw response mein
`review`, `inReview`, `approval`, `published`, `availableToUsers` - in mein se
koi field mojood nahi hai. Sirf `status` hai (`draft` / `inProgress` / `halted` /
`completed`), jo **rollout** batata hai, Google ki approval nahi.

Do tareeqe:

**A. Public store listing (indirect, magar kaam karta hai):**

```powershell
# play.google.com/store/apps/details?id=com.screensync.mcp parh kar
# "Updated on" aur version dekho
```

Agar listing purana version dikha rahi hai to release abhi live nahi hui
(review mein ya propagate ho rahi hai). Ye cache ho sakti hai - isay supported
signal manein, guarantee nahi.

**B. Play Console** -> *Publishing overview* - yahan asli state likhi hoti hai
("Changes in review" / "Changes not yet sent for review" / "Changes ready to
publish"). Ye **sirf insaan** dekh sakta hai; API se nahi hota.

Read-only full state:

```powershell
python .\tools\publish_play.py --version-code 1 --track production --dry-run
```

---

## 5 - Halt / rollback

```powershell
# Rollout rok do (jo update kar chuke un par koi asar nahi)
python .\tools\publish_play.py --version-code 32 --track production --status halted `
    --user-fraction 0.10 --confirm-live-rollout --approved-by "<naam>"
```

- **Halt** sirf naye users ko rokta hai. Jo update kar chuke, woh updated rehte hain
  (woh wapas nahi hote).
- **Poora rollback** official tareeqe se nahi hota - rasta ye hai ke purana
  versionCode dobara release karo, ya ek naya versionCode ship karo jo masla fix kare.
  Is liye pehla production rollout chhote percentage par karna behtar hai.

---

## 6 - Jo API se nahi hota (waste waqt bachao)

- **Review status** - Console UI only.
- **Pehli dafa app banana**, developer account verification, production access apply.
- **App content declarations**, content rating, ads declaration.
- **Data safety form**.
- **Store listing ki approval** / policy appeals.
- **Publishing overview** ka overall state.

Yani "sab kuch automate" ka plan nahi chalta - pehla setup Console se hota hai,
uske baad routine releases API se. Tafseel: `docs/PLAY_API_GUIDE.md`.

---

## 7 - Release se pehle ka checklist

- [ ] `python .\tools\release_notes.py --list-versions` se base revision confirm kiya
- [ ] Notes generate kiye aur **khud parh kar** theek kiye
- [ ] `python .\tools\release_notes.py --check <file>` -> `[OK]`
- [ ] Internal track par pehle bheja
- [ ] `flutter analyze` / `flutter test` pass
- [ ] AAB ka manifest verify (agar permissions badli hon)
- [ ] **LIVE ke liye user se ijazat li** aur `-ApprovedBy` mein uska naam diya
- [ ] Rollout ke baad store listing se "live" confirm kiya
- [ ] Production par pehli dafa ho to chhota `--user-fraction` (jaise 0.10) consider kiya

---

## 8 - Errors aur unka matlab

| Error | Matlab |
|---|---|
| `PRODUCTION rollout ke liye human approval lazmi hai` | Gate ne roka - user se poochein |
| `Release notes 'bug fixes' hain` | Filler notes - `release_notes.py` se banayein |
| `Release notes are 5xx characters` | 500 se zyada - trim karein |
| `versionCode N is not on Play` | Pehle upload karein, ya sahi versionCode dein |
| `Changes to releases require you to specify...` | Track body incomplete - `status` lazmi hai |
| HTTP 403 / permission | Service account ko Play Console mein permission nahi mili |

---

## 9 - Kab is skill ko na use karein

- Sirf code likhna ya test karna - woh normal development hai.
- Website/extension ship karna - woh alag rasta hai (dekhein `CLAUDE.md`).
- Play Console ka pehla setup - woh insaan Console mein karta hai, API se nahi.
