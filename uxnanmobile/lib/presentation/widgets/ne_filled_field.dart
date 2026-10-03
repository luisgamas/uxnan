import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A Neural Expressive **filled** text field (guide §4.3 input treatment): a
/// borderless `surfaceContainerHighest` field with a rounded shape and a
/// leading glyph, replacing M3's hard `OutlineInputBorder`. The focused state
/// gets a 2 dp primary outline.
///
/// The one form field of the app's full-page forms (manual pairing, the relay
/// setup) and the dialogs that ask for a secret, so a field looks the same
/// wherever something is typed into one.
class NeFilledField extends StatelessWidget {
  /// Creates a [NeFilledField].
  const NeFilledField({
    required this.controller,
    required this.icon,
    required this.label,
    this.hint,
    this.enabled = true,
    this.obscureText = false,
    this.suffix,
    this.keyboardType,
    this.textInputAction,
    this.textCapitalization = TextCapitalization.none,
    this.onChanged,
    this.onSubmitted,
    this.autofocus = false,
    super.key,
  });

  /// The field's text.
  final TextEditingController controller;

  /// Whether the field takes input.
  final bool enabled;

  /// Leading glyph.
  final UxIconData icon;

  /// Floating label.
  final String label;

  /// Placeholder shown while empty.
  final String? hint;

  /// Whether the text is hidden (a secret).
  final bool obscureText;

  /// Trailing widget (e.g. a show / hide toggle for a secret).
  final Widget? suffix;

  /// Keyboard to show.
  final TextInputType? keyboardType;

  /// The keyboard's action button.
  final TextInputAction? textInputAction;

  /// Automatic capitalization.
  final TextCapitalization textCapitalization;

  /// Called on every edit.
  final ValueChanged<String>? onChanged;

  /// Called when the keyboard's action button is pressed.
  final ValueChanged<String>? onSubmitted;

  /// Whether the field takes focus when it appears.
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final shape = OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: BorderSide.none,
    );
    return TextField(
      controller: controller,
      enabled: enabled,
      autofocus: autofocus,
      autocorrect: false,
      enableSuggestions: !obscureText,
      obscureText: obscureText,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      textCapitalization: textCapitalization,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: UxIcon(icon, color: colors.onSurfaceVariant),
        suffixIcon: suffix,
        filled: true,
        fillColor: colors.surfaceContainerHighest,
        border: shape,
        enabledBorder: shape,
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: colors.primary, width: 2),
        ),
      ),
    );
  }
}
