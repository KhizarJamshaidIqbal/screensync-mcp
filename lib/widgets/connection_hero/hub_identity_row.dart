import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../services/connection_metrics_service.dart';

/// Hub identity strip: shows which hub we're talking to, how it was
/// discovered, and a 4-bar signal strength indicator derived from latency.
class HubIdentityRow extends StatelessWidget {
  const HubIdentityRow({
    super.key,
    required this.hubUrl,
    required this.hubOnline,
    required this.hubSource,
    required this.health,
    this.latencyMs,
  });

  final String hubUrl;
  final bool? hubOnline;
  final String hubSource;
  final LinkHealth health;
  final int? latencyMs;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _SourceBadge(source: hubSource),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            _displayHost(hubUrl),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTheme.typeCaption.copyWith(
              color: AppTheme.darkTextDim,
              fontFamily: 'monospace',
            ),
          ),
        ),
        const SizedBox(width: 6),
        _SignalBars(health: health, online: hubOnline == true),
      ],
    );
  }

  /// Strip scheme + port and trim the IP/hostname for a compact display.
  /// Example: "http://192.168.1.5:3000" → "192.168.1.5:3000".
  static String _displayHost(String url) {
    if (url.isEmpty) return 'No hub configured';
    try {
      final u = Uri.parse(url);
      final host = u.host.isEmpty ? url : u.host;
      final port = u.hasPort ? ':${u.port}' : '';
      return '$host$port';
    } catch (_) {
      return url;
    }
  }
}

class _SourceBadge extends StatelessWidget {
  const _SourceBadge({required this.source});
  final String source;

  @override
  Widget build(BuildContext context) {
    final (label, color, icon) = switch (source) {
      'manual' => ('Manual', AppTheme.primary, Icons.edit_rounded),
      'mdns' => ('mDNS', AppTheme.success, Icons.cast_rounded),
      'default' => ('Default', AppTheme.darkTextDim, Icons.help_outline_rounded),
      _ => ('Auto', AppTheme.success, Icons.auto_awesome_rounded),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: color),
          const SizedBox(width: 3),
          Text(
            label,
            style: AppTheme.microLabel.copyWith(color: color, fontSize: 8.5),
          ),
        ],
      ),
    );
  }
}

class _SignalBars extends StatelessWidget {
  const _SignalBars({required this.health, required this.online});
  final LinkHealth health;
  final bool online;

  @override
  Widget build(BuildContext context) {
    if (!online) {
      return const _BarRow(activeUpTo: 0, color: AppTheme.danger, height: 14);
    }
    final active = switch (health) {
      LinkHealth.excellent => 4,
      LinkHealth.good => 3,
      LinkHealth.slow => 2,
      LinkHealth.poor => 1,
      LinkHealth.offline => 0,
    };
    final color = switch (health) {
      LinkHealth.excellent => AppTheme.success,
      LinkHealth.good => AppTheme.primary,
      LinkHealth.slow => AppTheme.warning,
      LinkHealth.poor => AppTheme.danger,
      LinkHealth.offline => AppTheme.danger,
    };
    return _BarRow(activeUpTo: active, color: color, height: 14);
  }
}

class _BarRow extends StatelessWidget {
  const _BarRow({
    required this.activeUpTo,
    required this.color,
    required this.height,
  });
  final int activeUpTo; // 0..4
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: List.generate(4, (i) {
        final h = height * (0.4 + 0.2 * i);
        final lit = i < activeUpTo;
        return Padding(
          padding: const EdgeInsets.only(left: 1.5),
          child: Container(
            width: 3,
            height: h,
            decoration: BoxDecoration(
              color: lit
                  ? color
                  : color.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(1.5),
            ),
          ),
        );
      }),
    );
  }
}
