import 'package:flutter/material.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Visual treatment for a tree tile (icon + accent color) by [GitFileStatus].
///
/// The color follows the rest of the app's git chrome: added/modified/
/// renamed/unstaged use the same `UxnanColors` tokens as the diff view in
/// `GitScreen`; untracked gets the untracked blue; tracked (no change) is the
/// neutral on-surface-variant tone. Untracked files share the untracked color
/// so the eye picks them up immediately.
({IconData icon, Color color}) gitFileStatusVisuals(GitFileStatus? status) {
  switch (status) {
    case GitFileStatus.added:
      return (icon: Icons.add_circle_outline, color: UxnanColors.gitAdded);
    case GitFileStatus.modified:
      return (icon: Icons.edit_outlined, color: UxnanColors.gitModified);
    case GitFileStatus.deleted:
      return (icon: Icons.remove_circle_outline, color: UxnanColors.gitDeleted);
    case GitFileStatus.renamed:
      return (
        icon: Icons.drive_file_move_outline,
        color: UxnanColors.gitModified
      );
    case GitFileStatus.untracked:
      return (icon: Icons.fiber_new_outlined, color: UxnanColors.gitUntracked);
    case null:
      return (
        icon: Icons.insert_drive_file_outlined,
        color: UxnanColors.onSurfaceMuted
      );
  }
}

/// Returns the icon for a directory or file extension (best-effort). The icon
/// is purely decorative — the file's git status is painted separately as a
/// leading dot — so the file type is communicated by glyph and the git state
/// by color.
({IconData icon}) fileTypeVisuals({
  required String name,
  required FileEntryType type,
}) {
  if (type == FileEntryType.dir) {
    return (icon: Icons.folder_outlined);
  }
  final lower = name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return (icon: Icons.description_outlined);
  }
  if (lower.endsWith('.dart') ||
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.js') ||
      lower.endsWith('.jsx') ||
      lower.endsWith('.py') ||
      lower.endsWith('.swift') ||
      lower.endsWith('.kt') ||
      lower.endsWith('.java') ||
      lower.endsWith('.go') ||
      lower.endsWith('.rs') ||
      lower.endsWith('.cpp') ||
      lower.endsWith('.c') ||
      lower.endsWith('.h') ||
      lower.endsWith('.css') ||
      lower.endsWith('.scss') ||
      lower.endsWith('.html') ||
      lower.endsWith('.json') ||
      lower.endsWith('.yaml') ||
      lower.endsWith('.yml') ||
      lower.endsWith('.toml') ||
      lower.endsWith('.xml') ||
      lower.endsWith('.sh') ||
      lower.endsWith('.sql')) {
    return (icon: Icons.code_rounded);
  }
  if (lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.bmp') ||
      lower.endsWith('.svg')) {
    return (icon: Icons.image_outlined);
  }
  if (lower.endsWith('.pdf')) {
    return (icon: Icons.picture_as_pdf_outlined);
  }
  if (lower.endsWith('.lock')) {
    return (icon: Icons.lock_outline);
  }
  if (lower == 'license' ||
      lower == 'license.md' ||
      lower.startsWith('license.')) {
    return (icon: Icons.gavel_outlined);
  }
  if (lower == 'readme.md' || lower.startsWith('readme')) {
    return (icon: Icons.menu_book_outlined);
  }
  return (icon: Icons.insert_drive_file_outlined);
}

/// A single row in the file browser: a leading icon, a name (optionally with
/// the git status painted as the name color), the path, an optional git
/// status pill on the right, and a trailing chevron for directories.
///
/// Stateless — the parent owns expansion / selection state and passes the
/// derived booleans. Tap fires [onTap], long-press [onLongPress] when given.
class FileTreeTile extends StatelessWidget {
  /// Creates a [FileTreeTile].
  const FileTreeTile({
    required this.node,
    required this.depth,
    required this.showExtension,
    required this.onTap,
    this.onLongPress,
    super.key,
  });

  /// The file/folder this row represents.
  final FileTreeNode node;

  /// 0-based indentation level (root = 0). The tile adds `8 dp * depth` of
  /// leading padding so the tree reads naturally.
  final int depth;

  /// Whether the file's extension should be visible. When `false`, the row
  /// strips the trailing `.ext` for display but keeps the full name in the
  /// semantics label so screen readers still announce it.
  final bool showExtension;

  /// Tap callback — the parent decides what to do (expand a directory, open a
  /// file, …).
  final VoidCallback onTap;

  /// Optional long-press (used for future "copy path" / "reveal" actions).
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final isDir = node.isDir;
    final status = node.gitStatus;
    final visuals = gitFileStatusVisuals(status);
    final typeVisuals = fileTypeVisuals(name: node.basename, type: node.type);
    final displayName = node.displayName(showExtension: showExtension);
    final indent = depth * 16.0;

    // Name color reflects git status when set; otherwise the regular text
    // color. Untracked files get the untracked color so they pop without a
    // bold weight change.
    final nameColor = switch (status) {
      GitFileStatus.added => UxnanColors.gitAdded,
      GitFileStatus.modified => UxnanColors.gitModified,
      GitFileStatus.deleted => UxnanColors.gitDeleted,
      GitFileStatus.renamed => UxnanColors.gitModified,
      GitFileStatus.untracked => UxnanColors.gitUntracked,
      null => colors.onSurface,
    };

    // The leading icon mirrors the git status (added/edited/removed/) for
    // files; for directories we keep the folder icon regardless of status.
    final IconData leadingIcon = isDir ? Icons.folder_outlined : visuals.icon;
    final Color leadingColor = isDir
        ? (status == null ? colors.onSurfaceVariant : visuals.color)
        : visuals.color;

    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.lg,
          vertical: UxnanSpacing.xs,
        ),
        child: Row(
          children: [
            SizedBox(width: indent),
            Icon(
              leadingIcon,
              size: 20,
              color: leadingColor,
              semanticLabel: isDir ? 'Folder' : status?.name ?? 'File',
            ),
            const SizedBox(width: UxnanSpacing.sm),
            // The leading dot: a small filled circle in the file-type color.
            // Decorative — it groups similar files at a glance and gives the
            // git status icon extra prominence.
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: typeVisuals == const (icon: Icons.image_outlined) ||
                        typeVisuals ==
                            const (icon: Icons.description_outlined) ||
                        typeVisuals == const (icon: Icons.menu_book_outlined)
                    ? colors.onSurfaceVariant.withValues(alpha: 0.5)
                    : colors.onSurfaceVariant.withValues(alpha: 0.25),
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    displayName,
                    style: textTheme.bodyMedium?.copyWith(
                      color: nameColor,
                      fontWeight:
                          status == null ? FontWeight.w400 : FontWeight.w500,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (node.path != displayName)
                    Text(
                      node.path,
                      style: UxnanTypography.codeSmall.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ),
            ),
            if (isDir)
              Icon(
                node.expanded
                    ? Icons.expand_more_rounded
                    : Icons.chevron_right_rounded,
                size: 20,
                color: colors.onSurfaceVariant,
              )
            else if (node.loading)
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
      ),
    );
  }
}
