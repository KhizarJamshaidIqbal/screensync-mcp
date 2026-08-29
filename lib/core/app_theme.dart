import 'package:flutter/material.dart';

/// Accent palette for the E3 theme picker. Index 0 is the brand violet.
class AppAccent {
  const AppAccent(this.label, this.color);
  final String label;
  final Color color;

  static const palette = <AppAccent>[
    AppAccent('Violet', Color(0xFF7C3AED)),
    AppAccent('Indigo', Color(0xFF4F46E5)),
    AppAccent('Cyan', Color(0xFF0891B2)),
    AppAccent('Emerald', Color(0xFF059669)),
    AppAccent('Amber', Color(0xFFD97706)),
    AppAccent('Rose', Color(0xFFE11D48)),
  ];

  static Color at(int index) =>
      palette[index.clamp(0, palette.length - 1)].color;
}

/// ScreenSync design tokens — violet "watching over your shoulder" system.
/// Light = soft lavender; dark = deep indigo. Serif display type with italic
/// accents, uppercase micro-labels, glossy gradient tiles.
class AppTheme {
  AppTheme._();

  static const radiusL = 24.0;
  static const radiusM = 16.0;
  static const radiusS = 10.0;

  // Light palette (lavender).
  static const lightBg = Color(0xFFEFEAF9);
  static const lightSurface = Color(0xFFFCFBFF);
  static const lightSurfaceAlt = Color(0xFFF5F1FC);
  static const lightBorder = Color(0xFFE3DCF2);

  // Dark palette (deep indigo).
  static const darkBg = Color(0xFF150E27);
  static const darkSurface = Color(0xFF211636);
  static const darkSurfaceAlt = Color(0xFF1A1130);
  static const darkBorder = Color(0xFF362A54);

  /// Muted purple-gray that reads on both palettes (micro-labels, hints).
  static const darkTextDim = Color(0xFF8D86AB);

  // Brand.
  static const primary = Color(0xFF7C3AED);
  static const secondary = Color(0xFFA78BFA);
  static const accentCyan = Color(0xFF8B5CF6); // violet glow accent
  static const accentMagenta = Color(0xFFC13BD9); // italic accent words
  static const success = Color(0xFF10B981);
  static const warning = Color(0xFFF59E0B);
  static const danger = Color(0xFFEF4444);

  // Gradients.
  static const gradPrimary = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF6D28D9), Color(0xFF8B5CF6)],
  );
  static const gradDanger = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFDC2626), Color(0xFFF05252)],
  );
  static const gradGreen = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF059669), Color(0xFF34D399)],
  );
  static const gradOrb = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFC4B5FD), Color(0xFF7C3AED)],
  );

  // Type.
  static const TextStyle typeDisplay = TextStyle(
    fontFamily: 'serif',
    fontSize: 27,
    fontWeight: FontWeight.w800,
    height: 1.18,
    letterSpacing: -0.2,
  );
  static const TextStyle typeTitleLarge = TextStyle(
    fontSize: 17,
    fontWeight: FontWeight.w700,
  );
  static const TextStyle typeTitleMedium = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w600,
  );
  static const TextStyle typeBody = TextStyle(fontSize: 13);
  static const TextStyle typeBodyMedium = TextStyle(fontSize: 12);
  static const TextStyle typeCaption = TextStyle(fontSize: 10.5);

  /// Uppercase tracked micro-label (STORED, THIS PHONE, CONFIGURATION…).
  static const TextStyle microLabel = TextStyle(
    fontSize: 9,
    fontWeight: FontWeight.w700,
    letterSpacing: 1.3,
  );

  // Elevation (soft violet-tinted shadows).
  static const elevLow = [
    BoxShadow(color: Color(0x1A7C3AED), blurRadius: 18, offset: Offset(0, 8)),
  ];
  static const elevMid = [
    BoxShadow(color: Color(0x247C3AED), blurRadius: 24, offset: Offset(0, 10)),
  ];
  static const elevHigh = [
    BoxShadow(color: Color(0x337C3AED), blurRadius: 32, offset: Offset(0, 14)),
  ];

  static ThemeData dark({Color? accent, bool amoled = false}) => _base(
        Brightness.dark,
        amoled ? const Color(0xFF000000) : darkBg,
        amoled ? const Color(0xFF0A0A0A) : darkSurface,
        amoled ? const Color(0xFF050505) : darkSurfaceAlt,
        darkBorder,
        accent: accent,
      );

  static ThemeData light({Color? accent, bool amoled = false}) => _base(
        Brightness.light,
        lightBg,
        lightSurface,
        lightSurfaceAlt,
        lightBorder,
        accent: accent,
      );

  static ThemeData _base(Brightness brightness, Color bg, Color surface,
      Color surfaceAlt, Color border,
      {Color? accent}) {
    final isDark = brightness == Brightness.dark;
    final seed = accent ?? primary;
    final text = isDark ? const Color(0xFFF2EEFB) : const Color(0xFF221A38);
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: bg,
      cardColor: surface,
      textTheme: TextTheme(
        displayLarge: typeDisplay.copyWith(color: text),
        titleLarge: typeTitleLarge.copyWith(color: text),
        titleMedium: typeTitleMedium.copyWith(color: text),
        bodyLarge: typeBody.copyWith(color: text),
        bodyMedium: typeBodyMedium.copyWith(color: text),
        bodySmall: typeCaption.copyWith(color: darkTextDim),
      ),
      colorScheme: ColorScheme.fromSeed(
        seedColor: seed,
        brightness: brightness,
        primary: seed,
        secondary: secondary,
        surface: surface,
      ),
      dividerColor: border,
      snackBarTheme: SnackBarThemeData(
        backgroundColor:
            isDark ? const Color(0xFF2A1D45) : const Color(0xFF221A38),
        contentTextStyle: const TextStyle(
          color: Colors.white,
          fontSize: 12.5,
          fontWeight: FontWeight.w500,
        ),
        actionTextColor: secondary,
        behavior: SnackBarBehavior.floating,
        elevation: 8,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusM),
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        foregroundColor: text,
        elevation: 0,
        titleTextStyle: TextStyle(
          fontWeight: FontWeight.w800,
          fontSize: 16,
          color: text,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(radiusM))),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(radiusM))),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
            shape: WidgetStatePropertyAll(RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(radiusM)))),
      ),
    );
  }
}

/// Soft rounded card used across tabs — flat surface, subtle border, soft
/// violet shadow (matches reference cards).
class GlassPanel extends StatelessWidget {
  const GlassPanel({
    super.key,
    required this.child,
    this.borderColor,
    this.padding = const EdgeInsets.all(16),
    this.borderRadius = AppTheme.radiusL,
  });

  final Widget child;
  final Color? borderColor;
  final EdgeInsets padding;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: dark ? AppTheme.darkSurface : AppTheme.lightSurface,
        borderRadius: BorderRadius.circular(borderRadius),
        border: Border.all(
          color: borderColor ??
              (dark ? AppTheme.darkBorder : AppTheme.lightBorder),
        ),
        boxShadow: AppTheme.elevLow,
      ),
      child: child,
    );
  }
}
