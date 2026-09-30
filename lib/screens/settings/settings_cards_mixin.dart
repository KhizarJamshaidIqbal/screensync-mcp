import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../models/custom_preset.dart';
import '../../models/region_favorite.dart';
import '../../services/settings_service.dart';
import '../dashboard/detail_cards.dart';
import '../privacy_policy_screen.dart';

/// The privacy, capture-preset and region-favourite cards of the Settings tab.
///
/// Split out of `settings_tab.dart` (500-line rule) with no behaviour change; the
/// cards read and write [SettingsService] and rebuild through the host state's
/// `setState`, which is why this is a mixin on [State] and not a widget.
mixin SettingsCardsMixin<T extends StatefulWidget> on State<T> {
  // ── C2: privacy redaction toggle ──
  Widget privacyCard(SettingsService settings) {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            icon: Icons.privacy_tip_rounded,
            gradient: AppTheme.gradPrimary,
            title: 'Privacy redaction',
          ),
          SwitchListTile(
            activeThumbColor: AppTheme.primary,
            contentPadding: EdgeInsets.zero,
            title: const Text('Redact before sending',
                style:
                    TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            subtitle: Text(
                'Pixelate every captured frame on-device before it is stored '
                'or uploaded to the hub / Drive.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim)),
            value: settings.redactionEnabled,
            onChanged: (v) => setState(() => settings.redactionEnabled = v),
          ),
          TextButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => const PrivacyPolicyScreen(readOnly: true),
              ),
            ),
            icon: const Icon(Icons.menu_book_rounded, size: 16),
            label: const Text('Read the Privacy Policy'),
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              minimumSize: const Size(0, 32),
              textStyle:
                  const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  // ── C1: custom capture presets manager ──
  Widget presetsCard(SettingsService settings) {
    final presets = CustomPreset.decodeList(settings.customPresetsRaw);
    final activeId = settings.activeCustomPresetId;
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: SectionHeader(
                  icon: Icons.tune_rounded,
                  gradient: AppTheme.gradPrimary,
                  title: 'Capture presets',
                ),
              ),
              IconButton(
                tooltip: 'Add preset',
                icon: const Icon(Icons.add_rounded),
                onPressed: () => addPresetDialog(settings, presets),
              ),
            ],
          ),
          const SizedBox(height: 4),
          if (presets.isEmpty)
            Text('No custom presets yet. Tap + to add one.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim))
          else
            RadioGroup<String>(
              groupValue: activeId,
              onChanged: (v) =>
                  setState(() => settings.activeCustomPresetId = v ?? ''),
              child: Column(
                children: [
                  for (final p in presets)
                    RadioListTile<String>(
                      activeColor: AppTheme.primary,
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      value: p.id,
                      title: Row(
                        children: [
                          Expanded(
                            child: Text(p.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 13, fontWeight: FontWeight.w600)),
                          ),
                          IconButton(
                            tooltip: 'Delete preset',
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.delete_outline_rounded,
                                size: 18),
                            onPressed: () {
                              final next =
                                  presets.where((e) => e.id != p.id).toList();
                              setState(() {
                                settings.customPresetsRaw =
                                    CustomPreset.encodeList(next);
                                if (activeId == p.id) {
                                  settings.activeCustomPresetId = '';
                                }
                              });
                            },
                          ),
                        ],
                      ),
                      subtitle: Text(p.summary,
                          style: AppTheme.typeCaption
                              .copyWith(color: AppTheme.darkTextDim)),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Future<void> addPresetDialog(
      SettingsService settings, List<CustomPreset> presets) async {
    final nameCtrl = TextEditingController();
    var width = 720;
    var jpeg = true;
    final result = await showDialog<CustomPreset>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('New preset'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(
                      labelText: 'Name', hintText: 'e.g. Docs scan'),
                ),
                const SizedBox(height: 12),
                const Text('Resolution (long edge)',
                    style: TextStyle(fontSize: 12)),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final w in const [0, 480, 720, 1080])
                      ChoiceChip(
                        label: Text(w == 0 ? 'Native' : '${w}px'),
                        selected: width == w,
                        onSelected: (_) => setLocal(() => width = w),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                const Text('Format', style: TextStyle(fontSize: 12)),
                Wrap(
                  spacing: 8,
                  children: [
                    ChoiceChip(
                      label: const Text('JPEG'),
                      selected: jpeg,
                      onSelected: (_) => setLocal(() => jpeg = true),
                    ),
                    ChoiceChip(
                      label: const Text('PNG'),
                      selected: !jpeg,
                      onSelected: (_) => setLocal(() => jpeg = false),
                    ),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel')),
            FilledButton(
              onPressed: () {
                final name = nameCtrl.text.trim();
                if (name.isEmpty) return;
                Navigator.pop(
                  ctx,
                  CustomPreset(
                    id: DateTime.now().microsecondsSinceEpoch.toString(),
                    name: name,
                    maxWidth: width,
                    jpeg: jpeg,
                    jpegQuality: 74,
                  ),
                );
              },
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );
    if (result == null) return;
    final next = [...presets, result];
    setState(() {
      settings.customPresetsRaw = CustomPreset.encodeList(next);
      settings.activeCustomPresetId = result.id;
    });
  }

  // ── C3: region favorites list ──
  Widget regionFavoritesCard(SettingsService settings) {
    final favs = RegionFavorite.decodeList(settings.regionFavoritesRaw);
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            icon: Icons.crop_rounded,
            gradient: AppTheme.gradGreen,
            title: 'Region favorites',
          ),
          const SizedBox(height: 4),
          if (favs.isEmpty)
            Text(
                'No saved regions yet. Save a crop from the region editor to '
                'reuse it here.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim))
          else
            for (final f in favs)
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: const Icon(Icons.crop_free_rounded,
                    color: AppTheme.primary),
                title: Text(f.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w600)),
                subtitle: Text(f.summary,
                    style: AppTheme.typeCaption
                        .copyWith(color: AppTheme.darkTextDim)),
                trailing: IconButton(
                  tooltip: 'Delete region',
                  icon: const Icon(Icons.delete_outline_rounded, size: 18),
                  onPressed: () {
                    final next =
                        favs.where((e) => e.name != f.name).toList();
                    setState(() => settings.regionFavoritesRaw =
                        RegionFavorite.encodeList(next));
                  },
                ),
              ),
        ],
      ),
    );
  }
}
