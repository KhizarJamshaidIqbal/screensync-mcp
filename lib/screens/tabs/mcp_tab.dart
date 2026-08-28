import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/mcp_catalog.dart';
import '../../services/settings_service.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/ref_widgets.dart';
import '../dashboard/detail_cards.dart';

/// "MCP" page: live catalog of the desktop hub's tools/skills/resources and
/// a one-tap Copy Connect Kit that lets any agent self-configure.
class McpTab extends StatefulWidget {
  const McpTab({super.key});

  @override
  State<McpTab> createState() => _McpTabState();
}

class _McpTabState extends State<McpTab> {
  Future<McpCatalog>? _catalog;
  bool _showKitPreview = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    setState(() {
      _catalog = context.read<ScreenCaptureBloc>().screenRepository
          .fetchMcpCatalog();
    });
  }

  String _kit(McpCatalog catalog) => catalog.buildConnectKit(
        hubUrl: context.read<ScreenCaptureBloc>().screenRepository.hubUrl,
        token: SettingsService.instance.pairingToken,
      );

  Future<void> _copyKit(McpCatalog catalog) async {
    await Clipboard.setData(ClipboardData(text: _kit(catalog)));
    HapticFeedback.mediumImpact();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Connect Kit copied — paste it into Claude or any '
            'MCP agent to auto-connect.'),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => _reload(),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _headerCard(),
          const SizedBox(height: 14),
          FutureBuilder<McpCatalog>(
            future: _catalog,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const GlassPanel(
                  child: Center(
                      child: Padding(
                    padding: EdgeInsets.all(24),
                    child: CircularProgressIndicator(),
                  )),
                );
              }
              if (snapshot.hasError) {
                return GlassPanel(
                  child: Column(children: [
                    Icon(Icons.cloud_off_rounded,
                        size: 40, color: dimColor(context)),
                    const SizedBox(height: 8),
                    Text('Hub unreachable — start the desktop server.',
                        style: TextStyle(color: dimColor(context))),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: _reload,
                      icon: const Icon(Icons.refresh_rounded, size: 18),
                      label: const Text('Retry'),
                    ),
                  ]),
                );
              }
              final catalog = snapshot.data!;
              return Column(children: [
                _section('Tools (${catalog.tools.length})',
                    icon: Icons.build_rounded),
                ...catalog.tools.map(_toolTile),
                const SizedBox(height: 14),
                _section('Skills / Prompts (${catalog.prompts.length})',
                    icon: Icons.auto_awesome_rounded,
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF7C3AED), Color(0xFFC13BD9)],
                    )),
                ...catalog.prompts.map(_promptTile),
                const SizedBox(height: 14),
                _section('Resources (${catalog.resources.length})',
                    icon: Icons.folder_open_rounded,
                    gradient: AppTheme.gradGreen),
                ...catalog.resources.map(_resourceTile),
                const SizedBox(height: 14),
                _usageCard(catalog),
              ]);
            },
          ),
        ],
      ),
    );
  }

  Widget _headerCard() {
    return FutureBuilder<McpCatalog>(
      future: _catalog,
      builder: (context, snapshot) {
        final catalog = snapshot.data;
        return GlassPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Expanded(
                  child: SectionHeader(
                    icon: Icons.hub_rounded,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF7C3AED), Color(0xFFC13BD9)],
                    ),
                    title: 'Connect an AI agent',
                  ),
                ),
                if (catalog != null)
                  MicroChip(
                      label: '${catalog.serverName} v${catalog.serverVersion}',
                      color: AppTheme.success),
              ]),
              const SizedBox(height: 8),
              Text(
                'Copy the Connect Kit and paste it into Claude Code, Claude '
                'Desktop or any MCP client — the agent configures and links '
                'itself to this hub, then discovers every tool & skill via '
                'get_mcp_catalog.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim),
              ),
              const SizedBox(height: 12),
              GradientActionButton(
                icon: Icons.content_copy_rounded,
                label: 'Copy Connect Kit',
                enabled: catalog != null,
                onTap: () => _copyKit(catalog!),
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: catalog == null
                    ? null
                    : () => setState(
                        () => _showKitPreview = !_showKitPreview),
                icon: Icon(
                    _showKitPreview
                        ? Icons.visibility_off_rounded
                        : Icons.visibility_rounded,
                    size: 18),
                label: Text(_showKitPreview ? 'Hide preview' : 'Preview kit'),
              ),
              if (_showKitPreview && catalog != null) ...[
                const SizedBox(height: 8),
                CodePanel(title: 'connect-kit.txt', code: _kit(catalog)),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _section(String title,
          {required IconData icon,
          LinearGradient gradient = AppTheme.gradPrimary}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: SectionHeader(icon: icon, gradient: gradient, title: title),
      );

  Widget _toolTile(McpToolInfo tool) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: GlassPanel(
          child: ExpansionTile(
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(top: 6),
            title: Text(tool.name,
                style: const TextStyle(
                    fontWeight: FontWeight.w600, fontSize: 14)),
            subtitle: Text(tool.description,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: dimColor(context))),
            children: [
              Text(tool.description,
                  style: TextStyle(fontSize: 12, color: dimColor(context))),
            ],
          ),
        ),
      );

  Widget _promptTile(McpPromptInfo prompt) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: GlassPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(prompt.name,
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, fontSize: 14)),
              const SizedBox(height: 4),
              Text(prompt.description,
                  style: TextStyle(fontSize: 12, color: dimColor(context))),
              if (prompt.arguments.isNotEmpty) ...[
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  children: prompt.arguments
                      .map((a) => MicroChip(
                          label: 'arg: $a', color: AppTheme.warning))
                      .toList(),
                ),
              ],
            ],
          ),
        ),
      );

  Widget _resourceTile(McpResourceInfo resource) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: GlassPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(resource.uri,
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, fontSize: 13)),
              const SizedBox(height: 4),
              Text(resource.description,
                  style: TextStyle(fontSize: 12, color: dimColor(context))),
            ],
          ),
        ),
      );

  Widget _usageCard(McpCatalog catalog) => GlassPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Recommended agent workflow',
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            ...catalog.usage.map((step) => Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(step,
                      style:
                          TextStyle(fontSize: 12, color: dimColor(context))),
                )),
          ],
        ),
      );
}
