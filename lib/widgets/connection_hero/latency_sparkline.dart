import 'package:flutter/material.dart';

import '../../core/app_theme.dart';

/// LatencySparkline — a 1-D line chart of the last N latency samples
/// (defaults to 60). Each sample is color-graded by its own value, not the
/// average, so a single 800ms spike on an otherwise green line shows up
/// as an amber dot. The line itself uses a single representative color
/// (the latest sample's color) for visual cohesion.
///
/// Self-contained: takes a `List<int>` of samples and renders. The BLoC
/// pushes a new list every 5s; we use `shouldRepaint` to skip work when
/// the list is identical.
class LatencySparkline extends StatelessWidget {
  const LatencySparkline({
    super.key,
    required this.samples,
    this.height = 36,
    this.p50,
    this.p95,
  });

  final List<int> samples;
  final double height;

  /// Optional percentile marker lines (from metrics). Null → not drawn.
  final int? p50;
  final int? p95;

  @override
  Widget build(BuildContext context) {
    if (samples.isEmpty) {
      return _EmptyState(height: height);
    }
    final latest = samples.last;
    final color = _colorForMs(latest);
    return SizedBox(
      height: height,
      child: LayoutBuilder(
        builder: (context, constraints) {
          return Stack(
            children: [
              // Faint background track.
              Positioned.fill(
                child: CustomPaint(
                  painter: _TrackPainter(
                    color: AppTheme.darkTextDim.withValues(alpha: 0.18),
                  ),
                ),
              ),
              // The line.
              Positioned.fill(
                child: CustomPaint(
                  painter: _SparklinePainter(
                    samples: samples,
                    lineColor: color,
                    pointColor: color,
                    p50: p50,
                    p95: p95,
                  ),
                ),
              ),
              // Latest value tag, top-right.
              Positioned(
                right: 4,
                top: 2,
                child: Text(
                  _summaryLabel(samples),
                  style: AppTheme.microLabel.copyWith(
                    color: AppTheme.darkTextDim,
                    fontSize: 8.5,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  String _summaryLabel(List<int> s) {
    final avg = s.fold<int>(0, (a, b) => a + b) ~/ s.length;
    final peak = s.reduce((a, b) => a > b ? a : b);
    return 'avg ${avg}ms · peak ${peak}ms';
  }

  static Color _colorForMs(int ms) {
    if (ms < 100) return AppTheme.success;
    if (ms < 300) return AppTheme.primary;
    if (ms < 800) return AppTheme.warning;
    return AppTheme.danger;
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.height});
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: Center(
        child: Text(
          'Awaiting first ping…',
          style: AppTheme.microLabel.copyWith(color: AppTheme.darkTextDim),
        ),
      ),
    );
  }
}

class _TrackPainter extends CustomPainter {
  _TrackPainter({required this.color});
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height / 2;
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1;
    canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
  }

  @override
  bool shouldRepaint(covariant _TrackPainter old) => old.color != color;
}

class _SparklinePainter extends CustomPainter {
  _SparklinePainter({
    required this.samples,
    required this.lineColor,
    required this.pointColor,
    this.p50,
    this.p95,
  });

  final List<int> samples;
  final Color lineColor;
  final Color pointColor;
  final int? p50;
  final int? p95;

  @override
  void paint(Canvas canvas, Size size) {
    if (samples.isEmpty) return;
    // Normalise to a 0..1 vertical band; clamp to a reasonable max so a
    // single 5000ms spike doesn't squash the rest of the chart.
    const maxY = 1500.0;
    const padX = 2.0, padY = 4.0;
    final usableW = size.width - padX * 2;
    final usableH = size.height - padY * 2;

    final pts = <Offset>[];
    for (var i = 0; i < samples.length; i++) {
      final t = samples.length == 1 ? 0.5 : i / (samples.length - 1);
      final v = (samples[i].clamp(0, maxY.toInt())) / maxY;
      final x = padX + t * usableW;
      final y = padY + (1 - v) * usableH;
      pts.add(Offset(x, y));
    }

    // Filled area underneath for depth.
    final fillPath = Path()..moveTo(pts.first.dx, size.height - padY);
    for (final p in pts) {
      fillPath.lineTo(p.dx, p.dy);
    }
    fillPath
      ..lineTo(pts.last.dx, size.height - padY)
      ..close();
    canvas.drawPath(
      fillPath,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            lineColor.withValues(alpha: 0.30),
            lineColor.withValues(alpha: 0.0),
          ],
        ).createShader(Rect.fromLTWH(0, 0, size.width, size.height)),
    );

    // Horizontal percentile marker lines (p50 / p95).
    void marker(int? ms, Color c, double dashOn) {
      if (ms == null) return;
      final v = (ms.clamp(0, maxY.toInt())) / maxY;
      final my = padY + (1 - v) * usableH;
      final p = Paint()
        ..color = c.withValues(alpha: 0.45)
        ..strokeWidth = 0.8;
      var mx = padX;
      while (mx < size.width - padX) {
        final e = (mx + dashOn).clamp(0.0, size.width - padX);
        canvas.drawLine(Offset(mx, my), Offset(e, my), p);
        mx = e + 4;
      }
    }

    marker(p50, AppTheme.primary, 3);
    marker(p95, AppTheme.warning, 2);

    // Line.
    final linePaint = Paint()
      ..color = lineColor
      ..strokeWidth = 1.6
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final linePath = Path()..moveTo(pts.first.dx, pts.first.dy);
    for (var i = 1; i < pts.length; i++) {
      linePath.lineTo(pts[i].dx, pts[i].dy);
    }
    canvas.drawPath(linePath, linePaint);

    // Latest sample highlight.
    final last = pts.last;
    canvas.drawCircle(
      last,
      3.4,
      Paint()..color = pointColor,
    );
    canvas.drawCircle(
      last,
      6,
      Paint()..color = pointColor.withValues(alpha: 0.25),
    );
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter old) =>
      old.samples != samples ||
      old.lineColor != lineColor ||
      old.pointColor != pointColor ||
      old.p50 != p50 ||
      old.p95 != p95;
}
