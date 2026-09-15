# Release notes guide - "What's new" (ScreenSync)

Play par har release ke saath ek "What's new" text jata hai. Ye guide batati hai ke
woh text kaisa hona chahiye, aur kaise banaya jata hai.

> **Rule #1: khali ya generic notes ke saath LIVE release nahi hogi.**
> `tools/release.ps1` aur `tools/publish_play.py` dono production par
> "Bug fixes and improvements" jaisi notes reject kar dete hain.

---

## 1. Google ka official rule

Official source: <https://support.google.com/googleplay/android-developer/answer/9859348>

> "You can enter release notes using up to 500 Unicode characters per language."

Iska matlab:

- **500 Unicode characters per language** - is se zyada Play accept nahi karega.
  Matlab spaces aur newlines bhi count hote hain.
- Notes **per language** hote hain. API mein `releaseNotes[{language, text}]`.
- Play Console mein yehi text store listing ke "What's new" section mein dikhta hai.

Teen tareeqe hain jisse ye limit toot jati hai: lamba changelog, bullet points ki
bhari list, aur URL/emoji spam. Is liye tool 500 ka budget khud enforce karta hai.

---

## 2. ScreenSync ka house style

1. **Sirf woh likho jo user mehsoos kar sakta hai.** "Refactor dispatcher" user ke
   liye kuch nahi hai. "Pairing screen rebuilt, QR ab foran scan hota hai" hai.
2. **Groups use karo: NEW / IMPROVED / FIXED.** User 1 second mein samajh jaye.
3. **Adhoora wada na karo.** Sirf woh likho jo is release mein waqai gaya hai.
4. **"Bug fixes and improvements" na likho.** Ye batata hi nahi kya badla. Ye
   patterns tool reject karta hai:
   `bug fixes`, `bug fixes and improvements`, `performance improvements`,
   `minor fixes`, `various fixes`, `general improvements`, `maintenance release`,
   `initial release`, `tbd`, `todo`, `n/a`, `internal test build`.
5. **Andar ki baatein bahar na lao.** Commit hashes, ticket numbers, file names,
   customer names, tokens - kuch bhi nahi.
6. **Asaan zubaan, present/simple past.** "QR scan fix" behtar hai "Rectified the
   QR decode regression" se.
7. **Ek line = ek change.** Lambi kahaani nahi.
8. **ASCII rakho** jab tak waqai zaroorat na ho - translator se pehle ye tooling
   par safar karti hai.

### Template

```
NEW
- <naya feature, seedha faida>

IMPROVED
- <jo pehle se behtar hua>

FIXED
- <jo toota hua theek hua>
```

---

## 3. Notes banane ka tareeqa (tool)

`tools/release_notes.py` git history se notes banata hai.

```powershell
# 1. Pehle base revision dekho (pubspec.yaml ki version timeline)
python .\tools\release_notes.py --list-versions

# 2. Us revision ke baad ke changes se notes banao (screen par dikhao)
python .\tools\release_notes.py --since-version 2.5.0

# 3. File mein likho, taake release ke saath jaye
python .\tools\release_notes.py --since-version 2.5.0 --write build\notes.en-US.txt

# 4. Kisi bhi notes file ko validate karo (length + filler)
python .\tools\release_notes.py --check build\notes.en-US.txt
```

Tool kya karta hai:

- Conventional commits (feat / fix / perf / refactor) parh kar:
  `feat` → **NEW**, `perf`/`refactor` → **IMPROVED**, `fix` → **FIXED**
- `chore`, `docs`, `test`, `style`, `build`, `ci` aur internal scopes
  (`release`, `ci`, `docs`, `tooling`) **skip** kar deta hai
- Duplicate lines hata deta hai
- **500 characters ka budget enforce karta hai** - agar zyada ho to sab se kam
  ahem lines hatata hai aur saaf print karta hai ke kya hataya gaya
- Budget ke andar aane ke baad bhi over ho to exit code 1 deta hai

`--json` se machine-readable output milta hai (version, text, characters, groups).

---

## 4. Release ke waqt (recommended flow)

```powershell
# Internal par pehle test karo - notes lazmi hain
.\tools\release.ps1 -Track internal -BumpVersion -NotesFromGit -SinceVersion 2.5.0

# Notes ko hamesha parh kar khud approve karo, phir production
.\tools\release.ps1 -Track production -VersionCode 32 -NotesFromGit -SinceVersion 2.5.4 `
    -ConfirmLiveRollout -ApprovedBy "Khizar"
```

`release.ps1` khud `release_notes.py --check` chalata hai. Notes fail hon to
release ruk jati hai.

---

## 5. Purana case: 2.5.4 (is note ko theek karna baqi hai)

Jo live hai (galat):

```
Bug fixes and performance improvements.
```

Asli changes jo 2.5.0 (vc25) ke baad user-facing the - `git log` se:

- Pairing screen dobara banaya gaya, motion aur real fallbacks ke saath
- Pairing QR scan fix (pehle decode hi nahi hota tha), `scanWindow` hata diya
- Pairing page ab dead end nahi - fail hone par aage ka rasta milta hai
- Connect-kit: live endpoint, global install, QR ke saath address
- Phone se hub ka **live mirror** (opt-in)
- Hub maintenance timer re-arm - auto-sync disconnect ke baad bhi chalti rehti hai
- ADB target resolution fix (jab host ek phone ko do dafa dekhe)
- **In-app update channel**: hub build publish karta hai, phone install karta hai
- **Play In-App Updates (Immediate)** + periodic Play update check
- Play build se `REQUEST_INSTALL_PACKAGES` hataya (Play policy compliance)
- OS-control opt-in ab host setting hai, desktop app se control hoti hai

Behtar text (500 characters ke andar):

```
NEW
- Live mirror: hub ab phone ki screen dekh sakta hai
- In-app update channel: nayi build seedha phone par install

IMPROVED
- Pairing screen naya, motion aur behtar error handling ke saath
- Connect-kit: live endpoint, address QR ke saath
- Auto-sync disconnect ke baad khud bahal

FIXED
- Pairing QR ab scan hota hai
- ADB target jab host ek phone ko do dafa dekhe
- Play update check (Immediate in-app updates)
```

Ye text live release par update karne ke liye human approval chahiye (live track
hai). Command ready hai, magar bina ijazat nahi chalayi jayegi:

```powershell
.\tools\release.ps1 -Track production -VersionCode 31 -NotesFile build\notes.en-US.txt `
    -ConfirmLiveRollout -ApprovedBy "<naam>"
```

> Note: release notes update karne par Play aam taur par dobara review karta hai.
> Agar ab review cycle nahi chahiye, to ye text agli release ke saath bhej dein.

---

## 6. Agar notes English ke ilawa doosri zubaan mein chahiye

Play per-language notes leta hai. Tool filhal **en-US** text banata hai (kyunke
commits English mein hain).

Doosri zubaan ke liye:

1. `build\notes.<lang>.txt` banayein (jaise `notes.ur.txt`).
2. `release.config.json` ya CLI se us file ka path dein.
3. `publish_play.py` mein `releaseNotes` list mein ek aur entry add karni hogi -
   filhal tool `en-US` likhta hai. Ye agla kaam hai agar multi-language chahiye.

Zubaan add karne se pehle confirm karein ke us zubaan ki store listing mojood hai -
warna Play us language ke notes ignore kar dega.

---

## 7. Tool ka asli output (reference)

`python .\tools\release_notes.py --since-version 2.5.0` ka output (94 commits parhe,
23 app-facing, 456/500 characters):

```
NEW
- Play In-App Updates (Immediate) + a periodic Play update check
- Blocking update gate, Play-aware, plus a Play release workflow
- In-app update channel - hub publishes the build, phones install it
- Opt-in live mirror so the hub can see the phone screen

FIXED
- The pairing QR could never be decoded - drop the scanWindow
- Re-arm hub maintenance timer so auto-sync survives a disconnect
- Migrate deprecated Radio groupValue/onChanged to RadioGroup
```

Ye **draft** hai, final nahi. Do cheezein insaan ko karni hain:

1. "Blocking update gate, Play-aware, plus a Play release workflow" jaisi lines ko
   user ki zubaan mein likhna.
2. Budget 500 hai - agar koi ahem change reh gaya ho to kam ahem line hata kar
   usay shamil karna. Tool ne jo lines hatayi thin woh `[WARN]` mein print hoti hain.

Tool app-facing changes ko `lib/` aur `android/` paths se pehchanta hai, is liye
hub/extension/website ka kaam Play listing mein nahi aata.