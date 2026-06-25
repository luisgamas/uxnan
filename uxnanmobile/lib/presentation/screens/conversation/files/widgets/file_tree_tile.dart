import 'package:flutter/material.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// The name/icon color for a file or folder by its [GitFileStatus].
///
/// Communicates git state through colour, not extra glyphs:
/// - tracked, unchanged (`null`) → [ColorScheme.onSurface] (the regular,
///   confident text tone);
/// - **untracked** → [ColorScheme.onSurfaceVariant] — a distinguishable muted
///   grey so files git isn't tracking read as clearly de-emphasised;
/// - added/modified/renamed/deleted → the matching `UxnanColors` git token
///   (same palette as the diff view in `GitScreen`).
Color gitStatusColor(GitFileStatus? status, ColorScheme colors) {
  return switch (status) {
    GitFileStatus.added => UxnanColors.gitAdded,
    GitFileStatus.modified => UxnanColors.gitModified,
    GitFileStatus.renamed => UxnanColors.gitModified,
    GitFileStatus.deleted => UxnanColors.gitDeleted,
    GitFileStatus.untracked => colors.onSurfaceVariant,
    null => colors.onSurface,
  };
}

/// Returns the icon for a directory or file extension (best-effort). The file
/// type is communicated by the glyph; the git state is communicated by the
/// glyph + name colour (see [gitStatusColor]).
({IconData icon}) fileTypeVisuals({
  required String name,
  required FileEntryType type,
}) {
  if (type == FileEntryType.dir) {
    return (icon: Icons.folder_outlined);
  }
  final lower = name.toLowerCase();

  // 1. Well-known filenames (checked before extensions). `readme`/`license`
  //    keep their distinctive glyphs; the rest get a sensible category icon.
  if (lower == 'readme' || lower.startsWith('readme.')) {
    return (icon: Icons.menu_book_outlined);
  }
  if (lower == 'license' ||
      lower == 'licence' ||
      lower.startsWith('license.') ||
      lower.startsWith('licence.') ||
      lower == 'copying') {
    return (icon: Icons.gavel_outlined);
  }
  if (lower == 'dockerfile' || lower.startsWith('dockerfile.')) {
    return (icon: Icons.inventory_2_outlined);
  }
  if (lower == 'makefile' ||
      lower == 'gnumakefile' ||
      lower == 'cmakelists.txt') {
    return (icon: Icons.build_outlined);
  }
  if (lower == '.gitignore' ||
      lower == '.gitattributes' ||
      lower == '.dockerignore' ||
      lower == '.editorconfig' ||
      lower == '.npmignore') {
    return (icon: Icons.settings_outlined);
  }
  if (lower == '.env' || lower.startsWith('.env.')) {
    return (icon: Icons.key_outlined);
  }

  // 2. Extension families.
  if (_hasExt(lower, _markdownExts)) {
    return (icon: Icons.description_outlined);
  }
  if (_hasExt(lower, _imageExts)) {
    return (icon: Icons.image_outlined);
  }
  if (lower.endsWith('.pdf')) {
    return (icon: Icons.picture_as_pdf_outlined);
  }
  if (_hasExt(lower, _archiveExts)) {
    return (icon: Icons.folder_zip_outlined);
  }
  if (_hasExt(lower, _dataExts)) {
    return (icon: Icons.data_object_rounded);
  }
  if (_hasExt(lower, _sheetExts)) {
    return (icon: Icons.table_chart_outlined);
  }
  if (_hasExt(lower, _shellExts)) {
    return (icon: Icons.terminal_rounded);
  }
  if (_hasExt(lower, _fontExts)) {
    return (icon: Icons.font_download_outlined);
  }
  if (_hasExt(lower, _audioExts)) {
    return (icon: Icons.audiotrack_outlined);
  }
  if (_hasExt(lower, _videoExts)) {
    return (icon: Icons.movie_outlined);
  }
  if (lower.endsWith('.lock')) {
    return (icon: Icons.lock_outline);
  }
  if (_hasExt(lower, _codeExts)) {
    return (icon: Icons.code_rounded);
  }
  if (lower.endsWith('.txt') || lower.endsWith('.log')) {
    return (icon: Icons.notes_rounded);
  }
  return (icon: Icons.insert_drive_file_outlined);
}

/// True when [lower] (already lower-cased) ends with any extension in [exts].
bool _hasExt(String lower, List<String> exts) {
  for (final e in exts) {
    if (lower.endsWith(e)) return true;
  }
  return false;
}

const _markdownExts = ['.md', '.markdown', '.mdx', '.rst'];
const _imageExts = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.avif',
  '.heic', //
];
const _archiveExts = [
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.rar',
  '.7z',
  '.jar',
  '.aar',
];
const _dataExts = [
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.xml', '.ini',
  '.cfg', '.conf', '.properties', '.plist', '.graphql', '.gql', '.proto', //
];
const _sheetExts = ['.csv', '.tsv', '.xlsx', '.xls'];
const _shellExts = ['.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd'];
const _fontExts = ['.ttf', '.otf', '.woff', '.woff2', '.eot'];
const _audioExts = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'];
const _videoExts = ['.mp4', '.mov', '.mkv', '.webm', '.avi'];
const _codeExts = [
  '.dart', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi', '.rb', '.php', '.swift', '.kt', '.kts', '.java', '.scala',
  '.groovy', '.gradle', '.go', '.rs', '.ex', '.exs', '.erl', '.hs', '.lua',
  '.pl', '.pm', '.r', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.c', '.h', '.m',
  '.mm', '.cs', '.fs', '.vb', '.css', '.scss', '.sass', '.less', '.vue',
  '.svelte', '.astro', '.html', '.htm', '.sql', '.diff', '.patch', '.cmake',
  '.tf', //
];

/// A single row in the file browser: a leading file-type icon, the name, its
/// path, and a trailing chevron for directories. Git state is conveyed purely
/// through the name + icon colour (see [gitStatusColor]) — tracked-unchanged
/// files read as [ColorScheme.onSurface], untracked ones as a muted grey, and
/// changed files in their git colour — so the row stays uncluttered (no extra
/// status dots or pills).
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
    final typeVisuals = fileTypeVisuals(name: node.basename, type: node.type);
    final displayName = node.displayName(showExtension: showExtension);
    final indent = depth * 16.0;

    // Git state is carried by colour: tracked-unchanged → onSurface, untracked
    // → a muted grey, changed → the git colour. The name takes that colour
    // directly; the leading file-type icon takes it too, except a neutral
    // (unchanged) file keeps a slightly softer icon tone than its name.
    final statusColor = gitStatusColor(status, colors);
    final iconColor = status == null ? colors.onSurfaceVariant : statusColor;
    // Only an actual git *change* (added/modified/deleted/renamed) bumps the
    // weight; untracked stays at the normal weight so it reads as quiet grey.
    final emphasised = status != null && status != GitFileStatus.untracked;

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
            // The leading glyph communicates the file *type*; its colour
            // communicates the git state.
            Icon(
              typeVisuals.icon,
              size: 20,
              color: iconColor,
              semanticLabel: isDir ? 'Folder' : status?.name ?? 'File',
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
                      color: statusColor,
                      fontWeight:
                          emphasised ? FontWeight.w500 : FontWeight.w400,
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
