import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Says what happens to a message drafted while the agent works, in one muted
/// line above the composer.
///
/// The bridge queues every message sent while a turn runs; when it reaches the
/// agent depends on the agent. One that takes messages mid-turn
/// (`capabilities.steering`) gets the first queued one at its next pause — when
/// the step it is in ends — so the line says so whatever the queue holds; any
/// other gets it when the turn ends.
///
/// The screen decides when it shows (a turn runs and a message is drafted);
/// this widget only picks the words.
class ComposerQueueHint extends ConsumerWidget {
  /// Creates a [ComposerQueueHint] for [threadId].
  const ComposerQueueHint({required this.threadId, super.key});

  /// The conversation whose agent the hint describes.
  final String threadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final agentId = ref.watch(threadByIdProvider(threadId))?.agentId;
    // The agent's REPORTED capability, not the permissive default the
    // controls use while it is unknown: this line is a claim about when the
    // message arrives, so an unknown agent gets the conservative one.
    final steers =
        (ref.watch(agentsProvider).value ?? const <AgentDescriptor>[]).any(
      (a) => a.agentId == agentId && a.capabilities.steering,
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.md,
        0,
        UxnanSpacing.md,
        UxnanSpacing.sm,
      ),
      child: Text(
        steers ? l10n.composerNextPauseHint : l10n.composerQueueHint,
        key: ValueKey(
          steers ? 'composer-next-pause-hint' : 'composer-queue-hint',
        ),
        style: textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
      ),
    );
  }
}
