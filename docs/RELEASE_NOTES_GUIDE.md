# Release notes guide - "What's new" (ScreenSync)

Play par har release ke saath ek "What's new" text jata hai. Ye guide batati hai ke
woh text kaisa hona chahiye, aur kaise banaya jata hai.

> **Rule #1: khali ya generic notes ke saath release nahi hogi.**
> `tools/release.ps1` har track par (internal samet) generic notes reject karta hai, aur
> `tools/publish_play.py` production par dobara reject karta hai. Kaun sa phrase kahan
> reject hota hai, ye Section 2b mein hai.

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
4. **"Bug fixes and improvements" na likho.** Ye batata hi nahi kya badla. Tool kaun se
   phrases reject karte hain, ye Section 2b mein hai.
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

### 2b. Kaun sa phrase kahan reject hota hai (code se verify kiya hua)

Do jagah check hoti hai, aur dono ka phrase-list thora alag hai:

| Check | Kab chalta hai | Reject hone wale phrases |
|---|---|---|
| `release_notes.py --check <file>` (aur `release.ps1` isay khud chalata hai) | **Har track** par, jab `release.ps1` notes file/text ke saath chalaya jaye (dry run samet) | `bug fixes and improvements`, `bug fixes and performance improvements`, `bug fixes`, `minor fixes`, `various fixes`, `performance improvements`, `general improvements`, `maintenance release`, `tbd`, `todo`, `n/a` (11), aur khali notes |
| `publish_play.py` | Sirf **production** (non-dry-run) par | Upar wale 11 **plus** `internal test build` aur `initial release` (13). `--allow-generic-notes` se bypass hota hai (jaan boojh kar, tavsiya nahi) |

Do baatein aur:

- Phrase tab reject hota hai jab us ko hata kar bacha hua text **24 characters se chhota** ho. Yani
  "bug fixes" ke saath asli tafseel likhi ho to wo generic nahi maani jati. Phir bhi generic phrase
  se shuru mat karo: user ko "kya badla" batao.
- Length ka rule alag hai aur `publish_play.py` mein **har track** par laagu hai: 500 se zyada
  characters par exit code 1.

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

- Conventional commits (feat / fix / perf / refactor / revert) parh kar:
  `feat` -> **NEW**, `perf`/`refactor` -> **IMPROVED**, `fix`/`revert` -> **FIXED**
- `chore`, `docs`, `test`, `style`, `build`, `ci` aur internal scopes
  (`release`, `ci`, `docs`, `tooling`, `deps`, `repo`, `website`) **skip** kar deta hai, saath hi
  wo subjects jin mein `handler`, `schema`, `catalogue`, `line endings` jaise andar ke lafz hon
- Commit subject ke shuru ka BOM (U+FEFF) hata deta hai
- Sirf `lib/` aur `android/` ko chhoone wale commits leta hai (hub/extension/website nahi)
- Duplicate lines hata deta hai
- **500 characters ka budget enforce karta hai** - agar zyada ho to sab se kam
  ahem lines hatata hai aur saaf print karta hai ke kya hataya gaya
- Budget ke andar aane ke baad bhi over ho to exit code 1 deta hai

`--json` se machine-readable output milta hai (version, text, characters, groups).

---

## 4. Release ke waqt (recommended flow)

```powershell
# Internal par pehle test karo - notes lazmi hain
.\tools\release.ps1 -Track internal -BumpVersion -NotesFromGit -SinceVersion 2.5.4

# Notes ko hamesha parh kar khud approve karo. Production LIVE hai: PEHLE user se poochein, phir
# internal par upload hui versionCode <n> ko promote karo (-BumpVersion production par nahi).
.\tools\release.ps1 -Track production -VersionCode <n> -SkipBuild -SkipTests -NotesFromGit -SinceVersion 2.5.4 `
    -ConfirmLiveRollout -ApprovedBy "<user ka naam>"
```

`release.ps1` khud `release_notes.py --check` chalata hai. Notes fail hon to
release ruk jati hai. Staged rollout (`--user-fraction`) sirf `publish_play.py` se hota hai
(`docs/LOCAL_RELEASE.md` Section 2.3).

---

## 5. Purana case: 2.5.4 (15 Sept 2026 ka snapshot; is note ko theek karna baqi tha)

Us waqt (15 Sept 2026) jo live tha (galat). Aaj ki live state store listing se dobara check karein,
is section ko aaj ki state na samjhein:

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
hai). Command ready hai, magar bina ijazat nahi chalayi jayegi (pehle user se poochein):

```powershell
.\tools\release.ps1 -Track production -VersionCode 31 -SkipBuild -SkipTests -NotesFile build\notes.en-US.txt `
    -ConfirmLiveRollout -ApprovedBy "<user ka naam>"
```

> Note: release notes update karne par Play aam taur par dobara review karta hai.
> Agar ab review cycle nahi chahiye, to ye text agli release ke saath bhej dein.

---

## 6. Notes ki language (en-GB default) aur doosri zubaan

Play per-language notes leta hai. **Default language `en-GB` hai**, `en-US` nahi: is app ki store
listing ki default (aur akeli) language `en-GB` hai (`edits.details.get`, `docs/PLAY_API_GUIDE.md`
Section 12), aur notes ki language listing ki language se milni chahiye, warna Play un notes ko
dikha nahi sakta. `publish_play.py --notes-language` aur `release.ps1 -NotesLanguage` dono ka
default `en-GB` hai. Notes file ka naam `build\notes.en-US.txt` sirf ek naam hai (purani aadat);
language us naam se nahi, `--notes-language` se tay hoti hai.

Tool ek publish call mein **sirf ek** language ki notes bhejta hai (`releaseNotes` mein ek hi
entry). Doosri zubaan ke liye:

1. Us zubaan ki notes file banayein (jaise `build\notes.ur.txt`).
2. `--notes-language <code> --notes-file <file>` ke saath publish karein.
3. Ek hi release mein kai zubaanein bhejni hon to `publish_play.py` mein `releaseNotes` list mein
   entries badhani hongi; filhal ye code mein nahi hai.

Zubaan add karne se pehle confirm karein ke us zubaan ki store listing mojood hai -
warna Play us language ke notes ignore kar dega.

---

## 7. Tool ka asli output (reference)

`python .\tools\release_notes.py --since-version 2.5.0` ka output (15 Sept 2026 ka snapshot: 94 commits
parhe, 23 app-facing, 456/500 characters):

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