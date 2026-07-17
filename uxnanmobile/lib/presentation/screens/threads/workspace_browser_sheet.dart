import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/browse_result.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';

/// Bottom sheet that browses the bridge's configured roots
/// (`workspace/browseDirs`): pick a root, descend into sub-folders (with
/// git-repo badges) via a breadcrumb, and "open here" — resolving with the
/// chosen absolute `cwd` (or null if dismissed). The plug-and-play alternative
/// to the configured project list.
class WorkspaceBrowserSheet extends ConsumerStatefulWidget {
  /// Creates a [WorkspaceBrowserSheet].
  const WorkspaceBrowserSheet({super.key});

  /// Shows the sheet and resolves with the chosen absolute `cwd` (or null).
  static Future<String?> show(BuildContext context) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const WorkspaceBrowserSheet(),
    );
  }

  @override
  ConsumerState<WorkspaceBrowserSheet> createState() =>
      _WorkspaceBrowserSheetState();
}

class _WorkspaceBrowserSheetState extends ConsumerState<WorkspaceBrowserSheet> {
  BrowseResult? _current;
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({String? rootId, String? path}) async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final result = await ref
          .read(workspaceBrowserProvider)
          .browse(rootId: rootId, path: path);
      if (!mounted) return;
      setState(() {
        _current = result;
        _loading = false;
        _failed = result == null;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
    final current = _current;

    return SafeArea(
      top: false,
      child: Padding(
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
              padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
              child: Text(
                l10n.workspaceBrowseTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            if (current != null && current.roots.length > 1)
              _RootPicker(
                roots: current.roots,
                selected: current.rootId,
                onSelected: (rootId) => _load(rootId: rootId, path: ''),
              ),
            if (current != null)
              Row(
                children: [
                  // Visual "up one level" affordance, left of the breadcrumb
                  // (the breadcrumb itself already navigates on tap). Disabled
                  // at a root, where there's no parent to ascend to.
                  IconButton(
                    tooltip: l10n.workspaceBrowseUp,
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(
                      Icons.drive_folder_upload_outlined,
                      size: 20,
                    ),
                    onPressed: current.path.isEmpty
                        ? null
                        : () => _load(
                              rootId: current.rootId,
                              path: _parentPath(current.path),
                            ),
                  ),
                  Expanded(
                    child: _Breadcrumb(
                      result: current,
                      onNavigate: (path) =>
                          _load(rootId: current.rootId, path: path),
                    ),
                  ),
                ],
              ),
            const SizedBox(height: UxnanSpacing.sm),
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight:
                    ((MediaQuery.sizeOf(context).height - bottomInset) * 0.45)
                        .clamp(160.0, MediaQuery.sizeOf(context).height),
              ),
              child: _loading
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(UxnanSpacing.xl),
                        child: PolygonLoader(size: 28),
                      ),
                    )
                  : _failed || current == null
                      ? Padding(
                          padding: const EdgeInsets.all(UxnanSpacing.md),
                          child: Text(l10n.workspaceBrowseFailed),
                        )
                      : _DirList(
                          dirs: current.dirs,
                          onOpen: (dir) =>
                              _load(rootId: current.rootId, path: dir.path),
                        ),
            ),
            const SizedBox(height: UxnanSpacing.md),
            FilledButton.icon(
              onPressed: current == null
                  ? null
                  : () => Navigator.of(context).pop(current.cwd),
              icon: const Icon(Icons.check_rounded, size: 18),
              label: Text(l10n.workspaceBrowseOpenHere),
            ),
          ],
        ),
      ),
    );
  }
}

/// The parent of a `/`-separated browse [path] (empty at a root).
String _parentPath(String path) {
  if (path.isEmpty) return '';
  final index = path.lastIndexOf('/');
  return index <= 0 ? '' : path.substring(0, index);
}

class _RootPicker extends StatelessWidget {
  const _RootPicker({
    required this.roots,
    required this.selected,
    required this.onSelected,
  });

  final List<BrowseRoot> roots;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final root in roots)
            Padding(
              padding: const EdgeInsets.only(right: UxnanSpacing.sm),
              child: ChoiceChip(
                avatar: const Icon(Icons.folder_special_outlined, size: 16),
                label: Text(root.name),
                selected: root.id == selected,
                onSelected: (_) => onSelected(root.id),
              ),
            ),
        ],
      ),
    );
  }
}

class _Breadcrumb extends StatelessWidget {
  const _Breadcrumb({required this.result, required this.onNavigate});

  final BrowseResult result;
  final ValueChanged<String> onNavigate;

  @override
  Widget build(BuildContext context) {
    final root = result.roots.firstWhere(
      (r) => r.id == result.rootId,
      orElse: () => const BrowseRoot(id: '', name: '/', cwd: ''),
    );
    final segments = result.path.isEmpty ? <String>[] : result.path.split('/');

    final crumbs = <Widget>[
      _Crumb(label: root.name, onTap: () => onNavigate('')),
    ];
    var acc = '';
    for (final segment in segments) {
      acc = acc.isEmpty ? segment : '$acc/$segment';
      final target = acc;
      crumbs
        ..add(const _CrumbSeparator())
        ..add(_Crumb(label: segment, onTap: () => onNavigate(target)));
    }

    return SizedBox(
      height: 32,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          Row(mainAxisSize: MainAxisSize.min, children: crumbs),
        ],
      ),
    );
  }
}

class _CrumbSeparator extends StatelessWidget {
  const _CrumbSeparator();

  @override
  Widget build(BuildContext context) {
    return Icon(
      Icons.chevron_right_rounded,
      size: 16,
      color: Theme.of(context).colorScheme.onSurfaceVariant,
    );
  }
}

class _Crumb extends StatelessWidget {
  const _Crumb({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: const BorderRadius.all(UxnanRadius.sm),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.xs,
          vertical: 2,
        ),
        child: Text(label, style: UxnanTypography.codeSmall),
      ),
    );
  }
}

class _DirList extends StatelessWidget {
  const _DirList({required this.dirs, required this.onOpen});
  final List<BrowseDirEntry> dirs;
  final ValueChanged<BrowseDirEntry> onOpen;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    if (dirs.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(UxnanSpacing.md),
        child: Text(AppLocalizations.of(context).workspaceBrowseEmpty),
      );
    }
    return ListView.builder(
      shrinkWrap: true,
      itemCount: dirs.length,
      itemBuilder: (context, index) {
        final dir = dirs[index];
        return ListTile(
          dense: true,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.all(UxnanRadius.md),
          ),
          leading: Icon(
            dir.isGitRepo ? Icons.source_outlined : Icons.folder_outlined,
            color:
                dir.isGitRepo ? UxnanColors.connected : colors.onSurfaceVariant,
          ),
          title: Text(dir.name, style: Theme.of(context).textTheme.bodyMedium),
          subtitle: dir.isGitRepo
              ? Text(
                  AppLocalizations.of(context).workspaceBrowseGitRepo,
                  style: UxnanTypography.codeSmall.copyWith(
                    color: UxnanColors.connected,
                  ),
                )
              : null,
          trailing: Icon(Icons.chevron_right_rounded, color: colors.outline),
          onTap: () => onOpen(dir),
        );
      },
    );
  }
}
