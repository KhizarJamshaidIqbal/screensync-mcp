import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/models/custom_preset.dart';
import 'package:screensync_flutter_project/models/region_favorite.dart';
import 'package:screensync_flutter_project/screens/settings/settings_cards_mixin.dart';
import 'package:screensync_flutter_project/screens/settings/settings_rows.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

/// The privacy / presets / region-favourites cards were moved out of
/// settings_tab.dart into [SettingsCardsMixin] (500-line rule). They talk to the
/// host State through setState, so this pins that the split kept them working:
/// they render, they write through SettingsService, and they rebuild.
class _Host extends StatefulWidget {
  const _Host();

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> with SettingsCardsMixin<_Host> {
  @override
  Widget build(BuildContext context) {
    final settings = SettingsService.instance;
    return ListView(
      children: [
        privacyCard(settings),
        presetsCard(settings),
        regionFavoritesCard(settings),
        const DriveRow(label: 'App folder', value: '/ScreenSync_MCP/'),
      ],
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpHost(WidgetTester tester, Map<String, Object> stored) async {
    SharedPreferences.setMockInitialValues(stored);
    await SettingsService.instance.init();
    tester.view.physicalSize = const Size(360 * 3, 900 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: _Host())),
    );
  }

  testWidgets('all three cards render with their empty states', (tester) async {
    await pumpHost(tester, {});

    expect(find.text('Privacy redaction'), findsOneWidget);
    expect(find.text('Capture presets'), findsOneWidget);
    expect(find.text('No custom presets yet. Tap + to add one.'),
        findsOneWidget);
    expect(find.text('Region favorites'), findsOneWidget);
    expect(find.textContaining('No saved regions yet'), findsOneWidget);
    expect(find.text('APP FOLDER'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the redaction switch writes through and rebuilds',
      (tester) async {
    await pumpHost(tester, {});
    expect(SettingsService.instance.redactionEnabled, isFalse);

    await tester.tap(find.byType(SwitchListTile));
    await tester.pump();

    expect(SettingsService.instance.redactionEnabled, isTrue);
    expect(
        tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        isTrue);
  });

  testWidgets('adding a preset through the dialog stores it and selects it',
      (tester) async {
    await pumpHost(tester, {});

    await tester.tap(find.byTooltip('Add preset'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Docs scan');
    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();

    final presets =
        CustomPreset.decodeList(SettingsService.instance.customPresetsRaw);
    expect(presets.map((p) => p.name), ['Docs scan']);
    expect(SettingsService.instance.activeCustomPresetId, presets.single.id);
    expect(find.text('Docs scan'), findsOneWidget);
  });

  testWidgets('deleting a saved region removes it from the list',
      (tester) async {
    const fav = RegionFavorite(name: 'Header', nx: 0, ny: 0, nw: 1, nh: 0.2);
    await pumpHost(tester, {
      'region_favorites': RegionFavorite.encodeList(const [fav]),
    });
    expect(find.text('Header'), findsOneWidget);

    await tester.tap(find.byTooltip('Delete region'));
    await tester.pump();

    expect(SettingsService.instance.regionFavoritesRaw, isEmpty);
    expect(find.text('Header'), findsNothing);
  });
}
