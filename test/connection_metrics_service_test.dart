import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/services/connection_metrics_service.dart';

void main() {
  group('latency ring buffer', () {
    test('caps at the configured window', () {
      final s = ConnectionMetricsService(latencyWindow: 5);
      for (var i = 0; i < 12; i++) {
        s.recordLatency(50 + i);
      }
      final hist = s.latencyHistory;
      expect(hist.length, 5);
      // Oldest entries are evicted — the 5 newest (57..61) remain.
      expect(hist.first, 57);
      expect(hist.last, 61);
    });

    test('ignores non-positive values', () {
      final s = ConnectionMetricsService();
      s.recordLatency(0);
      s.recordLatency(-5);
      expect(s.latencyHistory, isEmpty);
      s.recordLatency(120);
      expect(s.latencyHistory, [120]);
    });

    test('clearLatency empties the buffer', () {
      final s = ConnectionMetricsService();
      s.recordLatency(100);
      s.recordLatency(200);
      s.clearLatency();
      expect(s.latencyHistory, isEmpty);
    });

    test('average and peak handle empty buffers', () {
      final s = ConnectionMetricsService();
      expect(s.averageLatency, isNull);
      expect(s.peakLatency, isNull);
    });

    test('average and peak compute over samples', () {
      final s = ConnectionMetricsService();
      for (final v in [80, 120, 200, 60, 90]) {
        s.recordLatency(v);
      }
      expect(s.averageLatency, 110);
      expect(s.peakLatency, 200);
    });
  });

  group('health classification', () {
    final s = ConnectionMetricsService();
    test('offline when hub is not online', () {
      expect(s.classifyHealth(online: false, latestMs: 50),
          LinkHealth.offline);
    });
    test('excellent under 100ms', () {
      expect(s.classifyHealth(online: true, latestMs: 50),
          LinkHealth.excellent);
    });
    test('good 100–300ms', () {
      expect(s.classifyHealth(online: true, latestMs: 200), LinkHealth.good);
    });
    test('slow 300–800ms', () {
      expect(s.classifyHealth(online: true, latestMs: 500), LinkHealth.slow);
    });
    test('poor >=800ms', () {
      expect(s.classifyHealth(online: true, latestMs: 1200),
          LinkHealth.poor);
    });
    test('online with no sample yet defaults to good', () {
      expect(s.classifyHealth(online: true, latestMs: null),
          LinkHealth.good);
    });
  });

  group('activity feed', () {
    test('caps at the configured window', () {
      final s = ConnectionMetricsService(activityWindow: 4);
      for (var i = 0; i < 10; i++) {
        s.recordActivity(ActivityEvent(
          kind: 'inspection',
          label: 'event $i',
          timestamp: DateTime.fromMillisecondsSinceEpoch(1000 + i),
        ));
      }
      final feed = s.activityFeed;
      expect(feed.length, 4);
      // Newest is the last appended.
      expect(feed.last.label, 'event 9');
    });

    test('clearActivity empties the feed', () {
      final s = ConnectionMetricsService();
      s.recordActivity(ActivityEvent(
        kind: 'frame',
        label: 'x',
        timestamp: DateTime.now(),
      ));
      s.clearActivity();
      expect(s.activityFeed, isEmpty);
    });
  });

  group('session stats', () {
    test('counters start at zero', () {
      expect(const SessionStats().capturesToday, 0);
      expect(const SessionStats().pushedHub, 0);
      expect(const SessionStats().pushedDrive, 0);
      expect(const SessionStats().unsynced, 0);
      expect(const SessionStats().lastAIResponse, isNull);
    });

    test('counters increment monotonically', () {
      final s = ConnectionMetricsService();
      s.incrementCaptures();
      s.incrementCaptures();
      s.incrementHubPush();
      s.incrementDrivePush();
      s.incrementDrivePush();
      s.incrementDrivePush();
      expect(s.sessionStats.capturesToday, 2);
      expect(s.sessionStats.pushedHub, 1);
      expect(s.sessionStats.pushedDrive, 3);
    });

    test('setUnsynced is a no-op when value is unchanged', () {
      final s = ConnectionMetricsService();
      s.setUnsynced(0);
      s.setUnsynced(0);
      expect(s.sessionStats.unsynced, 0);
    });

    test('setUnsynced updates value when changed', () {
      final s = ConnectionMetricsService();
      s.setUnsynced(5);
      expect(s.sessionStats.unsynced, 5);
    });

    test('recordAIResponse uses injected clock', () {
      var now = DateTime(2026, 8, 28, 10, 0);
      final s = ConnectionMetricsService(clock: () => now);
      s.recordAIResponse();
      expect(s.sessionStats.lastAIResponse, DateTime(2026, 8, 28, 10, 0));
      now = DateTime(2026, 8, 28, 10, 5);
      s.recordAIResponse();
      expect(s.sessionStats.lastAIResponse, DateTime(2026, 8, 28, 10, 5));
    });

    test('reset clears all three buffers', () {
      final s = ConnectionMetricsService();
      s.recordLatency(50);
      s.recordActivity(ActivityEvent(
        kind: 'x',
        label: 'y',
        timestamp: DateTime.now(),
      ));
      s.incrementCaptures();
      s.reset();
      expect(s.latencyHistory, isEmpty);
      expect(s.activityFeed, isEmpty);
      expect(s.sessionStats.capturesToday, 0);
    });
  });

  group('copyWith immutability', () {
    test('SessionStats.copyWith does not mutate the original', () {
      const a = SessionStats(capturesToday: 5);
      final b = a.copyWith(capturesToday: 9);
      expect(a.capturesToday, 5);
      expect(b.capturesToday, 9);
    });

    test('SessionStats.copyWith can set lastAIResponse back to null', () {
      final a = SessionStats(lastAIResponse: DateTime(2026, 1, 1));
      final b = a.copyWith();
      expect(b.lastAIResponse, a.lastAIResponse);
      final c = a.copyWith(lastAIResponse: null);
      expect(c.lastAIResponse, isNull);
    });
  });
}
