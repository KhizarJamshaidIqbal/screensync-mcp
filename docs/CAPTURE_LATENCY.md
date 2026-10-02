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
   as PNG (`Image.toPng()` in `LatestFrame.kt`).
5. `CapturePipeline.process()` re-encodes to the chosen quality (JPEG for `fast`
   and `stream`), the frame is persisted with a thumbnail, then
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
stays held, with its PNG, so a repeat capture of a still screen costs no wait
for a frame and no encode. With the screen off nothing is drawn, so the held
frame is not used, and it is dropped when the screen goes off (the lock screen
may be what comes back). With nothing held at all (no frame since the session
started), the old timeout path applies.

Every capture logs one line (logcat tag `ScreenSync`):

```
capture answered after 18 ms with a new frame
capture answered after 352 ms with the held frame, drawn 5230 ms before
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
