import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/blocs/screen_capture_state.dart';
import 'package:screensync_flutter_project/widgets/connect_prompt_dialog.dart';

/// "This phone is not linked right now" popped up over a working link: one ping
/// that took longer than its 2 s timeout flipped hubOnline to false while the
/// live stream to the same hub stayed connected (seen on 2026-10-02 next to a
/// green "SSE Live" chip).
void main() {
  const linked = ScreenCaptureState(hubOnline: true, liveConnected: true);

  test('a slow ping is not a dropped link while the live stream is up', () {
    expect(hubLinkUp(linked.copyWith(hubOnline: false)), isTrue);
  });

  test('the link is down only when the ping and the live stream both are', () {
    expect(hubLinkUp(linked.copyWith(hubOnline: false, liveConnected: false)),
        isFalse);
    expect(hubLinkUp(linked.copyWith(liveConnected: false)), isTrue,
        reason: 'the stream reconnecting while pings answer is not a drop');
  });

  test('a hub that rejects the token counts as down, whatever else answers',
      () {
    expect(hubLinkUp(linked.copyWith(hubAuthFailed: true)), isFalse);
  });

  test('a hub that has not answered yet is not up', () {
    expect(hubLinkUp(const ScreenCaptureState()), isFalse);
  });
}
