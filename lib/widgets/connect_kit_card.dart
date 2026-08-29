import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../blocs/screen_capture_bloc.dart';
import '../core/app_theme.dart';
import '../models/mcp_catalog.dart';
import '../services/settings_service.dart';
import '../widgets/common_widgets.dart';
import '../widgets/ref_widgets.dart';
import '../screens/dashboard/detail_cards.dart';

/// Dismissible "Connect an AI agent" card on the Dashboard. Copies the full
/// MCP server + skills kit so the user can paste it into Claude / ChatGPT /
/// any agent and have it auto-integrate. Dismissing persists forever.
class ConnectKitCard extends StatelessWidget {
  const ConnectKitCard({super.key});

  @override
  Widget build(BuildContext context) {
    if (SettingsService.instance.connectKitDismissed) {
      return const SizedBox.shrink();
    }
    final bloc = context.read<ScreenCaptureBloc>();
    final hubUrl = bloc.screenRepository.hubUrl;
    final token = SettingsService.instance.pairingToken;

    return DashedBorder(
      color: AppTheme.primary.withValues(alpha: 0.5),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: SectionHeader(
                    icon: Icons.auto_awesome_rounded,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF7C3AED), Color(0xFFC13BD9)],
                    ),
                    title: 'Connect an AI agent',
                  ),
                ),
                IconButton(
                  tooltip: 'Don\'t show again',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.close_rounded,
                      size: 18, color: AppTheme.darkTextDim),
                  onPressed: () =>
                      SettingsService.instance.connectKitDismissed = true,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Copy this MCP server + skills and paste into Claude, ChatGPT or '
              'any agent — it configures and links itself to ScreenSync '
              'automatically.',
              style: AppTheme.typeBodyMedium
                  .copyWith(color: AppTheme.darkTextDim),
            ),
            const SizedBox(height: 12),
            GradientActionButton(
              icon: Icons.content_copy_rounded,
              label: 'Copy Connect Kit',
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF7C3AED), Color(0xFFC13BD9)],
              ),
              onTap: () async {
                await Clipboard.setData(ClipboardData(
                    text: buildConnectKitText(
                        hubUrl: hubUrl, token: token)));
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text(
                      'Connect Kit copied — paste it into your agent.'),
                ));
              },
            ),
          ],
        ),
      ),
    ).animate().fadeIn(duration: 300.ms).slideY(begin: -0.04, end: 0);
  }
}
