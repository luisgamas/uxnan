import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/core/utils/clock_format.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/agent_run_state.dart';
import 'package:uxnan/domain/enums/client_kind.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/value_objects/agent_session.dart';
import 'package:uxnan/domain/value_objects/thread_search.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/agent_run_state_provider.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/screens/threads/agent_sessions_view.dart';
import 'package:uxnan/presentation/screens/threads/catalog_age.dart';
import 'package:uxnan/presentation/screens/threads/conversation_continuity.dart';
import 'package:uxnan/presentation/screens/threads/thread_list_controls.dart';
import 'package:uxnan/presentation/screens/threads/thread_tile.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/agent_status_indicator.dart';
import 'package:uxnan/presentation/widgets/connected_button_group.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_enter_transition.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// What the catalog lists.
enum CatalogView {
  /// The PC's conversations — the catalog proper.
  conversations,

  /// The agents' own sessions in a folder, outside Uxnan, to pick up as a
  /// conversation (architecture/02a §5.8.19).
  sessions,
}

/// What a conversation is doing, as the catalog filters it.
enum CatalogState {
  /// No filter.
  any,

  /// A turn is running.
  working,

  /// It waits on the person, or something holds it.
  needsYou,

  /// Its last turn finished and was not read.
  done,

  /// Nothing happening.
  idle;

  /// Whether [state] passes this filter.
  bool admits(AgentRunState state) => switch (this) {
        CatalogState.any => true,
        CatalogState.working => state == AgentRunState.working,
        CatalogState.needsYou =>
          state == AgentRunState.waiting || state == AgentRunState.blocked,
        CatalogState.done => state == AgentRunState.done,
        CatalogState.idle => state == AgentRunState.idle,
      };
}

/// The filters the catalog applies to the PC's conversations — pure, so the
/// rules are tested without a widget.
class CatalogFilters {
  /// Creates [CatalogFilters].
  const CatalogFilters({
    this.projectId,
    this.agentId,
    this.origin,
    this.includeArchived = false,
  });

  /// Only this project's conversations (by `Thread.projectId`).
  final String? projectId;

  /// Only this agent's (wire id).
  final String? agentId;

  /// Only the ones started on this kind of client.
  final ClientKind? origin;

  /// Whether archived ones are listed too.
  final bool includeArchived;

  /// The conversations of [threads] that pass, keeping their order.
  List<Thread> apply(List<Thread> threads) => [
        for (final t in threads)
          if ((includeArchived || t.status != ThreadStatus.archived) &&
              (projectId == null || t.projectId == projectId) &&
              (agentId == null || t.agentId == agentId) &&
              (origin == null || t.origin?.kind == origin))
            t,
      ];
}

/// Every conversation of a PC, searchable — the phone's catalog, the same one
/// Uxnan Desktop shows in its Conversations tab (architecture/02a §5.8.21).
///
/// Titles are matched here, instantly, over the replica this phone holds.
/// What was SAID is answered by the bridge (`thread/search`): it owns the
/// history and keeps a digest of it, while the phone holds only the
/// conversations it has opened. The two are listed apart, so it is always clear
/// which ones matched by name and which by content.
///
/// Opened for a folder ([sessionsCwd]), it also lists that folder's agent
/// sessions — the ones an agent had in a terminal or its own app, that no
/// conversation continues yet — as a second view, [CatalogView.sessions]:
/// the one place the app lists them.
class ConversationCatalogScreen extends ConsumerStatefulWidget {
  /// Creates a [ConversationCatalogScreen].
  const ConversationCatalogScreen({
    required this.deviceId,
    required this.onOpen,
    this.projectId,
    this.sessionsCwd,
    this.initialView = CatalogView.conversations,
    super.key,
  });

  /// The PC whose conversations are listed.
  final String deviceId;

  /// The project it was opened for — offered as the "This project" scope,
  /// chosen at first. Null lists every conversation.
  final String? projectId;

  /// The folder whose agent sessions the catalog can also list. Null: only
  /// conversations, with no view switch.
  final String? sessionsCwd;

  /// The view shown first; [CatalogView.conversations] when there is no
  /// [sessionsCwd] to list sessions of.
  final CatalogView initialView;

  /// Opens a conversation; the catalog has already closed itself.
  final void Function(String threadId) onOpen;

  /// Pushes the catalog over [context]'s navigator. Opening a conversation
  /// closes it and then calls [onOpen] — by default, opening it in the pane.
  static Future<void> push(
    BuildContext context, {
    required String deviceId,
    String? projectId,
    String? sessionsCwd,
    CatalogView initialView = CatalogView.conversations,
    void Function(String threadId)? onOpen,
  }) {
    final navigator = Navigator.of(context);
    late final MaterialPageRoute<void> route;
    route = MaterialPageRoute<void>(
      builder: (_) => ConversationCatalogScreen(
        deviceId: deviceId,
        projectId: projectId,
        sessionsCwd: sessionsCwd,
        initialView: initialView,
        onOpen: (id) {
          if (route.isActive) navigator.removeRoute(route);
          if (onOpen != null) {
            onOpen(id);
          } else if (context.mounted) {
            unawaited(context.openInPane(AppRoutes.conversation(id)));
          }
        },
      ),
    );
    return navigator.push(route);
  }

  @override
  ConsumerState<ConversationCatalogScreen> createState() =>
      _ConversationCatalogScreenState();
}

class _ConversationCatalogScreenState
    extends ConsumerState<ConversationCatalogScreen> {
  final TextEditingController _query = TextEditingController();
  Timer? _debounce;
  late bool _inProject = widget.projectId != null;
  late CatalogView _view = widget.sessionsCwd == null
      ? CatalogView.conversations
      : widget.initialView;
  String? _agentId;
  ClientKind? _origin;
  CatalogState _state = CatalogState.any;
  bool _archived = false;

  // What the bridge answered for the current query.
  List<ThreadSearchHit> _hits = const [];
  String? _cursor;
  bool _searching = false;
  bool _searchFailed = false;
  int _generation = 0;

  static const Duration _debounceDelay = Duration(milliseconds: 250);

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  String get _trimmed => _query.text.trim();

  /// Whether the bridge can be asked what was said: it can, and it is this
  /// PC's, live. Kept from the last build, which watches both.
  bool _canSearchContent = false;

  bool get _inSessions => _view == CatalogView.sessions;

  void _onQueryChanged(String _) {
    _debounce?.cancel();
    setState(() {
      _hits = const [];
      _cursor = null;
      _searchFailed = false;
    });
    // Sessions are matched by title, here; the bridge searches conversations.
    if (_inSessions) {
      _generation++;
      setState(() => _searching = false);
      return;
    }
    if (_trimmed.length < kThreadSearchMinQueryChars || !_canSearchContent) {
      _generation++;
      setState(() => _searching = false);
      return;
    }
    _debounce = Timer(_debounceDelay, () => unawaited(_search()));
  }

  /// Asks the bridge for (more of) what was said; an answer to an older
  /// query, or older filters, is dropped.
  Future<void> _search({bool more = false}) async {
    final generation = more ? _generation : ++_generation;
    final query = _trimmed;
    setState(() => _searching = true);
    try {
      final page = await ref.read(threadManagerProvider).searchThreads(
            query,
            projectId: _inProject ? widget.projectId : null,
            includeArchived: _archived,
            cursor: more ? _cursor : null,
          );
      if (!mounted || generation != _generation) return;
      setState(() {
        _hits = more ? [..._hits, ...page.hits] : page.hits;
        _cursor = page.nextCursor;
        _searching = false;
      });
    } on Object {
      if (!mounted || generation != _generation) return;
      setState(() {
        _searching = false;
        _searchFailed = true;
      });
    }
  }

  /// A filter the bridge also applies changed: ask again.
  void _refilter(VoidCallback change) {
    setState(change);
    _onQueryChanged(_query.text);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final all = (ref.watch(threadsProvider).value ?? const <Thread>[])
        .where((t) => t.deviceId == null || t.deviceId == widget.deviceId)
        .toList();
    final projects =
        ref.watch(projectsProvider(widget.deviceId)).value ?? const <Project>[];
    final projectNames = {for (final p in projects) p.id: p.name};
    final filters = CatalogFilters(
      projectId: _inProject ? widget.projectId : null,
      agentId: _agentId,
      origin: _origin,
      includeArchived: _archived,
    );
    bool admitted(Thread t) =>
        _state.admits(ref.watch(agentRunStatusProvider(t.id)).state);
    final scoped = sortThreads(
      filters.apply(all).where(admitted).toList(),
      ListSort.activity,
    );
    final byId = {for (final t in all) t.id: t};
    final agentIds = {for (final t in all) t.agentId}.toList()..sort();
    // The agents that have a session here, for the sessions view's filter.
    final sessionAgentIds = widget.sessionsCwd == null
        ? const <String>[]
        : ({
            for (final s in ref
                    .watch(agentSessionsProvider(widget.sessionsCwd!))
                    .value
                    ?.sessions ??
                const <AgentSessionSummary>[])
              s.agentId,
          }.toList()
          ..sort());
    final query = _trimmed;
    final searching = query.isNotEmpty;
    _canSearchContent = ref.watch(bridgeSupportsConversationsProvider) &&
        ref.watch(connectedDeviceProvider).value?.macDeviceId ==
            widget.deviceId;

    final slivers = <Widget>[
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.lg,
            UxnanSpacing.sm,
            UxnanSpacing.lg,
            UxnanSpacing.sm,
          ),
          child: SearchBar(
            controller: _query,
            hintText: _inSessions
                ? l10n.catalogSessionsSearchHint
                : l10n.catalogSearchHint,
            leading: const UxIcon(UxIcons.search),
            trailing: [
              if (query.isNotEmpty)
                IconButton(
                  tooltip:
                      MaterialLocalizations.of(context).deleteButtonTooltip,
                  icon: const UxIcon(UxIcons.close),
                  onPressed: () {
                    _query.clear();
                    _onQueryChanged('');
                  },
                ),
            ],
            onChanged: _onQueryChanged,
            elevation: const WidgetStatePropertyAll(0),
          ),
        ),
      ),
      if (widget.sessionsCwd != null)
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              0,
              UxnanSpacing.lg,
              UxnanSpacing.sm,
            ),
            child: ConnectedButtonGroup<CatalogView>(
              values: CatalogView.values,
              selected: _view,
              onChanged: _switchView,
              labelBuilder: (view, _) => Text(
                view == CatalogView.conversations
                    ? l10n.catalogViewConversations
                    : l10n.catalogViewSessions,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        ),
      SliverToBoxAdapter(
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.lg),
          child: Row(
            children: _inSessions
                ? [
                    _MenuChip<String?>(
                      label: _agentId == null
                          ? l10n.catalogFilterAgent
                          : agentNameOf(ref, _agentId),
                      active: _agentId != null,
                      options: [
                        (null, l10n.catalogAnyAgent),
                        for (final id in sessionAgentIds)
                          (id, agentNameOf(ref, id)),
                      ],
                      onSelected: (id) => setState(() => _agentId = id),
                    ),
                  ]
                : [
                    if (widget.projectId != null) ...[
                      ChoiceChip(
                        label: Text(l10n.catalogScopeProject),
                        selected: _inProject,
                        onSelected: (_) => _refilter(() => _inProject = true),
                      ),
                      const SizedBox(width: UxnanSpacing.xs),
                      ChoiceChip(
                        label: Text(l10n.catalogScopeAll),
                        selected: !_inProject,
                        onSelected: (_) => _refilter(() => _inProject = false),
                      ),
                      const SizedBox(width: UxnanSpacing.md),
                    ],
                    _MenuChip<String?>(
                      label: _agentId == null
                          ? l10n.catalogFilterAgent
                          : agentNameOf(ref, _agentId),
                      active: _agentId != null,
                      options: [
                        (null, l10n.catalogAnyAgent),
                        for (final id in agentIds) (id, agentNameOf(ref, id)),
                      ],
                      onSelected: (id) => setState(() => _agentId = id),
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                    _MenuChip<CatalogState>(
                      label: _state == CatalogState.any
                          ? l10n.catalogFilterState
                          : _stateLabel(l10n, _state),
                      active: _state != CatalogState.any,
                      options: [
                        for (final s in CatalogState.values)
                          (s, _stateLabel(l10n, s)),
                      ],
                      onSelected: (s) => setState(() => _state = s),
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                    _MenuChip<ClientKind?>(
                      label: _origin == null
                          ? l10n.catalogFilterOrigin
                          : _originLabel(l10n, _origin),
                      active: _origin != null,
                      options: [
                        (null, l10n.catalogOriginAny),
                        (ClientKind.phone, l10n.catalogOriginPhone),
                        (ClientKind.desktop, l10n.catalogOriginDesktop),
                      ],
                      onSelected: (o) => setState(() => _origin = o),
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                    FilterChip(
                      label: Text(l10n.catalogFilterArchived),
                      selected: _archived,
                      onSelected: (v) => _refilter(() => _archived = v),
                    ),
                  ],
          ),
        ),
      ),
      const SliverToBoxAdapter(child: SizedBox(height: UxnanSpacing.md)),
      if (_inSessions)
        AgentSessionsView(
          cwd: widget.sessionsCwd!,
          query: query,
          agentId: _agentId,
          onOpen: _open,
        )
      else
        ...searching
            ? _searchSlivers(
                context,
                scoped,
                byId,
                filters,
                admitted,
                projectNames,
              )
            : _ageSlivers(context, scoped, projectNames),
      const SliverToBoxAdapter(child: SizedBox(height: UxnanSpacing.xxl)),
    ];

    return NeScaffold(
      title: l10n.catalogTitle,
      leading: IconButton(
        icon: const UxIcon(UxIcons.arrowBack),
        tooltip: MaterialLocalizations.of(context).backButtonTooltip,
        onPressed: () => Navigator.of(context).maybePop(),
      ),
      automaticBackButton: false,
      slivers: [
        ...slivers,
        if (!_inSessions && scoped.isEmpty && !searching)
          SliverFillRemaining(
            hasScrollBody: false,
            child: Center(
              child: Text(
                l10n.catalogNoResults,
                style: textTheme.bodyMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
          ),
      ],
    );
  }

  List<Widget> _ageSlivers(
    BuildContext context,
    List<Thread> threads,
    Map<String, String> projectNames,
  ) {
    final l10n = AppLocalizations.of(context);
    final now = DateTime.now();
    final groups = <CatalogAge, List<Thread>>{};
    for (final t in threads) {
      (groups[CatalogAge.of(t.lastActivity ?? t.createdAt, now)] ??= []).add(t);
    }
    return [
      for (final age in CatalogAge.values)
        if (groups[age] case final rows? when rows.isNotEmpty)
          _Section(
            title: switch (age) {
              CatalogAge.today => l10n.catalogGroupToday,
              CatalogAge.week => l10n.catalogGroupWeek,
              CatalogAge.earlier => l10n.catalogGroupEarlier,
            },
            threads: rows,
            projectNames: projectNames,
            onOpen: _open,
          ),
    ];
  }

  List<Widget> _searchSlivers(
    BuildContext context,
    List<Thread> scoped,
    Map<String, Thread> byId,
    CatalogFilters filters,
    bool Function(Thread) admitted,
    Map<String, String> projectNames,
  ) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final titled = matchThreads(scoped, _trimmed);
    final titledIds = {for (final t in titled) t.id};
    // The bridge's hits, through the same filters as the rest — it applied the
    // scope and the archive; agent, origin and state are the phone's.
    final content = <(Thread, ThreadSearchHit)>[
      for (final hit in _hits)
        if (byId[hit.threadId] case final thread?
            when !titledIds.contains(thread.id) &&
                hit.matches.isNotEmpty &&
                filters.apply([thread]).isNotEmpty &&
                admitted(thread))
          (thread, hit),
    ];
    String? note;
    if (_trimmed.length >= kThreadSearchMinQueryChars) {
      if (!ref.watch(bridgeSupportsConversationsProvider)) {
        note = l10n.catalogContentUnavailable;
      } else if (ref.watch(connectedDeviceProvider).value?.macDeviceId !=
          widget.deviceId) {
        note = l10n.catalogContentOffline;
      } else if (_searchFailed) {
        note = l10n.catalogSearchFailed;
      }
    }
    final nothing =
        titled.isEmpty && content.isEmpty && !_searching && _cursor == null;
    return [
      if (titled.isNotEmpty)
        _Section(
          title: l10n.catalogTitlesSection,
          threads: titled,
          projectNames: projectNames,
          onOpen: _open,
        ),
      if (content.isNotEmpty)
        _Section(
          title: l10n.catalogContentSection,
          threads: [for (final (t, _) in content) t],
          hits: {for (final (t, h) in content) t.id: h},
          projectNames: projectNames,
          onOpen: _open,
        ),
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.lg,
            vertical: UxnanSpacing.sm,
          ),
          child: Column(
            children: [
              if (_searching)
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const PolygonLoader(),
                    const SizedBox(width: UxnanSpacing.sm),
                    Text(l10n.catalogSearching, style: textTheme.bodySmall),
                  ],
                )
              else if (_cursor != null)
                TextButton.icon(
                  onPressed: () => unawaited(_search(more: true)),
                  icon: const UxIcon(UxIcons.search, size: 18),
                  label: Text(l10n.catalogLoadMore),
                ),
              if (note != null)
                Text(
                  note,
                  textAlign: TextAlign.center,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              if (nothing && note == null)
                Padding(
                  padding: const EdgeInsets.all(UxnanSpacing.xl),
                  child: Text(
                    l10n.catalogNoResults,
                    style: textTheme.bodyMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    ];
  }

  void _open(String threadId) => widget.onOpen(threadId);

  /// Switches between the conversations and the folder's agent sessions: the
  /// agent filter and the query belong to the view they were typed in.
  void _switchView(CatalogView view) {
    if (view == _view) return;
    _debounce?.cancel();
    _generation++;
    setState(() {
      _view = view;
      _agentId = null;
      _query.clear();
      _hits = const [];
      _cursor = null;
      _searching = false;
      _searchFailed = false;
    });
  }

  static String _stateLabel(AppLocalizations l10n, CatalogState s) =>
      switch (s) {
        CatalogState.any => l10n.catalogStateAny,
        CatalogState.working => l10n.catalogStateWorking,
        CatalogState.needsYou => l10n.catalogStateNeedsYou,
        CatalogState.done => l10n.catalogStateDone,
        CatalogState.idle => l10n.catalogStateIdle,
      };

  static String _originLabel(AppLocalizations l10n, ClientKind? o) =>
      switch (o) {
        null => l10n.catalogOriginAny,
        ClientKind.phone => l10n.catalogOriginPhone,
        ClientKind.desktop => l10n.catalogOriginDesktop,
      };
}

/// A filter chip that opens its options as a menu under it — the same menu
/// surface as every other menu (`kNeMenuConstraints` via the popup theme).
class _MenuChip<T> extends StatelessWidget {
  const _MenuChip({
    required this.label,
    required this.active,
    required this.options,
    required this.onSelected,
  });

  final String label;
  final bool active;
  final List<(T, String)> options;
  final ValueChanged<T> onSelected;

  @override
  Widget build(BuildContext context) {
    return Builder(
      builder: (chipContext) => FilterChip(
        label: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label),
            const SizedBox(width: UxnanSpacing.xs),
            const UxIcon(UxIcons.arrowDropDown, size: 18),
          ],
        ),
        selected: active,
        showCheckmark: false,
        onSelected: (_) async {
          final box = chipContext.findRenderObject()! as RenderBox;
          final overlay =
              Overlay.of(chipContext).context.findRenderObject()! as RenderBox;
          final origin = box.localToGlobal(
            Offset(0, box.size.height),
            ancestor: overlay,
          );
          final picked = await showMenu<(T,)>(
            context: chipContext,
            position: RelativeRect.fromLTRB(
              origin.dx,
              origin.dy,
              overlay.size.width - origin.dx,
              0,
            ),
            items: [
              for (final (value, text) in options)
                PopupMenuItem<(T,)>(value: (value,), child: Text(text)),
            ],
          );
          if (picked != null) onSelected(picked.$1);
        },
      ),
    );
  }
}

/// One headed group of rows: a dynamic-corner card group under a label.
class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.threads,
    required this.projectNames,
    required this.onOpen,
    this.hits = const {},
  });

  final String title;
  final List<Thread> threads;
  final Map<String, ThreadSearchHit> hits;
  final Map<String, String> projectNames;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(
        UxnanSpacing.lg,
        UxnanSpacing.sm,
        UxnanSpacing.lg,
        UxnanSpacing.md,
      ),
      // The section rises into place as one block (NE motion): its rows are
      // one card group, which a per-row stagger would tear apart.
      sliver: SliverList.list(
        children: [
          Padding(
            padding: const EdgeInsets.only(
              left: UxnanSpacing.xs,
              bottom: UxnanSpacing.sm,
            ),
            child: Text(
              title,
              style: textTheme.titleSmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
          NeEnterTransition(
            child: ExpressiveCardGroup(
              count: threads.length,
              itemBuilder: (context, index, position) => CatalogRow(
                thread: threads[index],
                position: position,
                hit: hits[threads[index].id],
                projectName: projectNames[threads[index].projectId],
                onOpen: onOpen,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One conversation in the catalog: its agent, its title, where it runs and
/// where it was started, what it is doing and how long ago it moved — and,
/// for a content match, the words that matched.
class CatalogRow extends ConsumerWidget {
  /// Creates a [CatalogRow].
  const CatalogRow({
    required this.thread,
    required this.onOpen,
    this.position = CardGroupPosition.single,
    this.hit,
    this.projectName,
    super.key,
  });

  /// The conversation.
  final Thread thread;

  /// Where it sits in its group.
  final CardGroupPosition position;

  /// What the bridge matched in it, for a content result.
  final ThreadSearchHit? hit;

  /// Its project's name, when its project is registered.
  final String? projectName;

  /// Opens it.
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final where = projectName ??
        (thread.cwd == null
            ? l10n.spacesOtherConversations
            : workspaceLabel(thread.cwd!));
    final origin = thread.origin?.name;
    final when = thread.lastActivity ?? thread.createdAt;
    final match = hit?.matches.firstOrNull;
    return ExpressiveCard(
      position: position,
      onTap: () => onOpen(thread.id),
      onLongPress: () => showThreadActions(
        context,
        ref,
        thread,
        onDelete: () async {
          if (await confirmDeleteThread(context, thread)) {
            await ref.read(threadManagerProvider).deleteThread(thread.id);
          }
        },
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: AgentLogo(
              agent: AgentIdParsing.fromWireId(thread.agentId),
              size: UxnanSize.iconContent,
            ),
          ),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  thread.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.titleSmall,
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    where,
                    if (origin != null && origin.isNotEmpty) origin,
                    if (thread.status == ThreadStatus.archived)
                      l10n.catalogFilterArchived,
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                if (match != null) ...[
                  const SizedBox(height: UxnanSpacing.xs),
                  _Snippet(
                    match: match,
                    who: match.fromUser
                        ? l10n.catalogMatchYou
                        : agentNameOf(ref, thread.agentId),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: UxnanSpacing.sm),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              AgentStatusIndicator(
                status: ref.watch(agentRunStatusProvider(thread.id)),
                size: UxnanSize.iconContentSmall,
              ),
              if (when != null) ...[
                const SizedBox(height: UxnanSpacing.xs),
                Text(
                  formatWhen(when),
                  style: textTheme.labelSmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

/// The words around a content match, the match itself picked out.
class _Snippet extends StatelessWidget {
  const _Snippet({required this.match, required this.who});

  final ThreadSearchMatch match;
  final String who;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final base = Theme.of(context)
        .textTheme
        .bodySmall
        ?.copyWith(color: colors.onSurfaceVariant);
    // Two lines on a phone: keep a little of what leads to the match and cut
    // the rest, so the match itself is never the part that is ellipsized.
    var s = match.snippet;
    var start = match.matchStart;
    const lead = 24;
    if (start > lead) {
      s = '…${s.substring(start - lead)}';
      start = lead + 1;
    }
    final end = start + match.matchLength;
    return Text.rich(
      TextSpan(
        style: base,
        children: [
          TextSpan(
            text: '$who: ',
            style: base?.copyWith(fontWeight: FontWeight.w600),
          ),
          TextSpan(text: s.substring(0, start)),
          TextSpan(
            text: s.substring(start, end),
            style: base?.copyWith(
              color: colors.primary,
              fontWeight: FontWeight.w700,
            ),
          ),
          TextSpan(text: s.substring(end)),
        ],
      ),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    );
  }
}
