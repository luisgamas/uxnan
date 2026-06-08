import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/threads/thread_tile.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The archived threads of a paired PC. Archived threads are hidden from the
/// main threads list but never deleted; from here the user can reopen them,
/// unarchive (restore to the active list) or delete them — all via the same
/// long-press menu as the active list.
class ArchivedThreadsScreen extends ConsumerWidget {
  /// Creates an [ArchivedThreadsScreen] for the device with [deviceId].
  const ArchivedThreadsScreen({required this.deviceId, super.key});

  /// The PC whose archived threads are shown.
  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final allThreads = ref.watch(threadsProvider).value ?? const <Thread>[];
    final archived = allThreads
        .where((t) => t.status == ThreadStatus.archived)
        .where((t) => t.deviceId == null || t.deviceId == deviceId)
        .toList();

    return Scaffold(
      body: CustomScrollView(
        physics: const BouncingScrollPhysics(
          parent: AlwaysScrollableScrollPhysics(),
        ),
        slivers: [
          SliverAppBar.large(
            floating: true,
            snap: true,
            title: Text(l10n.archivedTitle, overflow: TextOverflow.ellipsis),
          ),
          if (archived.isEmpty)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: _EmptyArchived(),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.lg,
                UxnanSpacing.sm,
                UxnanSpacing.lg,
                UxnanSpacing.lg,
              ),
              sliver: SliverList.separated(
                itemCount: archived.length,
                separatorBuilder: (_, __) =>
                    const SizedBox(height: UxnanSpacing.md),
                itemBuilder: (context, index) =>
                    ThreadTile(thread: archived[index]),
              ),
            ),
        ],
      ),
    );
  }
}

class _EmptyArchived extends StatelessWidget {
  const _EmptyArchived();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.inventory_2_outlined,
              size: 48,
              color: colors.onSurfaceVariant,
              semanticLabel: 'Archived',
            ),
            const SizedBox(height: UxnanSpacing.md),
            Text(l10n.archivedEmpty, style: textTheme.titleSmall),
            const SizedBox(height: UxnanSpacing.xs),
            Text(
              l10n.archivedEmptyBody,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
