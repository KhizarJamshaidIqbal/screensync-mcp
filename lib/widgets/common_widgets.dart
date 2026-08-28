import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../blocs/screen_capture_bloc.dart';

import '../core/app_theme.dart';
import '../services/settings_service.dart';

Color dimColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
        ? const Color(0xFF94A3B8)
        : const Color(0xFF5B6B8C);

class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.label,
    required this.value,
    required this.color,
    this.icon,
  });

  final String label;
  final String value;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      borderRadius: AppTheme.radiusM,
      borderColor: color.withValues(alpha: 0.25),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Container(
                  width: 26,
                  height: 26,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        color.withValues(alpha: 0.25),
                        color.withValues(alpha: 0.08),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, size: 15, color: color),
                ),
                const SizedBox(width: 7),
              ],
              Expanded(
                child: Text(label,
                    style:
                        TextStyle(fontSize: 11, color: dimColor(context))),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Text(value,
              style: TextStyle(
                  fontWeight: FontWeight.w800, fontSize: 16, color: color)),
        ],
      ),
    ).animate().fadeIn(duration: 240.ms).slideY(begin: 0.05, end: 0);
  }
}

class DetailRow extends StatelessWidget {
  const DetailRow({super.key, required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 150),
            child: Text(label, style: TextStyle(color: dimColor(context))),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(value,
                textAlign: TextAlign.right,
                style: const TextStyle(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

class BadgeChip extends StatelessWidget {
  const BadgeChip({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style:
            TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.bold),
      ),
    );
  }
}

class CodePanel extends StatelessWidget {
  const CodePanel({super.key, required this.title, required this.code});

  final String title;
  final String code;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF171030),
        borderRadius: BorderRadius.circular(AppTheme.radiusM + 4),
        border: Border.all(
            color: AppTheme.primary.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title.toUpperCase(),
              style: AppTheme.microLabel.copyWith(color: AppTheme.success)),
          const SizedBox(height: 8),
          SelectableText(
            code,
            style: const TextStyle(
              fontSize: 11,
              fontFamily: 'monospace',
              color: Color(0xFFD9D3EE),
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class ThemeQuickToggle extends StatelessWidget {
  const ThemeQuickToggle({super.key});

  @override
  Widget build(BuildContext context) {
    final settings = SettingsService.instance;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return IconButton(
      tooltip: 'Toggle theme',
      icon: Icon(isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded,
          size: 20),
      onPressed: () {
        settings.themeMode = isDark ? ThemeMode.light : ThemeMode.dark;
      },
    );
  }
}

class LoopbackWarningBanner extends StatelessWidget {
  const LoopbackWarningBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.radiusL),
        border: Border.all(color: AppTheme.warning.withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppTheme.warning.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.warning_amber_rounded,
                color: AppTheme.warning, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Hub not reachable',
                  style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                      color: AppTheme.warning),
                ),
                const SizedBox(height: 4),
                Text(
                  '127.0.0.1 only works on the emulator. '
                  'On a real device, go to Settings → Hub and enter your '
                  "PC's LAN IP address (e.g. http://192.168.1.x:3000), "
                  'or tap mDNS scan to auto-discover the desktop hub.',
                  style: AppTheme.typeBodyMedium.copyWith(
                      color: AppTheme.darkTextDim, height: 1.5),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    InkWell(
                      borderRadius: BorderRadius.circular(999),
                      onTap: () => context
                          .read<ScreenCaptureBloc>()
                          .add(AutoConnectHubEvent()),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [
                              Color(0xFFD97706),
                              Color(0xFFFBBF24)
                            ],
                          ),
                          borderRadius: BorderRadius.circular(999),
                          boxShadow: [
                            BoxShadow(
                              color: AppTheme.warning
                                  .withValues(alpha: 0.4),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.link_rounded,
                                size: 14, color: Colors.black),
                            SizedBox(width: 6),
                            Text('Connect now',
                                style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: Colors.black)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                                'Open the Settings tab -> Hub connection to set your PC LAN IP.'),
                            duration: Duration(seconds: 5),
                          ),
                        );
                      },
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.warning,
                        side: const BorderSide(color: AppTheme.warning),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                      ),
                      icon: const Icon(Icons.settings_ethernet_rounded,
                          size: 16),
                      label: const Text('How to fix',
                          style: TextStyle(fontSize: 12)),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    ).animate().fadeIn(duration: 300.ms).slideY(begin: -0.05, end: 0);
  }
}

/// Reusable dashed rounded-rectangle border for modern accent cards.
class DashedBorder extends StatelessWidget {
  const DashedBorder({
    super.key,
    required this.child,
    required this.color,
    this.radius,
  });
  final Widget child;
  final Color color;
  final double? radius;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: DashedPainter(
        color: color,
        radius: radius ?? AppTheme.radiusL,
      ),
      child: child,
    );
  }
}

class DashedPainter extends CustomPainter {
  DashedPainter({required this.color, required this.radius});
  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.6
      ..style = PaintingStyle.stroke;
    const dash = 6.0, gap = 4.0;
    final path = Path()
      ..addRRect(RRect.fromRectAndRadius(
          Offset.zero & size, Radius.circular(radius)));
    for (final metric in path.computeMetrics()) {
      double start = 0;
      while (start < metric.length) {
        final end = (start + dash).clamp(0.0, metric.length);
        canvas.drawPath(metric.extractPath(start, end), paint);
        start = end + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant DashedPainter old) => old.color != color;
}
