import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// A simple HSV-based color picker as a modal sheet.
///
/// The picker is a stateless editor for an arbitrary [Color] — the host
/// owns the working color and receives the result via [onApply]. It is
/// intentionally minimal (hue / saturation / value sliders + a hex
/// field + a preview), avoiding any third-party picker dependency and
/// keeping the visual baseline consistent with the rest of the app.
class ColorPickerSheet extends StatefulWidget {
  /// Creates a sheet that edits [initial]. [title] is shown at the top of
  /// the sheet; [onApply] receives the picked color when the user
  /// confirms.
  const ColorPickerSheet({
    required this.initial,
    required this.title,
    required this.onApply,
    super.key,
  });

  /// The color the picker starts with.
  final Color initial;

  /// The sheet's title (e.g. the role being edited).
  final String title;

  /// Called with the picked color when the user taps *Apply*. The sheet
  /// pops itself; the host's working color is updated by this callback.
  final ValueChanged<Color> onApply;

  /// Pushes the picker onto the navigator over [context] and returns the
  /// color the user picks, or null if they cancel.
  static Future<Color?> show(
    BuildContext context, {
    required Color initial,
    required String title,
  }) {
    return showModalBottomSheet<Color>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.85,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          builder: (_, controller) => SingleChildScrollView(
            controller: controller,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.lg),
              child: ColorPickerSheet(
                initial: initial,
                title: title,
                onApply: (color) => Navigator.of(sheetContext).pop(color),
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  State<ColorPickerSheet> createState() => _ColorPickerSheetState();
}

class _ColorPickerSheetState extends State<ColorPickerSheet> {
  late HSVColor _hsv;

  @override
  void initState() {
    super.initState();
    _hsv = HSVColor.fromColor(widget.initial);
  }

  Color get _color => _hsv.toColor();

  void _emit(HSVColor next) => setState(() => _hsv = next);

  String _hex(Color color) {
    final a = (color.a * 255.0).round() & 0xFF;
    final r = (color.r * 255.0).round() & 0xFF;
    final g = (color.g * 255.0).round() & 0xFF;
    final b = (color.b * 255.0).round() & 0xFF;
    String two(int n) => n.toRadixString(16).padLeft(2, '0').toUpperCase();
    return '${two(r)}${two(g)}${two(b)}'
        '${a == 0xFF ? '' : two(a)}';
  }

  Color? _parseHex(String input) {
    var hex = input.trim();
    if (hex.startsWith('#')) hex = hex.substring(1);
    if (hex.length == 6) hex = 'FF$hex';
    if (hex.length != 8) return null;
    final value = int.tryParse(hex, radix: 16);
    if (value == null) return null;
    return Color(value);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: UxnanSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
            child: Text(
              widget.title,
              style: textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: UxnanSpacing.md),
          _Preview(color: _color),
          const SizedBox(height: UxnanSpacing.lg),
          _HueSlider(
            hue: _hsv.hue,
            onChanged: (hue) => _emit(_hsv.withHue(hue)),
          ),
          const SizedBox(height: UxnanSpacing.sm),
          _LabeledSlider(
            label: 'S',
            value: _hsv.saturation,
            max: 1.0,
            activeColor: HSVColor.fromAHSV(1, _hsv.hue, 1, _hsv.value)
                .toColor(),
            onChanged: (s) => _emit(_hsv.withSaturation(s)),
          ),
          _LabeledSlider(
            label: 'V',
            value: _hsv.value,
            max: 1.0,
            activeColor: _color,
            onChanged: (v) => _emit(_hsv.withValue(v)),
          ),
          const SizedBox(height: UxnanSpacing.lg),
          _HexField(
            initial: _hex(_color),
            onSubmit: (input) {
              final parsed = _parseHex(input);
              if (parsed != null) _emit(HSVColor.fromColor(parsed));
            },
          ),
          const SizedBox(height: UxnanSpacing.lg),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: UxnanSpacing.md),
              Expanded(
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: colors.primary,
                    foregroundColor: colors.onPrimary,
                  ),
                  onPressed: () {
                    HapticFeedback.selectionClick();
                    widget.onApply(_color);
                  },
                  child: const Text('Apply'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Preview extends StatelessWidget {
  const _Preview({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      height: 88,
      decoration: BoxDecoration(
        color: color,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(
          color: colors.outline.withValues(alpha: 0.5),
          width: 1,
        ),
      ),
    );
  }
}

/// A horizontal hue track that paints the rainbow underneath the slider.
class _HueSlider extends StatelessWidget {
  const _HueSlider({required this.hue, required this.onChanged});

  final double hue;
  final ValueChanged<double> onChanged;

  static const List<Color> _stops = [
    Color(0xFFFF0000),
    Color(0xFFFFFF00),
    Color(0xFF00FF00),
    Color(0xFF00FFFF),
    Color(0xFF0000FF),
    Color(0xFFFF00FF),
    Color(0xFFFF0000),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.xs),
          child: Text(
            'H',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
          ),
        ),
        SliderTheme(
          data: SliderThemeData(
            activeTrackColor: Colors.transparent,
            inactiveTrackColor: Colors.transparent,
            trackHeight: 12,
            thumbColor: Colors.white,
            overlayColor: colors.primary.withValues(alpha: 0.2),
            thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 10),
          ),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: const BorderRadius.all(UxnanRadius.full),
              gradient: const LinearGradient(colors: _stops),
            ),
            child: Slider(
              value: hue,
              min: 0,
              max: 360,
              onChanged: onChanged,
            ),
          ),
        ),
      ],
    );
  }
}

class _LabeledSlider extends StatelessWidget {
  const _LabeledSlider({
    required this.label,
    required this.value,
    required this.max,
    required this.activeColor,
    required this.onChanged,
  });

  final String label;
  final double value;
  final double max;
  final Color activeColor;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.xs),
      child: Row(
        children: [
          SizedBox(
            width: 16,
            child: Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
            ),
          ),
          Expanded(
            child: Slider(
              value: value,
              max: max,
              activeColor: activeColor,
              onChanged: onChanged,
            ),
          ),
        ],
      ),
    );
  }
}

class _HexField extends StatefulWidget {
  const _HexField({required this.initial, required this.onSubmit});

  final String initial;
  final ValueChanged<String> onSubmit;

  @override
  State<_HexField> createState() => _HexFieldState();
}

class _HexFieldState extends State<_HexField> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initial);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return TextField(
      controller: _controller,
      style: Theme.of(context)
          .textTheme
          .bodyMedium
          ?.copyWith(fontFamily: 'JetBrainsMono'),
      decoration: InputDecoration(
        prefixText: '#  ',
        prefixStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: colors.onSurfaceVariant,
              fontFamily: 'JetBrainsMono',
            ),
        filled: true,
        fillColor: colors.surfaceContainerHigh,
        border: OutlineInputBorder(
          borderRadius: const BorderRadius.all(UxnanRadius.md),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.md,
          vertical: UxnanSpacing.md,
        ),
      ),
      inputFormatters: [
        LengthLimitingTextInputFormatter(9),
        FilteringTextInputFormatter.allow(
          RegExp(r'[#0-9a-fA-F]'),
        ),
      ],
      onSubmitted: widget.onSubmit,
    );
  }
}
