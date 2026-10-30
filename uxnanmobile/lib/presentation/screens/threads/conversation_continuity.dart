import 'dart:async';
import 'dart:math';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/value_objects/conversation_transfer.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/screens/conversation/support/model_picker_sheet.dart';
import 'package:uxnan/presentation/screens/threads/new_conversation_screen.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/connected_button_group.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_card.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Continuing a conversation as a NEW one — with another agent, or with the
/// same one as a fork (architecture/02a §5.8.21). The bridge, the owner of the
/// history, prepares the context and records both ends; the phone only asks
/// and shows where things stand. The two actions here are the ones every list
/// and the conversation's own menu offer, so they behave alike everywhere.

/// What an agent is called, by its wire id: the bridge's name for it when
/// listed, the app's own label otherwise.
String agentNameOf(WidgetRef ref, String? agentId) {
  if (agentId == null || agentId.isEmpty) return '';
  final agents = ref.watch(agentsProvider).value ?? const <AgentDescriptor>[];
  return agents.firstWhereOrNull((a) => a.agentId == agentId)?.displayName ??
      AgentVisuals.labelFor(AgentIdParsing.fromWireId(agentId));
}

/// The name of a [TransferStrategy] in the UI.
String transferStrategyLabel(AppLocalizations l10n, TransferStrategy s) =>
    switch (s) {
      TransferStrategy.selection => l10n.transferStrategySelection,
      TransferStrategy.reference => l10n.transferStrategyReference,
      TransferStrategy.fork => l10n.transferStrategyFork,
    };

/// A [TransferStrategy]'s short name, for a segment of a segmented control
/// at phone width — the full name ([transferStrategyLabel]) is for lines that
/// have room, and the sentence below the control says what it does.
String transferStrategySegment(AppLocalizations l10n, TransferStrategy s) =>
    switch (s) {
      TransferStrategy.selection => l10n.transferStrategySelectionShort,
      TransferStrategy.reference => l10n.transferStrategyReferenceShort,
      TransferStrategy.fork => l10n.transferStrategyForkShort,
    };

/// What a [TransferStrategy] does, in one sentence.
String transferStrategyHint(AppLocalizations l10n, TransferStrategy s) =>
    switch (s) {
      TransferStrategy.selection => l10n.transferStrategySelectionHint,
      TransferStrategy.reference => l10n.transferStrategyReferenceHint,
      TransferStrategy.fork => l10n.transferStrategyForkHint,
    };

/// Where a continuation's context stands, in words.
String transferStatusLabel(AppLocalizations l10n, TransferStatus s) =>
    switch (s) {
      TransferStatus.pending => l10n.transferStatusPending,
      TransferStatus.sent => l10n.transferStatusSent,
      TransferStatus.delivered => l10n.transferStatusDelivered,
      TransferStatus.unverifiable => l10n.transferStatusUnverifiable,
    };

/// A token count, short: `850`, `12.4k`.
String compactTokens(int tokens) {
  if (tokens < 1000) return '$tokens';
  final k = tokens / 1000;
  return k >= 100 ? '${k.round()}k' : '${k.toStringAsFixed(1)}k';
}

/// Asks which agent should continue [thread], then makes the continuation
/// (`thread/transfer`) and opens it. Says so when the PC's bridge cannot.
Future<void> continueWithAnotherAgent(
  BuildContext context,
  WidgetRef ref,
  Thread thread,
) async {
  final l10n = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);
  if (!ref.read(bridgeSupportsConversationsProvider)) {
    messenger
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(l10n.transferNeedsBridge)));
    return;
  }
  final made = await ContinueConversationSheet.show(context, source: thread);
  if (made == null || !context.mounted) return;
  unawaited(context.openInPane(AppRoutes.conversation(made.id)));
}

/// Forks [thread] (`thread/fork`): a copy with the same agent, whose first
/// message carries the selected context. Opens the fork.
Future<void> forkConversation(
  BuildContext context,
  WidgetRef ref,
  Thread thread,
) async {
  final l10n = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final forked = await ref.read(threadManagerProvider).forkThread(thread.id);
  if (!context.mounted) return;
  if (forked == null) {
    messenger
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(l10n.threadForkFailed)));
    return;
  }
  unawaited(context.openInPane(AppRoutes.conversation(forked.id)));
}

/// The sheet that continues [source] with another agent: the agent, its
/// model, what to carry over and an optional first message. Resolves with the
/// new conversation, or null when dismissed.
class ContinueConversationSheet extends ConsumerStatefulWidget {
  /// Creates a [ContinueConversationSheet].
  const ContinueConversationSheet({required this.source, super.key});

  /// The conversation being continued.
  final Thread source;

  /// Shows the sheet over the whole window.
  static Future<Thread?> show(BuildContext context, {required Thread source}) =>
      showModalBottomSheet<Thread>(
        context: context,
        useRootNavigator: true,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => ContinueConversationSheet(source: source),
      );

  @override
  ConsumerState<ContinueConversationSheet> createState() =>
      _ContinueConversationSheetState();
}

class _ContinueConversationSheetState
    extends ConsumerState<ContinueConversationSheet> {
  final TextEditingController _message = TextEditingController();
  AgentDescriptor? _agent;
  String? _model;
  TransferStrategy _strategy = TransferStrategy.selection;
  bool _sending = false;

  /// One key for this sheet's request: a retry after a dropped answer finds
  /// the continuation already made instead of making a second.
  late final String _key =
      'm-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _pickModel() async {
    final agent = _agent;
    if (agent == null) return;
    final picked = await ModelPickerSheet.show(
      context,
      agentId: agent.agentId,
      current: _model ?? agent.defaultModel,
    );
    if (picked != null && mounted) setState(() => _model = picked);
  }

  Future<void> _continue() async {
    final agent = _agent;
    if (agent == null) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _sending = true);
    try {
      final made = await ref.read(threadManagerProvider).transferThread(
            sourceThreadId: widget.source.id,
            agentId: agent.agentId,
            model: _model,
            strategy: _strategy,
            message: _message.text,
            clientTransferId: _key,
          );
      if (mounted) Navigator.of(context).pop(made);
    } on Object {
      if (!mounted) return;
      setState(() => _sending = false);
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.transferFailed)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final agents = (ref.watch(agentsProvider).value ?? const [])
        .where((a) => !kHiddenAgentIds.contains(a.agentId))
        .toList();
    final agent = _agent;
    final insets = MediaQuery.viewInsetsOf(context);

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: insets.bottom),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.9,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              0,
              UxnanSpacing.lg,
              UxnanSpacing.lg,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(l10n.transferSheetTitle, style: textTheme.titleLarge),
                const SizedBox(height: UxnanSpacing.xs),
                Text(
                  widget.source.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.titleSmall?.copyWith(color: colors.primary),
                ),
                const SizedBox(height: UxnanSpacing.sm),
                Text(
                  l10n.transferSheetHint,
                  style: textTheme.bodyMedium?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: UxnanSpacing.lg),
                Text(l10n.newThreadAgent, style: textTheme.titleMedium),
                const SizedBox(height: UxnanSpacing.sm),
                if (agents.isEmpty)
                  const Center(child: PolygonLoader())
                else
                  ExpressiveCardGroup(
                    count: agents.length,
                    itemBuilder: (context, index, position) {
                      final candidate = agents[index];
                      return AgentChoiceCard(
                        agent: candidate,
                        position: position,
                        selected: candidate.agentId == agent?.agentId,
                        onTap: candidate.available
                            ? () => setState(() {
                                  _agent = candidate;
                                  _model = null;
                                })
                            : null,
                      );
                    },
                  ),
                if (agent != null) ...[
                  const SizedBox(height: UxnanSpacing.md),
                  NeCard(
                    onTap: _pickModel,
                    child: Row(
                      children: [
                        UxIcon(
                          UxIcons.psychology,
                          size: UxnanSize.iconContent,
                          color: colors.onSurfaceVariant,
                        ),
                        const SizedBox(width: UxnanSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                l10n.newThreadModel,
                                style: textTheme.labelMedium?.copyWith(
                                  color: colors.onSurfaceVariant,
                                ),
                              ),
                              Text(
                                _model ?? agent.defaultModel ?? '—',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: textTheme.titleSmall,
                              ),
                            ],
                          ),
                        ),
                        UxIcon(
                          UxIcons.chevronRight,
                          size: UxnanSize.iconContentSmall,
                          color: colors.onSurfaceVariant,
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: UxnanSpacing.lg),
                Text(l10n.transferStrategy, style: textTheme.titleMedium),
                const SizedBox(height: UxnanSpacing.sm),
                ConnectedButtonGroup<TransferStrategy>(
                  values: TransferStrategy.values,
                  selected: _strategy,
                  onChanged: (value) => setState(() => _strategy = value),
                  labelBuilder: (value, _) => Text(
                    transferStrategySegment(l10n, value),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(height: UxnanSpacing.sm),
                Text(
                  transferStrategyHint(l10n, _strategy),
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: UxnanSpacing.lg),
                TextField(
                  controller: _message,
                  minLines: 2,
                  maxLines: 6,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    labelText: l10n.transferMessage,
                    hintText: l10n.transferMessageHint,
                  ),
                ),
                const SizedBox(height: UxnanSpacing.lg),
                FilledButton(
                  onPressed: agent == null || _sending ? null : _continue,
                  child: _sending
                      ? const SizedBox.square(
                          dimension: UxnanSize.iconContent,
                          child: PolygonLoader(),
                        )
                      : Text(l10n.transferConfirm),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The top of a conversation that continues another one: where it came from,
/// what was carried and whether it reached the agent — the honest status the
/// bridge proved against the real turn, never assumed. Tapping the facts shows
/// exactly what the agent received; the source's title opens it while it
/// exists.
class TransferOriginCard extends ConsumerWidget {
  /// Creates a [TransferOriginCard].
  const TransferOriginCard({required this.thread, super.key});

  /// The continuing conversation (its [Thread.transfer] is set).
  final Thread thread;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final transfer = thread.transfer;
    if (transfer == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final source = ref.watch(threadByIdProvider(transfer.sourceThreadId));
    final agent = agentNameOf(ref, transfer.sourceAgentId);
    final delivered = transfer.status == TransferStatus.delivered;

    return NeCard(
      onTap: () => showTransferContextSheet(context, ref, thread.id),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              UxIcon(
                UxIcons.callSplit,
                size: UxnanSize.iconContent,
                color: colors.primary,
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: Text(
                  l10n.transferOriginTitle(transfer.sourceTitle),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.titleSmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            [
              l10n.transferOriginFacts(
                agent.isEmpty ? '—' : agent,
                compactTokens(transfer.context.approxTokens),
              ),
              transferStrategyLabel(l10n, transfer.strategy),
            ].join(' · '),
            style:
                textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
          ),
          const SizedBox(height: UxnanSpacing.xs),
          Text(
            transferStatusLabel(l10n, transfer.status),
            style: textTheme.labelMedium?.copyWith(
              color: delivered ? colors.primary : colors.onSurfaceVariant,
            ),
          ),
          Wrap(
            spacing: UxnanSpacing.sm,
            children: [
              TextButton(
                onPressed: () =>
                    showTransferContextSheet(context, ref, thread.id),
                child: Text(l10n.transferViewContext),
              ),
              if (source != null)
                TextButton(
                  onPressed: () =>
                      context.openInPane(AppRoutes.conversation(source.id)),
                  child: Text(l10n.transferOpenSource),
                )
              else
                Padding(
                  padding: const EdgeInsets.symmetric(
                    vertical: UxnanSpacing.sm,
                  ),
                  child: Text(
                    l10n.transferSourceGone,
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The end of a conversation that goes on elsewhere: one row per
/// conversation that continues it, each opening it.
class ContinuationsCard extends ConsumerWidget {
  /// Creates a [ContinuationsCard].
  const ContinuationsCard({required this.thread, super.key});

  /// The source conversation (its [Thread.continuations] is not empty).
  final Thread thread;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (thread.continuations.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
          child: Text(
            l10n.continuationsTitle,
            style: textTheme.titleSmall?.copyWith(
              color: colors.onSurfaceVariant,
            ),
          ),
        ),
        ExpressiveCardGroup(
          count: thread.continuations.length,
          itemBuilder: (context, index, position) {
            final next = thread.continuations[index];
            final target = ref.watch(threadByIdProvider(next.threadId));
            final agentId = next.agentId ?? target?.agentId;
            return ExpressiveCard(
              position: position,
              onTap: () =>
                  context.openInPane(AppRoutes.conversation(next.threadId)),
              child: Row(
                children: [
                  if (agentId != null)
                    AgentLogo(agent: AgentIdParsing.fromWireId(agentId)),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(
                    child: Text(
                      l10n.continuationLine(
                        agentNameOf(ref, agentId),
                        target?.title ?? next.threadId,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.titleSmall,
                    ),
                  ),
                  UxIcon(
                    UxIcons.chevronRight,
                    size: UxnanSize.iconContentSmall,
                    color: colors.onSurfaceVariant,
                  ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}

/// Shows what [threadId]'s agent received with its first message — read from
/// the PC (`thread/transferContext`), exactly as the agent reads it.
Future<void> showTransferContextSheet(
  BuildContext context,
  WidgetRef ref,
  String threadId,
) {
  final text = ref.read(threadManagerProvider).transferContext(threadId);
  return showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => _TransferContextView(text: text),
  );
}

class _TransferContextView extends StatelessWidget {
  const _TransferContextView({required this.text});

  final Future<String?> text;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.85,
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            0,
            UxnanSpacing.lg,
            UxnanSpacing.lg,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(l10n.transferContextTitle, style: textTheme.titleLarge),
              const SizedBox(height: UxnanSpacing.md),
              Flexible(
                child: FutureBuilder<String?>(
                  future: text,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Center(child: PolygonLoader());
                    }
                    final body = snapshot.data;
                    if (body == null) {
                      return Text(
                        l10n.transferContextFailed,
                        style: textTheme.bodyMedium?.copyWith(
                          color: colors.error,
                        ),
                      );
                    }
                    return SingleChildScrollView(
                      child: SelectableText(
                        body,
                        style: textTheme.bodySmall,
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
