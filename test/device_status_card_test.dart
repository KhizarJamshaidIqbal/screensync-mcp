import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/core/app_theme.dart';
import 'package:screensync_flutter_project/screens/dashboard/detail_cards.dart';

/// The Hub device status card showed a red "Connected: No" for a phone that was
/// paired and simply idle, next to the header's "Live", because the hub's
/// `connected` only means "a frame arrived in the last 60 s".
void main() {
  // Exactly what hub 1.14.5 answered for the paired emulator on 2026-10-02.
  const idle = <String, dynamic>{
    'connected': false,
    'hasFrames': true,
    'phoneOnline': true,
    'state': 'linked_no_frames',
    'transport': 'local-http',
    'lastFrameAt': '2026-10-01T18:57:29.431Z',
    'lastFrameAgeMs': 3117912,
    'stale': true,
    'deviceModel': 'sdk_gphone64_x86_64',
    'retainedFrames': 1,
  };

  test('a paired phone that is not capturing is linked and idle, not a failure',
      () {
    final link = phoneLinkStatus(idle);
    expect(link.label, 'Linked, idle');
    expect(link.color, isNot(AppTheme.danger));
  });

  test('streaming and no phone map to their own states', () {
    expect(phoneLinkStatus({'state': 'streaming', 'connected': true}).label,
        'Streaming');
    final none = phoneLinkStatus({'state': 'no_phone', 'connected': false});
    expect(none.label, 'Not linked');
    expect(none.color, AppTheme.danger);
  });

  // On a hub without `state`, connected:true only meant "some frame file
  // exists", even one from last month: never call that a live stream.
  test('a hub without state reports frames on the hub, never "Streaming"', () {
    final old = phoneLinkStatus({
      'connected': true,
      'lastFrameAt': '2026-09-15T17:16:41.134Z',
    });
    expect(old.label, 'Frames on hub');
    expect(old.color, isNot(AppTheme.success));
    expect(phoneLinkStatus({'connected': false}).label, 'No frames');
  });

  test('the last frame reads as an age, not a clipped timestamp', () {
    expect(lastFrameText(idle), '51m ago');
    expect(lastFrameText({'lastFrameAgeMs': 4000}), 'just now');
    expect(lastFrameText({'lastFrameAgeMs': 42000}), '42s ago');
    expect(lastFrameText({'lastFrameAgeMs': 3 * 3600 * 1000}), '3h ago');
    expect(lastFrameText({'lastFrameAgeMs': 50 * 3600 * 1000}), '2d ago');
  });

  test(
      'an older hub without the age keeps the raw timestamp; no frame stays empty',
      () {
    expect(lastFrameText({'lastFrameAt': '2026-10-01T18:57:29.431Z'}),
        '2026-10-01T18:57:29.431Z');
    expect(lastFrameText({'lastFrameAt': null}), isNull);
  });
}
