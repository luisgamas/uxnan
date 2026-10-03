import 'package:flutter/material.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/ne_filled_field.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// A Cloudflare API token the person typed for one relay action, and whether
/// the PC should keep it. Handed straight to the call and dropped: the phone
/// never stores it.
class RelayCredential {
  /// Creates a [RelayCredential].
  const RelayCredential({required this.apiToken, required this.remember});

  /// The token, as typed (trimmed).
  final String apiToken;

  /// Whether the bridge keeps it in the PC's system keychain.
  final bool remember;
}

/// What the person chose in [RelayRemoveDialog].
class RelayRemoveChoice {
  /// Creates a [RelayRemoveChoice].
  const RelayRemoveChoice({required this.deleteWorker, this.credential});

  /// Also delete the relay from the Cloudflare account.
  final bool deleteWorker;

  /// The token for deleting it, when the PC does not remember one.
  final RelayCredential? credential;
}

/// The token field of every relay form: obscured, with a show / hide toggle.
class RelayTokenField extends StatefulWidget {
  /// Creates a [RelayTokenField].
  const RelayTokenField({
    required this.controller,
    this.enabled = true,
    this.autofocus = false,
    this.onChanged,
    this.onSubmitted,
    this.textInputAction = TextInputAction.done,
    super.key,
  });

  /// The token's text.
  final TextEditingController controller;

  /// Whether the field takes input.
  final bool enabled;

  /// Whether it takes focus when it appears.
  final bool autofocus;

  /// Called on every edit.
  final ValueChanged<String>? onChanged;

  /// Called when the keyboard's action button is pressed.
  final ValueChanged<String>? onSubmitted;

  /// The keyboard's action button.
  final TextInputAction textInputAction;

  @override
  State<RelayTokenField> createState() => _RelayTokenFieldState();
}

class _RelayTokenFieldState extends State<RelayTokenField> {
  bool _visible = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return NeFilledField(
      controller: widget.controller,
      enabled: widget.enabled,
      autofocus: widget.autofocus,
      icon: UxIcons.key,
      label: l10n.relayTokenLabel,
      obscureText: !_visible,
      keyboardType: TextInputType.visiblePassword,
      textInputAction: widget.textInputAction,
      onChanged: widget.onChanged,
      onSubmitted: widget.onSubmitted,
      suffix: IconButton(
        tooltip: _visible ? l10n.relayTokenHide : l10n.relayTokenShow,
        onPressed: () => setState(() => _visible = !_visible),
        icon: UxIcon(_visible ? UxIcons.visibilityOff : UxIcons.visibility),
      ),
    );
  }
}

/// "Remember the token on the PC": off by default, with the one line that
/// says where it would be kept.
class RelayRememberTile extends StatelessWidget {
  /// Creates a [RelayRememberTile].
  const RelayRememberTile({
    required this.value,
    required this.onChanged,
    super.key,
  });

  /// Whether the token is to be remembered.
  final bool value;

  /// Called with the new value; null disables the tile.
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return CheckboxListTile(
      contentPadding: EdgeInsets.zero,
      controlAffinity: ListTileControlAffinity.leading,
      value: value,
      onChanged: onChanged == null ? null : (v) => onChanged!(v ?? false),
      title: Text(l10n.relayRememberToken),
      subtitle: Text(l10n.relayRememberTokenHint),
    );
  }
}

/// Asks for the Cloudflare token an action needs when the PC remembers none.
/// Resolves with what was typed, or `null` when cancelled.
class RelayTokenDialog extends StatefulWidget {
  /// Creates a [RelayTokenDialog].
  const RelayTokenDialog({super.key});

  /// Shows the dialog.
  static Future<RelayCredential?> show(BuildContext context) =>
      showDialog<RelayCredential>(
        context: context,
        builder: (_) => const RelayTokenDialog(),
      );

  @override
  State<RelayTokenDialog> createState() => _RelayTokenDialogState();
}

class _RelayTokenDialogState extends State<RelayTokenDialog> {
  final TextEditingController _token = TextEditingController();
  bool _remember = false;

  @override
  void dispose() {
    _token.dispose();
    super.dispose();
  }

  void _submit() {
    final token = _token.text.trim();
    if (token.isEmpty) return;
    Navigator.pop(
      context,
      RelayCredential(apiToken: token, remember: _remember),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;
    return AlertDialog(
      title: Text(l10n.relayTokenTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.relayTokenBody,
              style: textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: UxnanSpacing.lg),
            RelayTokenField(
              controller: _token,
              autofocus: true,
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: UxnanSpacing.sm),
            RelayRememberTile(
              value: _remember,
              onChanged: (v) => setState(() => _remember = v),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.actionCancel),
        ),
        FilledButton(
          onPressed: _token.text.trim().isEmpty ? null : _submit,
          child: Text(l10n.relayTokenContinue),
        ),
      ],
    );
  }
}

/// Confirms giving the relay a new address. Resolves `true` to go ahead.
Future<bool> confirmRelayRotate(BuildContext context) async {
  final l10n = AppLocalizations.of(context);
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.relayRotateConfirmTitle),
      content: Text(l10n.relayRotateConfirmBody),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: Text(l10n.actionCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text(l10n.relayRotateConfirm),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}

/// Confirms removing the relay, with the option to also delete it from the
/// Cloudflare account — which asks for the token right here when the PC does
/// not remember one. Resolves `null` when cancelled.
class RelayRemoveDialog extends StatefulWidget {
  /// Creates a [RelayRemoveDialog].
  const RelayRemoveDialog({required this.tokenRemembered, super.key});

  /// Whether the PC keeps a token (so deleting needs none typed).
  final bool tokenRemembered;

  /// Shows the dialog.
  static Future<RelayRemoveChoice?> show(
    BuildContext context, {
    required bool tokenRemembered,
  }) =>
      showDialog<RelayRemoveChoice>(
        context: context,
        builder: (_) => RelayRemoveDialog(tokenRemembered: tokenRemembered),
      );

  @override
  State<RelayRemoveDialog> createState() => _RelayRemoveDialogState();
}

class _RelayRemoveDialogState extends State<RelayRemoveDialog> {
  final TextEditingController _token = TextEditingController();
  bool _deleteWorker = false;
  bool _remember = false;

  bool get _needsToken => _deleteWorker && !widget.tokenRemembered;

  bool get _ready => !_needsToken || _token.text.trim().isNotEmpty;

  @override
  void dispose() {
    _token.dispose();
    super.dispose();
  }

  void _confirm() {
    if (!_ready) return;
    Navigator.pop(
      context,
      RelayRemoveChoice(
        deleteWorker: _deleteWorker,
        credential: _needsToken
            ? RelayCredential(apiToken: _token.text.trim(), remember: _remember)
            : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return AlertDialog(
      title: Text(l10n.relayRemoveConfirmTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.relayRemoveConfirmBody),
            const SizedBox(height: UxnanSpacing.sm),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _deleteWorker,
              onChanged: (v) => setState(() => _deleteWorker = v ?? false),
              title: Text(l10n.relayRemoveDeleteWorker),
            ),
            if (_needsToken) ...[
              const SizedBox(height: UxnanSpacing.sm),
              RelayTokenField(
                controller: _token,
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) => _confirm(),
              ),
              RelayRememberTile(
                value: _remember,
                onChanged: (v) => setState(() => _remember = v),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.actionCancel),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: colors.error,
            foregroundColor: colors.onError,
          ),
          onPressed: _ready ? _confirm : null,
          child: Text(l10n.relayRemoveConfirm),
        ),
      ],
    );
  }
}
