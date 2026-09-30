# ScreenSync UI template

One look for the whole app. **Every new component, widget, dialog or screen follows it.**
It is enforced by `test/theme_guardrails_test.dart`, not just written down.

## 1. Use the tokens, never literals

Everything lives in `lib/core/app_theme.dart` (and `lib/core/motion.dart`).

| Need | Use | Never |
|---|---|---|
| Colour | `AppTheme.primary / secondary / success / warning / danger`, `lightBg / lightSurface / lightSurfaceAlt / lightBorder`, `darkBg / darkSurface / darkSurfaceAlt / darkBorder`, `darkTextDim` | `Color(0xFF...)`, `Colors.purple` |
| Gradient | `AppTheme.gradPrimary / gradDanger / gradGreen / gradOrb` | hand-made `LinearGradient` |
| Radius | `AppTheme.radiusL` (24, cards, dialogs) / `radiusM` (16) / `radiusS` (10), pills `999` | `BorderRadius.circular(13)` |
| Type | `AppTheme.typeDisplay` (serif titles), `typeTitleLarge/Medium`, `typeBody`, `typeBodyMedium`, `typeCaption`, `microLabel` | raw `TextStyle(fontSize: ...)` for a new text role |
| Shadow | `AppTheme.elevLow / elevMid / elevHigh` (violet tinted) | `BoxShadow(color: Colors.black...)` |
| Motion | `AppTheme.motionFast / motionBase / motionSlow`, `motionStandard` curve | `Duration(milliseconds: 237)` |

Entry animation recipe (house style):
`.animate().fadeIn(duration: AppTheme.motionBase).slideY(begin: 0.06, end: 0, curve: AppTheme.motionStandard)`.

## 2. Reuse the shared components

| Component | File | For |
|---|---|---|
| `AppDialog` / `AppDialog.show` / `AppDialog.showCustom` (+ `AppDialogAction` in `app_dialog_actions.dart`) | `lib/widgets/app_dialog.dart` | **every dialog**: glass surface from the theme (AMOLED aware), gradient icon halo, serif title, eyebrow, 48dp pill buttons, busy / disabled actions, scrollable body, `pinned` slot (progress / result banner) above the buttons, lifts above the keyboard, named route for screen readers |
| `AppProgressBar` | `lib/widgets/app_progress_bar.dart` | any progress (determinate gradient, or indeterminate) |
| `GlassPanel` | `lib/core/app_theme.dart` | cards and panels |
| `StatusDotPill`, `SectionHeader` | `lib/widgets/common_widgets.dart` | status pills, section titles |
| `UpdateDialog` | `lib/widgets/update/update_dialog.dart` | the reference for a stateful, multi-state dialog |

### A new dialog in a few lines

```dart
final ok = await AppDialog.show<bool>(
  context,
  eyebrow: 'Capture',
  title: 'Delete this frame?',
  message: 'It is removed from this phone only.',
  icon: Icons.delete_outline_rounded,
  tone: AppDialogTone.danger,
  actions: [
    AppDialogAction(label: 'Cancel', onPressed: () => Navigator.pop(context, false)),
    AppDialogAction(label: 'Delete', primary: true, onPressed: () => Navigator.pop(context, true)),
  ],
);
```

A dialog with its own state (a form, progress, a result that arrives later) is a `StatefulWidget`
whose `build` returns an `AppDialog`, shown with `AppDialog.showCustom(context, builder: ...)`.
Put what changes while an action runs (a progress bar, the outcome banner) in `pinned:`, so it stays
next to the buttons on a short screen instead of scrolling away with the body. Copy the structure of
`UpdateDialog`.

## 3. The global safety net

`AppTheme.light()` / `dark()` also style the stock Material widgets, so one nobody styled still matches:
`dialogTheme` (24 px radius, border, serif title), `textButtonTheme` (pill, brand colour), `progressIndicatorTheme`
(brand colour, border track), `bottomSheetTheme` (24 px top radius), plus the filled / outlined / segmented buttons and
the snack bar. This is a fallback, not a licence: prefer the components above.

## 4. Checklist for a new widget

- [ ] Colours, radii, type, shadows and durations come from `AppTheme` (table above).
- [ ] Looks right in **light and dark** (`AppTheme.light()` / `AppTheme.dark()`).
- [ ] No overflow at **320 dp wide** and at text scale 1.3; long bodies scroll, actions stay reachable.
- [ ] Dialogs are `AppDialog`; progress is `AppProgressBar`; cards are `GlassPanel`.
- [ ] `StatelessWidget` by default, `const` constructor, file under 500 lines (extract siblings, do not grow a big file).
- [ ] A widget test pumps it at 320 / 360 / 393 dp and a short landscape size, in light and dark, at text
      scale 1.0 and 1.3, with no exception, and checks that the buttons (and any progress) are on screen
      (see `test/update_dialog_test.dart`; `test/app_dialog_test.dart` covers the base dialog).
- [ ] Do not `pumpAndSettle` while a spinner or indeterminate bar is on screen: it never settles.

## 5. How it is enforced

`test/theme_guardrails_test.dart` fails when:
- a file under `lib/` builds an `AlertDialog`, `SimpleDialog` or `CupertinoAlertDialog`;
- `showDialog` is used outside the one bespoke brand dialog (`connect_prompt_dialog.dart`);
- the global theme loses its dialog / button / progress / bottom-sheet styling.

If you have a real reason to break a rule, change the test and say why in the same commit.
