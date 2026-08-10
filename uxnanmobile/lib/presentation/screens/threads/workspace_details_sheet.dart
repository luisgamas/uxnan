import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/agent_run_state_provider.dart';
import 'package:uxnan/presentation/providers/workspace_git_provider.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/agent_status_indicator.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Everything a working folder could say, one long-press away.
///
/// The row itself is a single line by design; this is where the rest lives —
/// the full path, and every conversation in the folder with its state.
/// `uxnandesktop` shows the same on hover; a phone has no hover, so the press
/// carries it.
///
/// Git state (branch, uncommitted changes, ahead/behind) joins this sheet when
/// the per-workspace git provider lands — the row reserves nothing for it, so
/// nothing here reads as missing until then.
Future<void> showWorkspaceDetails(
  BuildContext context,
  WorkspaceGroup group, {
  required String? fullPath,
  required void Function(String threadId) onOpenThread,
}) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (context) => _WorkspaceDetails(
      group: group,
      fullPath: fullPath,
      onOpenThread: onOpenThread,
    ),
  );
}

class _WorkspaceDetails extends ConsumerWidget {
  const _WorkspaceDetails({
    required this.group,
    required this.fullPath,
    required this.onOpenThread,
  });

  final WorkspaceGroup group;
  final String? fullPath;
  final void Function(String threadId) onOpenThread;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final path = fullPath;

    return SafeArea(
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            0,
            UxnanSpacing.lg,
            UxnanSpacing.lg,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                group.label.isEmpty ? l10n.spacesNoFolder : group.label,
                style: textTheme.headlineMedium,
              ),
              if (path != null && path.isNotEmpty) ...[
                const SizedBox(height: UxnanSpacing.md),
                Text(l10n.spacesDetailsPath, style: textTheme.bodySmall),
                const SizedBox(height: 2),
                // Monospace and wrapped whole: a path is read character by
                // character when it is read at all, so truncating it defeats
                // the reason for opening this.
                SelectableText(
                  path,
                  style: UxnanTypography.codeSmall.copyWith(
                    color: colors.onSurface,
                  ),
                ),
                const SizedBox(height: UxnanSpacing.sm),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: path));
                      if (context.mounted) Navigator.of(context).pop();
                    },
                    icon: const UxIcon(UxIcons.copy, size: 18),
                    label: Text(l10n.spacesCopyPath),
                  ),
                ),
              ],
              if (path != null && path.isNotEmpty) ...[
                const SizedBox(height: UxnanSpacing.md),
                _GitDetail(cwd: path),
              ],
              const SizedBox(height: UxnanSpacing.md),
              Text(l10n.spacesConversations, style: textTheme.bodySmall),
              const SizedBox(height: UxnanSpacing.xs),
              for (final thread in group.threads)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: SizedBox(
                    width: 40,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        AgentStatusIndicator(
                          status: ref.watch(agentRunStatusProvider(thread.id)),
                          size: 12,
                        ),
                        const SizedBox(width: UxnanSpacing.xs),
                        AgentLogo(
                          agent: AgentIdParsing.fromWireId(thread.agentId),
                          size: 16,
                        ),
                      ],
                    ),
                  ),
                  title: Text(
                    thread.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  onTap: () {
                    Navigator.of(context).pop();
                    onOpenThread(thread.id);
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The full git picture for a folder — the half the row deliberately leaves
/// out.
///
/// The row carries at most three signals because it has to stay scannable;
/// everything that did not fit lands here, where there is room to spell it: the
/// branch, what it tracks, and the size of the uncommitted work.
class _GitDetail extends ConsumerWidget {
  const _GitDetail({required this.cwd});

  final String cwd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final value = ref.watch(workspaceGitProvider(cwd)).value;
    final git = value?.git;
    if (git == null || git.branch.isEmpty) {
      return Text(
        l10n.workspaceGitUnavailable,
        style: textTheme.bodySmall,
      );
    }

    final totals = git.diffTotals;
    final lines = <String>[
      if (git.upstream != null && git.upstream!.isNotEmpty)
        l10n.workspaceUpstream(git.upstream!)
      else
        l10n.workspaceNoUpstream,
      if (git.changedFiles.isNotEmpty)
        l10n.workspaceDirty(git.changedFiles.length)
      else if (!git.isDirty)
        l10n.workspaceClean,
      if (git.ahead > 0) l10n.workspaceAhead(git.ahead),
      if (git.behind > 0) l10n.workspaceBehind(git.behind),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            UxIcon(
              UxIcons.altRoute,
              size: UxnanSize.iconContentSmall,
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(width: UxnanSpacing.xs),
            Flexible(
              child: Text(
                git.branch,
                style: textTheme.titleSmall,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (value!.stale) ...[
              const SizedBox(width: UxnanSpacing.sm),
              Text(l10n.workspaceGitStale, style: textTheme.bodySmall),
            ],
          ],
        ),
        const SizedBox(height: 2),
        Text(lines.join(' · '), style: textTheme.bodySmall),
        if (totals.additions > 0 || totals.deletions > 0) ...[
          const SizedBox(height: 2),
          Text(
            '+${totals.additions} −${totals.deletions}',
            style: UxnanTypography.codeSmall.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}
