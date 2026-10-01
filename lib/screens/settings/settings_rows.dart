import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../widgets/ref_widgets.dart';

/// One row of the Settings tab's permission doctor: an icon, a title, an
/// optional hint and a pill button on the right.
class DoctorTile extends StatelessWidget {
  const DoctorTile({
    super.key,
    required this.icon,
    required this.title,
    required this.trailing,
    this.subtitle,
    this.tint,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final Widget trailing;
  final String? subtitle;
  final Color? tint;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final tint = this.tint ?? AppTheme.primary;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: tint.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 17, color: tint),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w600)),
                if (subtitle != null)
                  Text(subtitle!,
                      style: AppTheme.typeBodyMedium
                          .copyWith(color: AppTheme.darkTextDim)),
              ],
            ),
          ),
          InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: onTap,
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: tint.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: tint.withValues(alpha: 0.35)),
              ),
              child: DefaultTextStyle(
                style: AppTheme.microLabel.copyWith(color: tint),
                child: trailing,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A label on the left and a value on the right, used by the info panels.
class DriveRow extends StatelessWidget {
  const DriveRow({super.key, required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          MicroLabel(label),
          const Spacer(),
          Text(
            value,
            style: AppTheme.typeBodyMedium.copyWith(
              fontWeight: FontWeight.w600,
              color:
                  dark ? const Color(0xFFF2EEFB) : const Color(0xFF221A38),
            ),
          ),
        ],
      ),
    );
  }
}
