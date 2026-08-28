import 'dart:io';

import 'package:flutter/material.dart';

import '../core/app_theme.dart';
import '../models/frame_entry.dart';

/// Before/after comparison of two frames: slider wipe (default) or
/// side-by-side. The emotional payoff after applying an AI patch.
class DiffScreen extends StatefulWidget {
  const DiffScreen({super.key, required this.before, required this.after});

  final FrameEntry before;
  final FrameEntry after;

  @override
  State<DiffScreen> createState() => _DiffScreenState();
}

class _DiffScreenState extends State<DiffScreen> {
  double _t = 0.5;
  bool _sideBySide = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Before / After'),
        actions: [
          IconButton(
            tooltip: _sideBySide ? 'Slider mode' : 'Side-by-side mode',
            icon: Icon(_sideBySide
                ? Icons.compare_arrows_rounded
                : Icons.view_column_rounded),
            onPressed: () => setState(() => _sideBySide = !_sideBySide),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: _sideBySide ? _buildSideBySide() : _buildSlider(),
          ),
          if (!_sideBySide)
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Slider(
                      value: _t,
                      onChanged: (v) => setState(() => _t = v),
                      activeColor: AppTheme.accentCyan,
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        _label('Before', widget.before),
                        _label('After', widget.after),
                      ],
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _label(String title, FrameEntry entry) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                  fontWeight: FontWeight.w700, fontSize: 12)),
          Text(
            entry.capturedAt.toLocal().toString().split('.').first,
            style: TextStyle(fontSize: 10, color: AppTheme.darkTextDim),
          ),
        ],
      );

  Widget _buildSlider() {
    return LayoutBuilder(
      builder: (context, constraints) {
        return Stack(
          children: [
            Positioned.fill(
              child: _image(widget.after, BoxFit.contain),
            ),
            Positioned.fill(
              child: ClipRect(
                clipper: _LeftClipper(fraction: _t),
                child: _image(widget.before, BoxFit.contain),
              ),
            ),
            // Wipe divider.
            Positioned(
              left: constraints.maxWidth * _t - 1.5,
              top: 0,
              bottom: 0,
              child: Container(
                width: 3,
                color: AppTheme.accentCyan,
              ),
            ),
            Positioned(
              left: constraints.maxWidth * _t - 16,
              top: constraints.maxHeight / 2 - 16,
              child: Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: AppTheme.accentCyan,
                  shape: BoxShape.circle,
                  boxShadow: AppTheme.elevLow,
                ),
                child: const Icon(Icons.unfold_more_rounded,
                    color: Colors.white, size: 18),
              ),
            ),
            const Positioned(
              top: 10,
              left: 12,
              child: _Tag(text: 'BEFORE', color: AppTheme.warning),
            ),
            const Positioned(
              top: 10,
              right: 12,
              child: _Tag(text: 'AFTER', color: AppTheme.success),
            ),
          ],
        );
      },
    );
  }

  Widget _buildSideBySide() {
    return Row(
      children: [
        Expanded(
          child: Column(
            children: [
              const _Tag(text: 'BEFORE', color: AppTheme.warning),
              Expanded(child: _image(widget.before, BoxFit.contain)),
            ],
          ),
        ),
        const VerticalDivider(width: 2),
        Expanded(
          child: Column(
            children: [
              const _Tag(text: 'AFTER', color: AppTheme.success),
              Expanded(child: _image(widget.after, BoxFit.contain)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _image(FrameEntry entry, BoxFit fit) => InteractiveViewer(
        minScale: 0.5,
        maxScale: 5,
        child: Center(
          child: Image.file(
            File(entry.filePath),
            fit: fit,
            errorBuilder: (_, __, ___) => const Icon(
                Icons.broken_image_outlined, color: Colors.white38),
          ),
        ),
      );
}

class _LeftClipper extends CustomClipper<Rect> {
  _LeftClipper({required this.fraction});
  final double fraction;

  @override
  Rect getClip(Size size) =>
      Rect.fromLTRB(0, 0, size.width * fraction, size.height);

  @override
  bool shouldReclip(covariant _LeftClipper old) => old.fraction != fraction;
}

class _Tag extends StatelessWidget {
  const _Tag({required this.text, required this.color});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text,
        style: const TextStyle(
            color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800),
      ),
    );
  }
}
