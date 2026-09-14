import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/widgets/scan_viewfinder.dart';

/// Golden for the scanner's viewfinder.
///
/// The widget is pure geometry - no text - so the golden is a faithful picture of what the
/// screen draws, unlike a golden of a text-heavy screen where the test font renders blocks.
/// Two frames are captured: mid-sweep while reading, and the success state.
void main() {
  testWidgets('viewfinder renders while reading', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          backgroundColor: Color(0xFF0E1116),
          body: Center(child: ScanViewfinder(size: 240)),
        ),
      ),
    );
    // Advance into the sweep so the scan line is visible rather than at either extreme.
    await tester.pump(const Duration(milliseconds: 1150));
    await expectLater(
      find.byType(ScanViewfinder),
      matchesGoldenFile('goldens/scan_viewfinder.png'),
    );
  });

  testWidgets('viewfinder renders in the success state', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          backgroundColor: Color(0xFF0E1116),
          body: Center(child: ScanViewfinder(size: 240, reading: false, found: true)),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 300));
    await expectLater(
      find.byType(ScanViewfinder),
      matchesGoldenFile('goldens/scan_viewfinder_found.png'),
    );
  });
}