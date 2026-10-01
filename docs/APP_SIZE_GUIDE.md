# App size guide - ScreenSync

Sawal: "app ka size 5-7 MB tak ho sakta hai?" Short jawab: **Flutter ke saath nahi.**
Neeche wo asli numbers hain jo maine AAB ke andar se nape.

Measured on: `build/app/outputs/bundle/release/app-release.aab` (15 Sept 2026, versionCode 31). Ye flavors
se pehle ka path hai; ab Play bundle `build/app/outputs/bundle/playRelease/app-play-release.aab` mein aata hai
(`flutter build appbundle --release --flavor play`).
AAB file size: **55.02 MB**. Uncompressed contents: **153.01 MB**.

---

## 1. Andar kya kya hai (uncompressed)

| Hissa | Size | User download karta hai? |
|---|---|---|
| `BUNDLE-METADATA/` (debug symbols + proguard map) | **81.1 MB** | **Nahi** - Play sirf crash deobfuscation ke liye rakhta hai |
| `base/lib/` (native code, 3 ABIs) | 71.7 MB | Sirf apne phone ka ABI |
| `base/dex/` (Java/Kotlin code) | 3.5 MB | Haan |
| `base/res/` (layouts, drawables) | 2.4 MB | Haan |
| `base/assets/` (fonts, ML Kit models) | 1.1 MB | Haan |
| `base/resources.pb` + manifest + root | 0.6 MB | Haan |

Bara important nuqta: **81 MB sirf debug symbols hain**, jo AAB ko bara dikhate hain
magar kisi user tak nahi jate. Is liye "55 MB app" wala number galat tasveer deta hai.

---

## 2. Per-ABI breakdown (ye asli size hai)

| ABI | Native libs | Kaun sa device |
|---|---|---|
| `arm64-v8a` | **23.23 MB** | Aaj ke taqreeban saare phones |
| `armeabi-v7a` | 19.64 MB | Purane 32-bit phones |
| `x86_64` | 25.52 MB | Emulators / Chromebooks (nagani). **Ab default builds se hata diya gaya hai** (Section 8), sirf ML Kit ki ek lib (5.8 MB) reh jati hai |

`arm64-v8a` ke andar:

| Library | Size | Kis cheez se |
|---|---|---|
| `libflutter.so` | **11.11 MB** | Flutter engine - **hatai nahi ja sakti** |
| `libapp.so` | **8.13 MB** | Hamara Dart code (AOT) |
| `libbarhopper_v3.so` | **4.95 MB** | **ML Kit barcode (QR scanner)** - `mobile_scanner` |
| baqi chhoti libs | 0.18 MB | dartjni, image_processing, surface_util |

Yani arm64 user ka download ≈ `23.23 + 3.5 + 2.4 + 1.1 + 0.6` = **~30.8 MB**
(uncompressed). Play dex/res compress kar deta hai, is liye asli download is se
thora kam hota hai - magar native libs aaj kal uncompressed hi rakhi jati hain,
is liye isay ~28-31 MB ka ceiling manein.

**Flutter ka floor:** khali Flutter app bhi arm64 par ~11 MB (`libflutter.so` +
minimal `libapp.so`) hoti hai. Is liye **5-7 MB Flutter ke saath mumkin nahi** -
ye engine ka apna size hai, hamare code ka nahi.

---

## 3. Ek asli masla: hub ka OTA APK 77 MB ka tha (ab `build_ota_apk.ps1` hai)

| Cheez | Size |
|---|---|
| Play par AAB (per-device split hota hai) | ~30 MB download |
| **Hub ka OTA APK** (`/apk`) | **77,159,084 bytes = 77.16 MB** |

15 Sept 2026 ko hub **universal APK** de raha tha - teeno ABIs ek hi file mein:
`23.23 + 19.64 + 25.52 = 68.4 MB` libs + dex + res ≈ 77 MB. Ye arithmetic bilkul
match karti hai.

Is liye sideloaded users (jo hub se install karte hain) **77 MB** download karte hain,
jabke unhein sirf ~30 MB chahiye. **Ye sab se bara, sab se asaan, aur zero-risk fix hai.**

### Fix (feature kuch nahi tootta) - ab mojood hai
```powershell
# Hub ke liye OTA APK: x86_64 ke bagair (arm64 + armeabi-v7a), ~25 MB chhoti
.\tools\build_ota_apk.ps1

# Sab se chhoti: sirf arm64 (~30 MB). Bahut purane 32-bit phones par install nahi hogi.
.\tools\build_ota_apk.ps1 -Arm64Only
```
`tools/build_ota_apk.ps1` `flutter build apk --release --flavor sideload --target-platform ...` chalata
hai aur `build\app\outputs\flutter-apk\app-sideload-release.apk` banata hai. Hub isi APK ko `/apk` par
serve karta hai (version `build\app\outputs\apk\sideload\release\output-metadata.json` se). Sideload flavor
isliye zaroori hai ke sirf usi mein `REQUEST_INSTALL_PACKAGES` hoti hai (`docs/LOCAL_RELEASE.md` Section 6b).

Note: ye ek hi APK hai (jo target platforms aap dein wohi ABIs us mein). Hub phone ke ABI ke hisaab se
alag alag APK nahi chunta, aur `--split-per-abi` wala raasta abhi banaya nahi gaya.

---

## 4. Kya kya kam ho sakta hai (feature toote bagair)

| # | Change | Bachat (arm64 download) | Risk |
|---|---|---|---|
| 1 | ~~Hub ka APK chhota karo~~ **Ho chuka:** `tools/build_ota_apk.ps1` (Section 3) | **~25 MB chhoti** (default: x86_64 hat jata hai), **~30 MB** (`-Arm64Only`) | Kam - sirf packaging |
| 2 | ~~`x86_64` hatao~~ **Ho chuka:** `--target-platform android-arm,android-arm64` (`abiFilters` se nahi, Section 8) | AAB 55.03 -> 40.73 MB; arm64 users ko farq nahi | Kam - emulator testing ke liye `-TargetPlatform android-x64` |
| 3 | **`mobile_scanner` (ML Kit) hatao**, halka QR decoder (ZXing based) lagao | **~5.8 MB** (`libbarhopper_v3.so` + tflite models) | **Medium** - QR scanning dobara test karni paregi |
| 4 | `minifyEnabled true` + `shrinkResources true` (R8) | 1.5-2.5 MB (dex + res) | **Medium** - reflection wala code toota to crash |
| 5 | `--split-debug-info` / `--obfuscate` | `libapp.so` thora chhota | Kam |
| 6 | `NOTICES.Z` aur duplicate splash PNGs | ~0.5 MB | Kam |

**Sab kuch karne ke baad realistic floor:** arm64 download **~20-24 MB**.
Aur agar QR scanner bhi halka kar diya jaye to **~18 MB** ke qareeb.
**5-7 MB tak pohanchna Flutter + camera QR ke saath mumkin nahi.**

### Jo bilkul nahi ho sakta
- `libflutter.so` (11 MB) - Flutter engine. Isay hataane ka matlab Flutter hataana.
- Feature, design ya functionality ka koi hissa hataana - user ne mana kiya hai.
  Section 4 ke items mein se koi bhi cheez **user-facing feature nahi hataati**;
  #3 aur #4 sirf internal implementation badalte hain, magar device par test zaroori hai.

---

## 5. Skills ka data - kya woh space le raha hai?

**Nahi.** Ye check kiya:

- App ke `assets/` folder ka total **0.84 MB** hai (do branding PNGs).
- "Skills" app mein bundle nahi hoti. App unhein **hub se live** leta hai:
  `GET /api/mcp/catalog` -> `lib/repositories/screen_repository.dart` ->
  `lib/screens/tabs/mcp_tab.dart` (wahan "Skills / Prompts (N)" section banta hai).
- Hub ka catalog response abhi **117 KB** hai. Yani skills ka poora data 117 KB hai -
  app ke size mein is ka koi role nahi.

Is liye "skills ko live site se load karein" wala plan **size ke liye zaroori nahi**.
Magar uska apna ek faida hai: skills ko hub ke bagair bhi update kiya ja sakta hai.
Agar aap ye chahte hain to ye ek *design* change hai, size optimization nahi:

- App mein ek chhota manifest (skills ki list + URLs) rakhein.
- "Copy skill" par `https://www.screensyncmcp.tech/skills/<name>.md` se fetch karein
  aur clipboard mein daalein, saath ek local cache (offline ke liye).
- Yad rakhein: `lib/widgets/connect_kit_card.dart` mein pehle se "Copy this MCP server
  + skills" wala button hai, jo hub se aata hai - usay preset rakhna behtar hai taake
  hub ke bagair kaam kare.

Faisla aap ka hai; **size ke liye ye qadam zaroori nahi**, aur hub se aane wala data
pehle se halka hai.

---

## 6. Tajweez (tarteeb ke saath)

1. ~~Hub ka APK chhota karo~~ - ho chuka (`tools/build_ota_apk.ps1`, Section 3).
2. ~~`x86_64` hatao~~ - ho chuka (`--target-platform`, Section 8).
3. R8 minify + shrinkResources chalu karo, aur **device par poora regression** karo.
4. QR scanner ko halke decoder se badlo, agar 5.8 MB ki bachat waqai chahiye.
5. Har qadam ke baad `flutter build appbundle --release --flavor play` se AAB ke andar ka
   per-ABI total dobara naapo (Section 7 ka command).

**Har size change ke baad device par test lazmi hai.** App production mein live hai
(15 Sept 2026 ke record ke mutabiq versionCode 31; `pubspec.yaml` ab `+32` hai, `docs/LOCAL_RELEASE.md`
Section 0), is liye size optimization ko chhote steps mein aur staged rollout ke saath bhejna chahiye.

---

## 7. Naapne ka command

```powershell
$zip = [System.IO.Compression.ZipFile]::OpenRead("build\app\outputs\bundle\playRelease\app-play-release.aab")
$zip.Entries | Where-Object { $_.FullName -match '^base/lib/([^/]+)/' } |
  Group-Object { ($_.FullName -split '/')[2] } |
  ForEach-Object { "{0,-14} {1,10:N0} b = {2:N2} MB" -f $_.Name, ($_.Group | Measure-Object Length -Sum).Sum,
                   (($_.Group | Measure-Object Length -Sum).Sum/1MB) }
$zip.Dispose()
```

---

## 8. Update: AAB 55.03 MB -> 40.73 MB (verified 15 Sept 2026)

Asli lever `--target-platform` hai, `abiFilters` nahi:

| Build | Command | AAB |
|---|---|---|
| Pehle | `flutter build appbundle --release` (flavors se pehle; ab `--flavor play` lagta hai) | **55.03 MB** (arm64 23.23 + armv7 19.64 + x86_64 25.52) |
| Ab | `... --target-platform android-arm,android-arm64` | **40.73 MB** (arm64 23.23 + armv7 19.64 + x86_64 5.80) |

Bachat: **14.3 MB (26%)**. `release.ps1` mein `-TargetPlatform` add ho gaya
(default `android-arm,android-arm64`).

### Jo kaam NAHI kiya (is liye revert kar diya)
`android/app/build.gradle` mein `buildTypes.release.ndk.abiFilters` add karne ki koshish ki gayi -
**uska koi asar nahi hua**: AAB aur APK dono bilkul waise hi rahe (486 entries identical).
Flutter ka gradle plugin ABI set khud `--target-platform` se set karta hai, is liye woh config
ignore ho jati hai. Woh change revert kar diya gaya - repo mein bekaar config nahi chhori.

### x86_64 ka bacha hua 5.80 MB
`libbarhopper_v3.so` (ML Kit, `mobile_scanner` ka hissa) x86_64 ke liye bhi ship hota hai aur
`--target-platform` usay nahi hatata. Isay hatane ka wahid tareeqa QR scanner badalna hai
(Section 4, item 3) - woh alag kaam hai aur device par test maangta hai.

### Verification (sab pass)
- `flutter analyze` -> No issues found
- `flutter test` -> **48 tests pass**
- Emulator (`Medium_Phone_API_36.1`, x86_64) par release APK install -> `versionCode=31`,
  `versionName=2.5.4`, app launch hui, logcat mein koi FATAL / Flutter error nahi
- AAB structural comparison: `base/**` (lib ke bagair) **472 entries, 0 differences** -
  yani dex, resources, assets aur manifest bilkul waise hi hain; sirf native ABIs badle.
  Is liye kisi feature ya design par koi asar nahi.