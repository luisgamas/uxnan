import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/core/utils/clock_format.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/value_objects/agent_session.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/threads/catalog_age.dart';
import 'package:uxnan/presentation/screens/threads/conversation_continuity.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_enter_transition.dart';
import 'package:uxnan/presentation/widgets/session_handoff_message.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// The sessions of [sessions] that pass the catalog's filters — [agentId] (a
/// wire id) and the words of [query] matched against the title — keeping
/// their order (newest first, as the bridge lists them).
///
/// Pure, so the rule is tested without a widget. A session with no title has
/// nothing to match: a query leaves it out.
List<AgentSessionSummary> filterAgentSessions(
  List<AgentSessionSummary> sessions, {
  String? agentId,
  String query = '',
}) {
  final words = query
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((w) => w.isNotEmpty)
      .toList();
  return [
    for (final s in sessions)
      if ((agentId == null || s.agentId == agentId) &&
          (words.isEmpty ||
              (s.title != null &&
                  words.every((w) => s.title!.toLowerCase().contains(w)))))
        s,
  ];
}

/// The catalog's "Agent sessions" view: the agents' own sessions in the
/// folder that no conversation continues yet — started in a terminal on the
/// PC, or in the agent's own app — to pick up as a conversation here
/// (architecture/02a §5.8.19). One open in a terminal says so, and picking it
/// asks that terminal to let it go first, so the session never has two
/// writers.
///
/// This is the one place the app lists them: the new-conversation screen only
/// counts them and points here.
class AgentSessionsView extends ConsumerStatefulWidget {
  /// Creates an [AgentSessionsView] for the sessions in [cwd].
  const AgentSessionsView({
    required this.cwd,
    required this.query,
    required this.onOpen,
    this.agentId,
    super.key,
  });

  /// The folder whose sessions are listed.
  final String cwd;

  /// What the search field holds: matched against titles.
  final String query;

  /// Only this agent's sessions (wire id); every agent's when null.
  final String? agentId;

  /// Opens the conversation a picked session became.
  final void Function(String threadId) onOpen;

  @override
  ConsumerState<AgentSessionsView> createState() => _AgentSessionsViewState();
}

class _AgentSessionsViewState extends ConsumerState<AgentSessionsView> {
  /// The session being picked up (`agentId:sessionId`), while it is.
  String? _picking;

  /// Continue [session] as a conversation: ask the terminal holding it to
  /// let go first, then start a conversation on it.
  Future<void> _pickUp(AgentSessionSummary session) async {
    if (_picking != null) return;
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _picking = session.key);
    try {
      final holds = ref.read(agentSessionHoldsProvider).value ?? const {};
      if (holds[session.key] != null || session.hold != null) {
        final outcome = await ref.read(bridgeReplicaProvider).requestHandoff(
              agentId: session.agentId,
              sessionId: session.sessionId,
            );
        if (!outcome.isFree) {
          if (!mounted) return;
          messenger
            ..clearSnackBars()
            ..showSnackBar(
              SnackBar(content: Text(handoffMessage(l10n, outcome))),
            );
          return;
        }
      }
      final coordinator = ref.read(sessionCoordinatorProvider);
      final thread = await ref.read(threadManagerProvider).startThread(
            agentId: session.agentId,
            cwd: session.cwd,
            title: session.title,
            agentSessionId: session.sessionId,
            deviceId: coordinator.connectedDevice?.macDeviceId,
          );
      if (mounted) widget.onOpen(thread.id);
    } on Object {
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.newThreadFailed)));
    } finally {
      if (mounted) setState(() => _picking = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final listing = ref.watch(agentSessionsProvider(widget.cwd));
    final holds = ref.watch(agentSessionHoldsProvider).value ?? const {};

    Widget note(String text) => SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(UxnanSpacing.xl),
            child: Text(
              text,
              textAlign: TextAlign.center,
              style: textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
        );

    final list = listing.value;
    if (list == null) {
      if (listing.hasError) return note(l10n.catalogSessionsLoadFailed);
      return const SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: UxnanSpacing.xxl),
          child: Center(child: PolygonLoader()),
        ),
      );
    }

    final shown = filterAgentSessions(
      list.sessions,
      agentId: widget.agentId,
      query: widget.query,
    );
    final now = DateTime.now();
    final groups = <CatalogAge, List<AgentSessionSummary>>{};
    for (final s in shown) {
      (groups[CatalogAge.of(now.subtract(s.updatedAgo), now)] ??= []).add(s);
    }
    final unlisted = list.unlisted.map((id) => agentNameOf(ref, id)).join(', ');

    return SliverMainAxisGroup(
      slivers: [
        if (list.sessions.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.xl,
                UxnanSpacing.xs,
                UxnanSpacing.xl,
                UxnanSpacing.sm,
              ),
              child: Text(
                l10n.sessionsSectionHint,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
          ),
        for (final age in CatalogAge.values)
          if (groups[age] case final rows? when rows.isNotEmpty)
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.lg,
                UxnanSpacing.sm,
                UxnanSpacing.lg,
                UxnanSpacing.md,
              ),
              sliver: SliverList.list(
                children: [
                  Padding(
                    padding: const EdgeInsets.only(
                      left: UxnanSpacing.xs,
                      bottom: UxnanSpacing.sm,
                    ),
                    child: Text(
                      switch (age) {
                        CatalogAge.today => l10n.catalogGroupToday,
                        CatalogAge.week => l10n.catalogGroupWeek,
                        CatalogAge.earlier => l10n.catalogGroupEarlier,
                      },
                      style: textTheme.titleSmall?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ),
                  NeEnterTransition(
                    child: ExpressiveCardGroup(
                      count: rows.length,
                      itemBuilder: (context, index, position) {
                        final session = rows[index];
                        return AgentSessionCard(
                          session: session,
                          hold: holds[session.key] ?? session.hold,
                          position: position,
                          busy: _picking == session.key,
                          onTap:
                              _picking == null ? () => _pickUp(session) : null,
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
        if (shown.isEmpty)
          note(
            list.sessions.isEmpty
                ? l10n.catalogSessionsEmpty
                : l10n.catalogNoResults,
          ),
        if (list.unlisted.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: UxnanSpacing.xl,
                vertical: UxnanSpacing.sm,
              ),
              child: Text(
                l10n.sessionsUnlisted(unlisted),
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// One session to pick up: its agent, its name, how long ago it changed, and
/// whether a terminal on the PC has it open right now.
class AgentSessionCard extends StatelessWidget {
  /// Creates an [AgentSessionCard].
  const AgentSessionCard({
    required this.session,
    required this.hold,
    required this.position,
    required this.busy,
    required this.onTap,
    super.key,
  });

  /// The session.
  final AgentSessionSummary session;

  /// The terminal holding it, when one does.
  final AgentSessionHold? hold;

  /// Where it sits in its group.
  final CardGroupPosition position;

  /// Whether it is being picked up right now.
  final bool busy;

  /// Picks it up; null while another pick is in flight.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final hold = this.hold;
    final when = formatWhen(DateTime.now().subtract(session.updatedAgo));
    return Semantics(
      button: true,
      label: l10n.sessionsPickHint,
      child: ExpressiveCard(
        position: position,
        onTap: onTap,
        color: colors.surfaceContainer,
        child: Row(
          children: [
            AgentLogo(
              agent: AgentIdParsing.fromWireId(session.agentId),
              size: UxnanSize.iconContent,
            ),
            const SizedBox(width: UxnanSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.title ??
                        (session.titlePending
                            ? l10n.sessionsNaming
                            : l10n.sessionsUntitled),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.titleSmall?.copyWith(
                      color: session.title == null
                          ? colors.onSurfaceVariant
                          : colors.onSurface,
                    ),
                  ),
                  const SizedBox(height: UxnanSpacing.xs),
                  Row(
                    children: [
                      if (hold != null) ...[
                        UxIcon(
                          UxIcons.terminal,
                          size: 14,
                          color: hold.busy ? colors.tertiary : colors.primary,
                        ),
                        const SizedBox(width: UxnanSpacing.xs),
                        Flexible(
                          child: Text(
                            hold.busy
                                ? l10n.sessionsWorkingInTerminal(
                                    hold.holderName,
                                  )
                                : l10n.sessionsInTerminal(hold.holderName),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: textTheme.labelSmall?.copyWith(
                              color:
                                  hold.busy ? colors.tertiary : colors.primary,
                            ),
                          ),
                        ),
                        Text(
                          '  ·  ',
                          style: textTheme.labelSmall?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                      ],
                      Text(
                        when,
                        style: textTheme.labelSmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            if (busy)
              const PolygonLoader()
            else
              UxIcon(
                UxIcons.chevronRight,
                size: 18,
                color: colors.onSurfaceVariant,
              ),
          ],
        ),
      ),
    );
  }
}
