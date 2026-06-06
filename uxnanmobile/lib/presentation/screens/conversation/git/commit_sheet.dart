import 'package:flutter/material.dart';
import 'package:uxnan/core/extensions/string_ext.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Bottom sheet to compose a commit message. Resolves with the trimmed message,
/// or null if dismissed. Styled to match the conversation composer (rounded,
/// elevated card).
class CommitSheet extends StatefulWidget {
  /// Creates a [CommitSheet].
  const CommitSheet({super.key});

  /// Shows the sheet and resolves with the entered message (or null).
  static Future<String?> show(BuildContext context) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const CommitSheet(),
    );
  }

  @override
  State<CommitSheet> createState() => _CommitSheetState();
}

class _CommitSheetState extends State<CommitSheet> {
  final TextEditingController _controller = TextEditingController();
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_onChanged)
      ..dispose();
    super.dispose();
  }

  void _onChanged() {
    final hasText = _controller.text.isNotBlank;
    if (hasText != _hasText) setState(() => _hasText = hasText);
  }

  void _submit() {
    final message = _controller.text.trim();
    if (message.isEmpty) return;
    Navigator.of(context).pop(message);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.only(
        left: UxnanSpacing.lg,
        right: UxnanSpacing.lg,
        bottom: UxnanSpacing.lg + bottomInset,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: UxnanSpacing.md),
            child: Text(
              l10n.gitCommitTitle,
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          Container(
            decoration: BoxDecoration(
              color: colors.surfaceContainerHigh,
              borderRadius: const BorderRadius.all(Radius.circular(20)),
              border: Border.all(color: colors.outline.withValues(alpha: 0.6)),
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: UxnanSpacing.lg,
              vertical: UxnanSpacing.md,
            ),
            child: TextField(
              controller: _controller,
              autofocus: true,
              minLines: 2,
              maxLines: 6,
              textInputAction: TextInputAction.newline,
              style: Theme.of(context).textTheme.bodyMedium,
              decoration: InputDecoration(
                isCollapsed: true,
                border: InputBorder.none,
                hintText: l10n.gitCommitHint,
                hintStyle: TextStyle(color: colors.onSurfaceVariant),
              ),
            ),
          ),
          const SizedBox(height: UxnanSpacing.md),
          FilledButton.icon(
            onPressed: _hasText ? _submit : null,
            icon: const Icon(Icons.check_rounded, size: 18),
            label: Text(l10n.gitCommitButton),
          ),
        ],
      ),
    );
  }
}
