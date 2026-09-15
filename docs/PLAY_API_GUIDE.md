# Google Play Developer API - deep dive (ScreenSync)

Ye guide batati hai ke Google Play ke APIs se hum kya kya kar sakte hain, aur -
zyada zaroori - kya **nahi** kar sakte. Har baat ke saath source ya evidence diya
gaya hai.

App: `com.screensync.mcp`
Developer account: `advance-archery-505415-r2`
Service account: `play-publish@advance-archery-505415-r2.iam.gserviceaccount.com`

---

## 1. Do alag APIs hain - inhe mix na karein

| API | Kaam | Humans ke liye |
|---|---|---|
| **Google Play Developer API** (`androidpublisher`) | Publish karna, tracks, bundles, store listing, purchases, reviews, users | Ye "Play Console ka API" hai |
| **Play Developer Reporting API** (`playdeveloperreporting`) | Metrics: crash rate, ANR rate, installs, vitals | Ye "statistics ka API" hai |

`androidpublisher` ka official overview: <https://developers.google.com/android-publisher/api-ref/rest>
("This document provides an overview of the Google Play Developer APIs, a suite of REST-based web service APIs for performing publishing, reporting...")

Reporting API: <https://developers.google.com/play/developer/reporting>
("The Google Play Developer Reporting API gives you programmatic access to app-level data and metrics for internal reporting, analysis and automation.")

Overall guide: <https://developer.android.com/google/play/developer-api>

---

## 2. Auth: service account

- Ek Google Cloud service account banao, us ka JSON key lo.
- Play Console -> **Users and permissions** -> service account ko invite karo aur
  app-level permissions do (Releases: "Release to production", "Manage testing tracks" waghera).
- OAuth scope jo is repo ka tool use karta hai:
  `https://www.googleapis.com/auth/androidpublisher`

Is repo mein resolution order ye hai (dekhein `tools/publish_play.py`):

1. `--service-account <path ya inline JSON>`
2. env var `PLAY_SERVICE_ACCOUNT_JSON`
3. `tools/release.config.json` ki key `serviceAccountPath`

Current config: `tools/release.config.json` (path `C:\Users\epsol\Downloads\advance-archery-505415-r2-...json`).

> Ye key ek **credential** hai. Isay repo mein commit na karein (`.gitignore` mein hai).

---

## 3. `edits` - publishing ka darwaza

Play par har change ek **edit** ke andar hota hai. Edit = ek transaction.

Karne ka tareeqa:

```
edits.insert            -> ek edit id milta hai (kuch bhi abhi visible nahi hai)
   ... changes karo ...
edits.commit            -> tab ja kar change publish hota hai
edits.delete            -> edit chhor do (kuch bhi publish na ho)
```

Agar aap commit nahi karte to **kuch bhi live nahi jata**. Isi liye is repo ka
read-only check script ek edit kholta hai, parhta hai, aur delete kar deta hai.

`edits.*` ke andar jo resources is project ke liye kaam ke hain:

| Resource | Kaam |
|---|---|
| `edits.bundles` | AAB upload / list (`upload`, `list`) - ScreenSync yahi use karta hai |
| `edits.tracks` | Track par release attach karna (`list`, `get`, `update`) |
| `edits.listings` | Store listing text (title, short description, full description) per language |
| `edits.images` | Store screenshots / feature graphics per language |
| `edits.testers` | Closed testing ke tester lists (email/Groups) |
| `edits.details` | Default language, contact details |
| `edits.deobfuscationfiles` | R8/ProGuard mapping file upload (crash deobfuscation) |
| `edits.expansionfiles` | Legacy APK expansion files (OBB) |
| `edits.apks` | Purane APK-based releases |
| `edits.customStoreListings` | Custom store listings (targeted/experiment listings) |

`edits.listings.list` reference: <https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/list>

---

## 4. Track aur release status (ye samajhna zaroori hai)

`edits.tracks` ka `TrackRelease` object:

- `versionCodes` - kaun sa build
- `status` - `draft` | `inProgress` | `halted` | `completed`
- `userFraction` - staged rollout ka percentage
- `releaseNotes` - per language "What's new"
- `name` - release ka naam

Official reference: <https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks>

Us page se:
- `userFraction`: "Can only be set when status is 'inProgress' or 'halted'."
- `draft`: "The release's APKs are not being served to users..."

Iska matlab:

| Aap kya chahte hain | `status` | `userFraction` |
|---|---|---|
| Sirf save karo, users ko na do | `draft` | nahi |
| 10% users ko do | `inProgress` | `0.10` |
| Poori tarah rok do | `halted` | jo tha wohi |
| 100% users ko do | `completed` | nahi (field hi nahi aata) |

### Ek asli gotcha

`status: completed` ka matlab "100% rollout complete" hai - **ye "Google ne approve kar diya" nahi hai**.
Ye do alag cheezein hain, aur API sirf pehli batata hai. Neeche point 6 dekhein.

---

## 5. Aur kya kya ho sakta hai (Publishing ke ilawa)

| Resource | Kaam |
|---|---|
| `inappproducts` | Managed products aur subscriptions create/update/list |
| `purchases.products` | Purchase verify/acknowledge/get (server-side validation) |
| `purchases.subscriptions` | Subscription state (renewals, revoke, defer, acknowledge) |
| `purchases.voidedpurchases` | Cancel/refund/chargeback hui purchases |
| `reviews` | User reviews parhna aur reply karna ("Reply to Reviews API") |
| `users` | Developer account ke users + un ke grants manage karna |
| `generatedapks` | Play-generated APKs download karna (per-device splits) |
| `externaltransactions` | Play ke bahar hui payments report karna (special approval) |
| `monetization` | Subscription/one-time product base plans aur offers |
| `applications` | App-level metadata / device tier config |
| `systemapks` | Android App Bundle se device-specific system APK variants |

`purchases.products.get` reference: <https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.products/get>
Overview (Reply to Reviews): <https://developer.android.com/google/play/developer-api>

Mere observation ki hadd (is turn mein): yeh list official reference index ke
search results se bani hai, har resource ka page main ne alag se open nahi kiya.
Jo resources is repo ka tool already use karta hai woh **observed** hain (point 8).

---

## 6. Jo API se BILKUL nahi hota (sab se zaroori hissa)

### 6.1 Review state
Koi bhi `edits.*` endpoint release ka review status ("In review", "Changes not yet
sent for review", "Available to users") nahi deta. Ye **Play Console UI** ki cheez hai.

**Is repo ki apni empirical evidence** (read-only check, 15 Sept 2026):

```
edits.tracks.list raw response parse kiya, phir in field names ko count kiya:
   review            = 0
   inReview          = 0
   approval          = 0
   published         = 0
   availableToUsers  = 0
   status            = 4   <- sirf ye ek field hai
```

Community evidence bhi yahi kehti hai:
- <https://stackoverflow.com/questions/72534856/google-play-console-api-get-release-status>
- <https://www.reddit.com/r/GooglePlayDeveloper/comments/1oiakvg/how_to_get_google_play_review_status_or_finalize/>

**Amli halka jawab:** "review pass ho gaya ya nahi" confirm karne ka koi official
API tareeqa nahi. Do options hain - Play Console ka *Publishing overview*
manually dekho, ya Gmail par Play ke emails dekho.

### 6.2 Live honay ka indirect signal (ye kaam karta hai)
Bahar se confirm karne ka ek tareeqa hai: **public store listing**.

Is repo mein ye verify hua (15 Sept 2026):

| Waqt | Store listing | Matlab |
|---|---|---|
| 15:23 | `2.5.0`, "Updated on Aug 29, 2026", 2.5.4 ka zikr 0 | Release review mein / propagate nahi hui |
| 15:40 | `2.5.4`, "Updated on Sep 15, 2026", "What's new" = naya text | **Release live ho gayi** |

Yani store page ka version + "Updated on" ek acha (magar indirect) live-signal hai.
Ye cache ho sakti hai, is liye isay 100% truth na manein - supported signal manein.

### 6.3 Aur jo API se nahi hota
- **Pehli dafa app banana** - ye Play Console se hi hota hai.
- **Developer account verification** aur **production access** apply karna.
- **App content declarations** (privacy policy, ads, target audience, content rating).
- **Data safety form**.
- **Policy/compliance answers** aur appeals.
- **Publishing overview** ka overall state.

Ye sab Console UI tak mehdood hain. Is liye "sab kuch API se automate kar denge"
wala plan kaam nahi karta - pehla setup console se hota hai, uske baad routine
releases API se ho sakti hain.

> Evidence note: 6.3 ke points **official docs se quote nahi kiye** - ye in APIs ke
> surface se na hone (absence) se samjhe gaye hain, plus 6.1 ki empirical evidence.
> Inhe "high confidence, exact page quote nahi" ke tor par parhein.

---

## 7. Reporting API se kya milta hai

- Crash rate, ANR rate, user-perceived crash/ANR rates
- Installs, uninstalls, ratings
- Per-metric, per-dimension queries with time ranges

Reference: <https://developers.google.com/play/developer/reporting/reference/rest>

Ye publishing se alag hai, aur is ka setup alag hai (naya API enable + service
account). ScreenSync ke liye useful ho sakta hai agar humein "naya version
crash to nahi kar raha" wala automatic check chahiye.

---

## 8. Is repo ka tool kya use karta hai (observed)

`tools/publish_play.py` ye calls karta hai - aur ye sab **is a/c par chal chuki hain**:

| Call | Kahan | Status |
|---|---|---|
| `edits.insert` | edit kholna | observed (works) |
| `edits.bundles.upload` | AAB upload | observed (55 MB AAB upload hui) |
| `edits.bundles.list` | uploaded versionCodes dekhna | observed |
| `edits.tracks.update` | release attach karna | observed |
| `edits.commit` | publish | observed |
| `edits.tracks.get` | verify | observed |
| `edits.delete` | cleanup | observed |

Aur ye **is repo ki read-only check** se chalti hai: `edits.tracks.list`.

Production aur internal dono tracks par vc 31 attach ho chuka hai, aur
`edits.bundles.list` se confirm hua ke `['25', '31']` mojood hain.

---

## 9. Is guide ki evidence states

| Claim | State |
|---|---|
| `edits.*` chain (insert/upload/tracks.update/commit) chalti hai | **Observed** - is a/c par asli releases |
| API review status expose nahi karta | **Observed** - raw response field counts (6.1) |
| Track status enum + `userFraction` rule | **Documented** - official page quotes (point 4) |
| Store listing = live honay ka indirect signal | **Observed** - 15:23 vs 15:40 comparison |
| Reporting API kabhi use nahi kiya | **Not verified** - sirf docs se |
| 6.3 ki "API se nahi hota" list | **High confidence, page quote nahi** |

---

## 10. Sources

Search ke waqt jo pages mile (snippet-level evidence):

- <https://developers.google.com/android-publisher/api-ref/rest> - API overview
- <https://developer.android.com/google/play/developer-api> - Developer APIs guide
- <https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks> - TrackRelease fields + status
- <https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks/update> - track update method
- <https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings/list> - listings
- <https://developers.google.com/play/developer/reporting> - Reporting API
- <https://developers.google.com/play/developer/reporting/reference/rest> - Reporting REST
- <https://support.google.com/googleplay/android-developer/answer/9859348> - release notes ki 500-character limit
- <https://support.google.com/googleplay/android-developer/thread/462608398> - custom store listings API
- <https://stackoverflow.com/questions/72534856/google-play-console-api-get-release-status> - review state nahi milti
