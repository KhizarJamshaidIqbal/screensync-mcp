import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_theme.dart';
import '../services/settings_service.dart';
import '../widgets/ref_widgets.dart';
import 'tabs/diagnose_tab.dart';
import 'tabs/gallery_tab.dart';
import 'tabs/mcp_tab.dart';
import 'tabs/settings_tab.dart';
import 'tabs/telemetry_tab.dart';

/// Hub navigation: glossy gradient tiles for each secondary screen.
class HubScreen extends StatelessWidget {
  const HubScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final simple = SettingsService.instance.simpleMode;
    final items = <_HubItem>[
      _HubItem(
        icon: Icons.photo_library_rounded,
        title: 'Gallery',
        subtitle: 'Local capture history',
        gradient: AppTheme.gradPrimary,
        builder: (_) => const GalleryTab(),
      ),
      if (!simple)
        _HubItem(
          icon: Icons.bug_report_rounded,
          title: 'Diagnose',
          subtitle: 'Bug heatmap + patches',
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFFD97706), Color(0xFFFBBF24)],
          ),
          builder: (_) => const DiagnoseTab(),
        ),
      if (!simple)
        _HubItem(
          icon: Icons.hub_rounded,
          title: 'MCP',
          subtitle: 'Connect an AI agent',
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF7C3AED), Color(0xFFC13BD9)],
          ),
          builder: (_) => const McpTab(),
        ),
      if (!simple)
        _HubItem(
          icon: Icons.monitor_heart_rounded,
          title: 'Telemetry',
          subtitle: 'Performance + sync log',
          gradient: AppTheme.gradGreen,
          builder: (_) => const TelemetryTab(),
        ),
      _HubItem(
        icon: Icons.tune_rounded,
        title: 'Settings',
        subtitle: 'Hub, theme, permissions',
        gradient: AppTheme.gradOrb,
        builder: (_) => const SettingsTab(),
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('ScreenSync Hub')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        children: [
          const WatchHeading()
              .animate()
              .fadeIn(duration: 400.ms)
              .slideY(begin: 0.05, end: 0, duration: 400.ms),
          const SizedBox(height: 18),
          for (var i = 0; i < items.length; i++) ...[
            _HubTile(item: items[i])
                .animate(delay: (80 + i * 60).ms)
                .fadeIn(duration: 380.ms)
                .slideY(
                    begin: 0.05,
                    end: 0,
                    duration: 380.ms,
                    curve: Curves.easeOutCubic),
            const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

class _HubItem {
  const _HubItem({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.gradient,
    required this.builder,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final LinearGradient gradient;
  final WidgetBuilder builder;
}

class _HubTile extends StatelessWidget {
  const _HubTile({required this.item});
  final _HubItem item;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xFFF2EEFB)
        : const Color(0xFF221A38);
    return InkWell(
      borderRadius: BorderRadius.circular(AppTheme.radiusL),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (ctx) => TabHostScreen(
            title: item.title,
            child: Builder(builder: item.builder),
          ),
        ),
      ),
      child: GlassPanel(
        child: Row(
          children: [
            GlossyTile(
                icon: item.icon, gradient: item.gradient, size: 48, iconSize: 22),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.title,
                      style: AppTheme.typeTitleLarge.copyWith(color: text)),
                  const SizedBox(height: 2),
                  Text(item.subtitle,
                      style: AppTheme.typeBodyMedium
                          .copyWith(color: AppTheme.darkTextDim)),
                ],
              ),
            ),
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: item.gradient.colors.last.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.arrow_forward_rounded,
                  size: 15, color: item.gradient.colors.last),
            ),
          ],
        ),
      ),
    );
  }
}

/// Hosts a pushed secondary screen with a back (cross) button.
class TabHostScreen extends StatelessWidget {
  const TabHostScreen({super.key, required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        leading: IconButton(
          tooltip: 'Back',
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: child,
    );
  }
}
