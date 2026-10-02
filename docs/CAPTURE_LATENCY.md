# Capture latency: how a frame is found, and how to measure it

The Kotlin capture path has no unit tests (see CLAUDE.md §8), so its timing is
checked by hand on a device. This page says what the path does, why a still
screen used to take about 8 s, and how to measure a Snap end to end.

## The Snap path

1. The notification's **Snap** action is a broadcast. `ScreenCaptureService`
   writes `snap:<epochMillis>` to `<app_flutter>/screensync_capture_trigger`.
2. `CaptureTriggerBridge.watch()` polls that file every 200 ms and the bloc runs
   `TriggerScreenCaptureEvent` (`notification_snap`).
3. `ScreenRepository.captureCurrentDisplay()` calls `isPaused`, `isCaptureReady`
   and then `captureScreen` on the `com.screensync.mcp/media_projection` channel.
4. `FrameWaiter` (Kotlin) finds the frame that answers the request and encodes it
   as the request asks (`Image.encode()` in `FrameEncoder.kt`): `inspection` is a
   native-resolution PNG, `fast` and `stream` are the final JPEG at the preset's
   width, with a region crop (if any) applied first. Dart says what it wants in the
   `captureScreen` arguments (`MediaProjectionService.captureArguments`).
5. Dart gets a finished picture (`ProjectionCapture.processed`) and does not decode
   or re-encode it. A bare PNG reply (a native side without the encoder) still goes
   through `CapturePipeline.process()`, which is also what the region editor uses
   to crop a PNG it already holds. The frame is persisted with a thumbnail, then
   `pushToLocalMcpServer()` uploads it.

## Which frame answers a capture

A MediaProjection virtual display only gets a new frame when the screen content
changes. The service used to close every frame while no capture was waiting, then
wait for the *next* frame after a request: 4 s, a "re-prime" retry (a no-op on
Android 14+, where `Surface.promote()` does not exist), and another 4 s. On a
still screen nothing ever arrived, so a Snap took about 8 s, or failed with
"Timed out waiting for a screen frame."

`FrameWaiter` now keeps the newest frame (`LatestFrame`) and answers a request
with:

- the first frame that arrives **after** the request, at once; or
- if none arrives within `SETTLE_MS` (350 ms) and the screen is on, the held
  frame. No newer frame in that window means the screen has not changed since
  the held frame was drawn, so it is what the screen shows now. The window is
  there for a frame drawn just before the request that is still on its way.

A frame is never older than the request when the screen changed after it: any
change produces a newer frame, and a newer frame always wins. The answered frame
stays held, with the pictures already encoded from it (one per request: a PNG and
a JPEG of the same frame do not evict each other, up to three), so a repeat
capture of a still screen costs no wait for a frame and no encode. With the screen off nothing is drawn, so the held
frame is not used, and it is dropped when the screen goes off (the lock screen
may be what comes back). With nothing held at all (no frame since the session
started), the old timeout path applies.

Every capture logs one line (logcat tag `ScreenSync`), and the first capture of a
frame at a given request also logs how long its encode took:

```
capture answered after 18 ms with a new frame
capture answered after 352 ms with the held frame, drawn 5230 ms before
encoded the frame as jpeg 720x1600 in 41 ms, 36702 bytes
```

## Measuring a Snap

Use an emulator or a spare phone and an **isolated hub**, never the live one:

```bash
cp -r mcp-server <scratch>/hub-copy   # or run it from a worktree's mcp-server
cd <scratch>/hub-copy && npm ci && npm run build
export SCREEN_SYNC_PORT=3101 SCREEN_SYNC_NO_MDNS=1 SCREEN_SYNC_DATA_DIR=<scratch>/hub-data
tail -f /dev/null | node dist/index.js   # keeps stdin open for the MCP transport
```

Point the app at it (Settings → Hub, `http://10.0.2.2:3101` on an emulator),
start a capture session, go to a still screen (the launcher), then per run:

1. `adb logcat -c`, note `latestFrameAt` from `GET /health` on the hub.
2. `adb shell cmd statusbar expand-notifications`, wait 2 s, tap **Snap**
   (find its bounds with `uiautomator dump`).
3. Poll `/health` until `latestFrameAt` changes; that is when the hub has the
   frame.
4. `adb logcat -d -v epoch | grep ScreenSync` shows the `capture answered` line
   for the native wait. The difference between the tap and `latestFrameAt` is
   the end-to-end time.

Run each case several times: the first capture after a session starts can take
longer, and an emulator with little RAM swaps.

Things that bit this measurement:

- Time on the **device clock**. `adb shell input tap` starts a Java process and
  can take seconds on a loaded emulator, and adb round trips there were 1 to 2 s,
  so a host timestamp says little about when the tap landed.
- Tapping Snap animates the button, and that animation produces frames. To test a
  truly still screen, write the trigger instead (debug build):
  `adb shell "run-as com.screensync.mcp sh -c 'printf snap:%s \$(date +%s%3N) > app_flutter/screensync_capture_trigger'"`
- In Git Bash, set `MSYS_NO_PATHCONV=1`, or `/sdcard/...` arguments to adb are
  rewritten into Windows paths.

## Results (2026-10-02)

Emulator `sdk_gphone64_x86_64`, Android 16 (API 36), 2 GB guest RAM (swapping,
load average 5 to 15), debug x86_64 build, `fast` quality, hub copy on :3101.
Times are seconds after the Snap reached the service (device clock), from
temporary log lines that are not in the code.

**Before** (old frame wait), Snap from the shade:

| Case | Capture requested | Frame | PNG back in Dart | Upload done |
| --- | --- | --- | --- | --- |
| shade left open, request after the button ripple ended | 4.11 | none: timed out at 8.12 and 12.13 | – | no frame |
| same | 2.86 | none: timed out at 6.88 and 10.90 | – | no frame |
| shade left open, request during the ripple | 0.85 | 0.96 | 3.55 | 12.73 |
| shade closed after the tap | 0.31 | 0.47 | 5.21 | 11.79 |
| same | 1.16 | 1.23 | 6.54 | 11.26 |

**After**, the same cases plus a Snap with nothing moving at all (the trigger
file written over `adb run-as`, so no ripple):

| Case | Capture requested | Answered (native wait) | PNG back in Dart | Upload done |
| --- | --- | --- | --- | --- |
| shade left open | 0.65 / 0.51 / 0.26 | new frame, 251 / 95 / 24 ms | 5.08 / 4.79 / 4.71 | 13.55 / 10.69 / 9.10 |
| shade closed after the tap | 4.96 / 2.50 | new frame 286 ms / held frame 376 ms | 12.68 / 10.60 | 16.78 / 14.96 |
| nothing moving | 0.23 / 0.24 / 0.35 | held frame, 354 / 359 / 357 ms | 3.39 / 9.39 / 7.00 | 5.99 / 20.54 / 11.25 |

What this shows:

- The frame wait was the cause of the **failures**: on a still screen the old
  code never got a frame. It now answers in about 350 ms, and at once when the
  screen is changing.
- On this emulator the frame wait was **not** most of the 11 s seen when a frame
  did arrive. The PNG encode in Kotlin (2.5 to 5 s), the JPEG re-encode in Dart
  (debug JIT, 1.2 to 7 s), persisting the frame with its thumbnail (0.6 to 3 s)
  and the upload (0.65 to 1.9 s) are. The `screen_<epochMillis>.jpg` name is
  stamped after the Dart re-encode, so it includes all of that.
- The time from the trigger file to the Dart bridge picking it up ranged from
  0.2 to 4.1 s, against a 200 ms poll: the Dart isolate is starved on this
  guest. A release build on a phone is far faster on every one of these steps,
  so measure there before tuning them.

## The encode: before and after (2026-10-02, profile build)

The section above blamed the encodes, but on a debug JIT build. Before changing
anything this was re-measured on an **AOT profile build** (`flutter build apk
--profile --target-platform android-x64`: Dart is AOT-compiled like release, and
the APK is still debuggable, so `run-as` works for the trigger file). Same
emulator and the same still launcher screen, `fast` quality, five Snaps through the
trigger file, hub copy on :3140, device-clock timestamps from temporary probes
(not in the code). The encode did still matter: with AOT, the PNG encode in Kotlin
plus the JPEG re-encode in Dart were about half of a Snap.

Kotlin now produces the final picture (`FrameEncoder.kt`: crop, resample, then
`Bitmap.compress`), so a `fast` or `stream` capture never makes a full-resolution
PNG and Dart skips its decode and re-encode.

Medians (min to max in brackets), milliseconds. Before n=5, after n=9 (two
batches, one process each):

| Step | Before | After |
| --- | --- | --- |
| Kotlin encode | 1416 (1055 to 2779), PNG 1349 KB | 141 (40 to 391), JPEG 720x1600 36 KB |
| Dart decode + JPEG re-encode | 837 (556 to 1218) | 0 (skipped) |
| native call in total (frame wait ~350 ms + encode + channel) | 1789 (1415 to 3185) | 476 (168 to 896) |
| persist + thumbnail | 269 (189 to 480) | 368 (140 to 651) |
| upload to the hub | 406 (237 to 728) | 426 (156 to 616) |
| **trigger file to upload done** | **4321 (2470 to 4975)** | **1494 (507 to 4691)** |

Other presets on the same build, after: `stream` 480x1067 JPEG encoded in 37 to
180 ms (16 KB, 3 runs, two resample steps because 1080 to 480 is more than 2x),
trigger to upload 816 to 1521 ms. A region crop of the launcher's dock came back
as 720x356 in 64 ms. `inspection` still returns the native 1080x2400 PNG; its
encode is unchanged and was not timed (the guest was thrashing during those runs).

Read these with care:

- The host was shared and busy (CPU 23 to 100%), the guest load average 5 to 8
  during the runs. Persist and upload did not change (their ranges overlap), so
  their medians differ by noise. The slow "after" total (4691) includes the Dart
  bridge taking 1.5 s to notice the trigger file on a busy guest; its native call
  took 896 ms.
- The "after" Kotlin encode ranged from 40 to 391 ms. In the first batch it fell
  steadily (391, 289, 160, 40, 41 ms), as if ART's JIT were warming the new code;
  in the second it was noisier (101, 374, 103, 141 ms). Guest load and JIT warm-up
  were not separated.
- A real phone should be faster on most of these steps, but the Dart JPEG encode
  would not disappear if it were kept: package:image's encoder took 1.0 to 1.3 s
  (720 px) and 0.5 to 0.6 s (480 px) in an AOT desktop benchmark on a synthetic,
  noisy screenshot, on a busy host.
- Not measured on a real phone: none was attached. Everything above is the
  emulator.
- Output quality: on the launcher the native JPEG looks the same as the Dart one
  (text and icons equally sharp) and is about 40% smaller (37 KB against 61 KB for
  the same screen).

What is left in a `fast` Snap after this (about 1.5 s here): the 350 ms settle
window on a still screen, persisting the frame and its thumbnail (it runs before
the upload, so the hub waits for it), and the upload. Pushing to the hub while the
frame is being persisted would take the persist time off the hub's wait.

Things that bit this run:

- **A locked keyguard ends the projection.** With `isKeyguardShowing=true` the
  system logs `Content Recording: MediaProjection start disallowed, aborting
  MediaProjection` and the service dies right after `createCaptureDisplay`. A
  capture then fails as "Screen capture session is not active." Check
  `adb shell dumpsys window | grep isKeyguardShowing` before blaming the app.
- The consent dialog is a SystemUI window, so it needs a healthy SystemUI. On a
  2 GB guest the post-boot Google app sync (Play Store, GMS, Photos...) starves it:
  ANR dialogs, SystemUI restarting, a black screen. Disabling those consumer apps
  with `pm disable-user --user 0` for the run (and `pm enable` after) calmed it;
  `adb reboot` alone did not.
- The app's native consent wait is 60 s and the dialog defaults to "Share one
  app": pick "Share entire screen". Script the taps; reading screenshots in between
  blows the window.
- The dashboard layout shifts with the link-quality banner, so a fixed tap height
  keeps missing the Capture button. Find it by colour in a fresh screenshot, or
  trigger from the notification.
- `uiautomator dump` never reaches an idle state while the Flutter UI animates
  (`could not get idle state`) and then leaves a stale file behind. Use screenshots.
- Edit the app's prefs with `run-as cat`, edit on the host, then `adb push` to
  `/data/local/tmp` and `run-as cp`. Quoting a `sed` expression through `adb shell`
  from PowerShell does not survive.
