import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/coordinators/session_coordinator.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart'
    show FileBrowserManager;
import 'package:uxnan/application/managers/git_action_manager.dart';
import 'package:uxnan/application/managers/push_registrar.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/managers/workspace_browser.dart';
import 'package:uxnan/application/processors/incoming_message_processor.dart';
import 'package:uxnan/application/services/git_status_bus.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/agent_descriptor.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/auth_status.dart';
import 'package:uxnan/domain/entities/bridge_status.dart';
import 'package:uxnan/domain/entities/connection_recovery_state.dart';
import 'package:uxnan/domain/entities/git/git_action_log_entry.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/context_indicator_mode.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/services/pairing_validator.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';
import 'package:uxnan/domain/value_objects/git/git_action_progress.dart';
import 'package:uxnan/domain/value_objects/git/git_status_change.dart'
    show GitStatusChange;
import 'package:uxnan/domain/value_objects/notification_preferences.dart';
import 'package:uxnan/domain/value_objects/turn_timeline_snapshot.dart';
import 'package:uxnan/infrastructure/transport/secure_transport_layer.dart';
import 'package:uxnan/infrastructure/transport/transport_selector.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/screens/threads/thread_list_controls.dart'
    show ThreadSort;
import 'package:uxnan/presentation/theme/uxnan_theme.dart' show ThemeSource;
import 'package:uxnan/presentation/widgets/agent_visuals.dart';

/// Application-layer providers (coordinators and their derived UI state).
///
/// The coordinator owns connection state and exposes it as streams; the UI
/// consumes those through the `StreamProvider`s below (spec 03 §1.3).

/// The E2EE handshake + channel layer.
final secureTransportLayerProvider =
    Provider<SecureTransportLayer>((ref) => SecureTransportLayer());

/// Chooses and opens the transport for a device: direct LAN/Tailscale hosts
/// first, then the relay fallback (spec 02a §5.9.3).
final transportSelectorProvider = Provider<TransportSelector>(
  (ref) => DirectTransportSelector(WebSocketChannelTransport.new),
);

/// Validates pairing QR payloads.
final pairingValidatorProvider =
    Provider<PairingValidator>((ref) => const PairingValidator());

/// The session coordinator (connection lifecycle, reconnection, RPC, pairing).
final sessionCoordinatorProvider = Provider<SessionCoordinator>((ref) {
  final coordinator = SessionCoordinator(
    secureTransport: ref.watch(secureTransportLayerProvider),
    transportSelector: ref.watch(transportSelectorProvider),
    identityResolver: () => ref.read(phoneIdentityStoreProvider).loadOrCreate(),
    trustedDeviceRepository: ref.watch(trustedDeviceRepositoryProvider),
    pairingValidator: ref.watch(pairingValidatorProvider),
  );
  ref.onDispose(coordinator.dispose);
  return coordinator;
});

/// Current connection phase, as a stream for the UI.
final connectionPhaseProvider = StreamProvider<ConnectionPhase>(
  (ref) => ref.watch(sessionCoordinatorProvider).connectionPhaseStream,
);

/// Reconnection recovery state, as a stream for the UI.
final connectionRecoveryProvider = StreamProvider<ConnectionRecoveryState>(
  (ref) => ref.watch(sessionCoordinatorProvider).recoveryStateStream,
);

/// The active bridge device, as a stream for the UI.
final activeMacProvider = StreamProvider<TrustedDevice?>(
  (ref) => ref.watch(sessionCoordinatorProvider).activeMacStream,
);

/// The device that currently has a LIVE channel (or null). Drives the truthful
/// per-device "connected" indicator — distinct from the browsed/selected device.
final connectedDeviceProvider = StreamProvider<TrustedDevice?>(
  (ref) => ref.watch(sessionCoordinatorProvider).connectedDeviceStream,
);

/// The device a connection attempt is in flight for (or null) — drives the
/// per-device "connecting" indicator without flipping the others.
final connectingDeviceProvider = StreamProvider<TrustedDevice?>(
  (ref) => ref.watch(sessionCoordinatorProvider).connectingDeviceStream,
);

/// The connected bridge's status (`bridge/status`), refreshed whenever the
/// connected device changes. Null while not connected or against an older
/// bridge — short-circuits before touching the session when offline. Drives the
/// relay-vs-direct transport indicator on the connected device.
final bridgeStatusProvider = FutureProvider<BridgeStatus?>((ref) async {
  final connected = ref.watch(connectedDeviceProvider).value;
  if (connected == null) return null;
  final response =
      await ref.watch(sessionCoordinatorProvider).sendRequest('bridge/status');
  final result = response.result;
  return result is Map
      ? BridgeStatus.fromJson(result.cast<String, dynamic>())
      : null;
});

/// Reactive list of paired trusted devices (PCs), for the UI.
final trustedDevicesProvider = StreamProvider<List<TrustedDevice>>(
  (ref) => ref.watch(trustedDeviceRepositoryProvider).watchDevices(),
);

/// Classifies inbound bridge notifications into domain events.
final incomingMessageProcessorProvider =
    Provider<IncomingMessageProcessor>((ref) {
  return const IncomingMessageProcessor();
});

/// Process-wide broadcast bus for `git/status` updates. Producers
/// ([GitActionManager] after every commit/push/pull/etc, [FileBrowserManager]
/// on its own refresh) `emit` a [GitStatusChange] here; consumers
/// (the file browser, today) repaint from the payload without re-fetching.
///
/// One instance per app, disposed with the providers.
final gitStatusBusProvider = Provider<GitStatusBus>((ref) {
  final bus = GitStatusBus();
  ref.onDispose(bus.dispose);
  return bus;
});

/// Coordinates threads and the active conversation timeline.
final threadManagerProvider = Provider<ThreadManager>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  final processor = ref.watch(incomingMessageProcessorProvider);
  final manager = ThreadManager(
    threadRepository: ref.watch(threadRepositoryProvider),
    messageRepository: ref.watch(messageRepositoryProvider),
    domainEvents: processor.bind(coordinator.incomingMessages),
    sendRequest: coordinator.sendRequest,
    // A reply in a thread the user isn't viewing is marked unread.
    foregroundThreadId: () => ref.read(foregroundThreadProvider),
  );
  ref.onDispose(manager.dispose);
  return manager;
});

/// Set of thread ids with an unread agent reply, for the list's unread style.
final unreadThreadsProvider = StreamProvider<Set<String>>(
  (ref) => ref.watch(threadManagerProvider).unreadStream,
);

/// Whether the thread with the given id has an unread agent reply.
final unreadForProvider = Provider.family<bool, String>(
  (ref, threadId) =>
      ref.watch(unreadThreadsProvider).value?.contains(threadId) ?? false,
);

/// Reactive list of threads, for the UI.
final threadsProvider = StreamProvider<List<Thread>>(
  (ref) => ref.watch(threadManagerProvider).threadsStream,
);

/// Map of threadId → live [ThreadActivity] (running/error); idle threads are
/// absent. Drives the per-thread activity indicator on the list.
final threadActivityProvider = StreamProvider<Map<String, ThreadActivity>>(
  (ref) => ref.watch(threadManagerProvider).activityStream,
);

/// The live activity for one thread (idle when not present in the map).
final threadActivityForProvider =
    Provider.family<ThreadActivity, String>((ref, threadId) {
  final map = ref.watch(threadActivityProvider).value;
  return map?[threadId] ?? ThreadActivity.idle;
});

/// Map of threadId → most recent turn token usage, for the context indicator.
final contextUsageProvider =
    StreamProvider<Map<String, ({int tokens, int? contextWindow})>>(
  (ref) => ref.watch(threadManagerProvider).contextUsageStream,
);

/// Token usage for one thread (null until its first turn completes).
final contextUsageForProvider =
    Provider.family<({int tokens, int? contextWindow})?, String>((
  ref,
  threadId,
) {
  return ref.watch(contextUsageProvider).value?[threadId];
});

/// The active thread's timeline, for the UI.
final activeTimelineProvider = StreamProvider<TurnTimelineSnapshot>(
  (ref) => ref.watch(threadManagerProvider).timelineStream,
);

/// The thread with the given id (from the reactive thread list), for the UI.
final threadByIdProvider = Provider.family<Thread?, String>((ref, threadId) {
  final threads = ref.watch(threadsProvider).value ?? const <Thread>[];
  for (final thread in threads) {
    if (thread.id == threadId) return thread;
  }
  return null;
});

/// The bridge's projects (`project/list`) for the new-conversation flow.
final projectsProvider = FutureProvider<List<Project>>(
  (ref) => ref.watch(threadManagerProvider).loadProjects(),
);

/// Navigates the bridge's browse roots (`workspace/browseDirs`) for the
/// folder picker in the new-conversation flow.
final workspaceBrowserProvider = Provider<WorkspaceBrowser>(
  (ref) => WorkspaceBrowser(ref.watch(sessionCoordinatorProvider).sendRequest),
);

/// The bridge's agents (`agent/list`) for the new-conversation flow.
final agentsProvider = FutureProvider<List<AgentDescriptor>>(
  (ref) => ref.watch(threadManagerProvider).loadAgents(),
);

/// The models a given agent reports (`agent/models`), for the model picker.
final agentModelsProvider = FutureProvider.family<List<AgentModel>, String>(
  (ref, agentId) => ref.watch(threadManagerProvider).loadModels(agentId),
);

/// The sanitized auth status the bridge reports for an agent (`auth/status`),
/// or null when unavailable (offline, or an older bridge). Drives the
/// "requires login" banner on the conversation screen. Resolves to an
/// AsyncError while offline; consumers read `.value` so a missing status simply
/// shows no banner.
/// A tick [authStatusProvider] watches so it can be re-fetched on demand. The
/// PC's per-agent sign-in state can change WITHOUT any phone-side connection
/// change (the user logs the CLI in/out on the PC), so bumping this on app
/// resume re-queries `auth/status` and clears a stale "not signed in" state.
class AuthStatusRefresh extends Notifier<int> {
  @override
  int build() => 0;

  /// Forces every [authStatusProvider] to re-fetch.
  void bump() => state = state + 1;
}

/// Drives on-demand refresh of [authStatusProvider].
final authStatusRefreshProvider =
    NotifierProvider<AuthStatusRefresh, int>(AuthStatusRefresh.new);

/// The sanitized per-agent auth status (`auth/status`), or null when unknown.
/// Re-fetched whenever [authStatusRefreshProvider] bumps (e.g. on app resume),
/// so a sign-in/out done on the PC is picked up without a phone reconnect.
final authStatusProvider = FutureProvider.family<AuthStatus?, String>(
  (ref, agentId) {
    // Re-fetch whenever the refresh tick bumps (e.g. on app resume).
    ref.watch(authStatusRefreshProvider);
    return ref.watch(threadManagerProvider).loadAuthStatus(agentId);
  },
);

/// Per-thread chosen run-option values (`threadId → { optionKey → value }`),
/// the data-driven "knobs" (reasoning effort, …) advertised per model. In
/// memory only (resets on restart); sent on each `turn/send`.
class RunOptionSelections extends Notifier<Map<String, Map<String, Object>>> {
  @override
  Map<String, Map<String, Object>> build() => const {};

  /// Sets [key] to [value] for [threadId].
  void set(String threadId, String key, Object value) {
    final next = {
      for (final entry in state.entries) entry.key: {...entry.value},
    };
    (next[threadId] ??= <String, Object>{})[key] = value;
    state = next;
  }

  /// Clears [key] for [threadId] (revert to the agent's default).
  void clear(String threadId, String key) {
    if (state[threadId]?.containsKey(key) != true) return;
    final next = {
      for (final entry in state.entries) entry.key: {...entry.value},
    };
    next[threadId]?.remove(key);
    state = next;
  }
}

/// Holds the per-thread run-option selections.
final runOptionSelectionsProvider =
    NotifierProvider<RunOptionSelections, Map<String, Map<String, Object>>>(
  RunOptionSelections.new,
);

/// The chosen run-option values for a thread (empty when none picked).
final threadRunOptionsProvider =
    Provider.family<Map<String, Object>, String>((ref, threadId) {
  return ref.watch(runOptionSelectionsProvider)[threadId] ??
      const <String, Object>{};
});

/// The run-option knobs advertised for a thread's current model (empty when the
/// model has none, or the list isn't available yet). Resolves the thread's
/// model id against the agent's `agent/models`, falling back to the default.
final activeModelOptionsProvider =
    Provider.family<List<AgentModelOption>, String>((ref, threadId) {
  final thread = ref.watch(threadByIdProvider(threadId));
  if (thread == null) return const [];
  final models = ref.watch(agentModelsProvider(thread.agentId)).value;
  if (models == null || models.isEmpty) return const [];
  AgentModel? match;
  for (final model in models) {
    if (model.id == thread.model) {
      match = model;
      break;
    }
    if (match == null && model.isDefault) match = model;
  }
  return (match ?? models.first).options;
});

/// Map of threadId → the concrete model id the agent resolved most recently
/// (`stream/model/resolved`), e.g. `opus` → `claude-opus-4-8`.
final resolvedModelsProvider = StreamProvider<Map<String, String>>(
  (ref) => ref.watch(threadManagerProvider).resolvedModelsStream,
);

/// The concrete resolved model for a given thread, or null when not yet known.
final resolvedModelProvider = Provider.family<String?, String>((ref, threadId) {
  final models = ref.watch(resolvedModelsProvider).value;
  return models?[threadId];
});

/// The capabilities the bridge reports for an agent (from `agent/list`), or a
/// permissive default when the agent list is unavailable or the agent is
/// unknown — so capability-gated UI never hides a control spuriously (e.g.
/// while offline or before `agent/list` resolves).
final agentCapabilitiesProvider =
    Provider.family<AgentCapabilities, String>((ref, agentId) {
  final agents = ref.watch(agentsProvider).value;
  if (agents == null) return const AgentCapabilities.permissive();
  for (final agent in agents) {
    if (agent.agentId == agentId) return agent.capabilities;
  }
  return const AgentCapabilities.permissive();
});

/// Holds the threadId of the conversation the user is currently viewing in the
/// foreground (null when none). The conversation screen sets it while visible
/// and clears it on leave/background; [pushRegistrarProvider] reads it to
/// suppress a redundant local notification for the conversation already on
/// screen.
class ForegroundThread extends Notifier<String?> {
  @override
  String? build() => null;

  /// Marks [threadId]'s conversation as the foreground one.
  // ignore: use_setters_to_change_properties — paired with leave() for symmetry.
  void enter(String threadId) => state = threadId;

  /// Clears the foreground thread when leaving [threadId] (ignored if a
  /// different thread is now in front).
  void leave(String threadId) {
    if (state == threadId) state = null;
  }
}

/// The conversation currently on screen in the foreground, or null.
final foregroundThreadProvider =
    NotifierProvider<ForegroundThread, String?>(ForegroundThread.new);

/// The user's notification preferences (`{ turnCompleted, turnError }`), loaded
/// from on-device storage and the source of truth for both the local
/// notifications the [PushRegistrar] raises and the `preferences` it sends on
/// `notifications/register`.
///
/// `build()` returns the opted-in default synchronously, then hydrates from the
/// store; toggling persists locally and, while connected, best-effort pushes
/// the change to the bridge via `notifications/update` so background push
/// updates without waiting for a reconnect.
class NotificationPreferencesController
    extends Notifier<NotificationPreferences> {
  @override
  NotificationPreferences build() {
    unawaited(_hydrate());
    return const NotificationPreferences();
  }

  Future<void> _hydrate() async {
    final stored = await ref.read(notificationPreferencesStoreProvider).read();
    if (stored == null || stored == state) return;
    state = stored;
    // Safety net for the cold-start race: if a PC connected before this (async)
    // load finished, the registrar already registered with the default prefs —
    // reconcile the bridge now. When not yet connected (the common case) this
    // is a no-op and the next `notifications/register` carries the loaded prefs.
    await _pushToBridge(stored);
  }

  /// Persists [next] and, while connected, pushes it to the bridge. A no-op
  /// when it matches the current state.
  Future<void> save(NotificationPreferences next) async {
    if (next == state) return;
    state = next;
    await ref.read(notificationPreferencesStoreProvider).write(next);
    await _pushToBridge(next);
  }

  /// Best-effort `notifications/update` — only while a PC is connected; a
  /// missing channel or older bridge degrades to a silent no-op (the prefs
  /// still persist and ride along on the next `notifications/register`).
  Future<void> _pushToBridge(NotificationPreferences preferences) async {
    final connected = ref.read(connectedDeviceProvider).value;
    if (connected == null) return;
    try {
      await ref.read(sessionCoordinatorProvider).sendRequest(
        'notifications/update',
        {'preferences': preferences.toJson()},
      );
    } on Object catch (error, stackTrace) {
      AppLogger.warn('notifications/update failed', error, stackTrace);
    }
  }
}

/// The user's notification preferences (persisted; drives push + local notifs).
final notificationPreferencesProvider = NotifierProvider<
    NotificationPreferencesController,
    NotificationPreferences>(NotificationPreferencesController.new);

/// Whether the agent's "thinking" section is shown in conversations. Persisted
/// on-device; defaults to shown (the section itself starts collapsed). Hydrates
/// from the store after returning the default synchronously.
class ShowAgentThinking extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_hydrate());
    return true;
  }

  Future<void> _hydrate() async {
    final stored =
        await ref.read(conversationPreferencesStoreProvider).readShowThinking();
    if (stored != null && stored != state) state = stored;
  }

  /// Persists and applies the show-thinking preference.
  Future<void> set({required bool value}) async {
    if (value == state) return;
    state = value;
    await ref
        .read(conversationPreferencesStoreProvider)
        .writeShowThinking(value: value);
  }
}

/// Whether agent reasoning is shown in conversations (persisted toggle).
final showAgentThinkingProvider =
    NotifierProvider<ShowAgentThinking, bool>(ShowAgentThinking.new);

/// Whether sending a message jumps the scroll to the latest even when the user
/// has scrolled up. Persisted; defaults to on (the natural behaviour). When
/// off, a manual scroll position is preserved on send (auto-scroll still
/// follows the stream while the user is near the bottom).
class ScrollToBottomOnSend extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_hydrate());
    return true;
  }

  Future<void> _hydrate() async {
    final stored =
        await ref.read(conversationPreferencesStoreProvider).readScrollOnSend();
    if (stored != null && stored != state) state = stored;
  }

  /// Persists and applies the scroll-on-send preference.
  Future<void> set({required bool value}) async {
    if (value == state) return;
    state = value;
    await ref
        .read(conversationPreferencesStoreProvider)
        .writeScrollOnSend(value: value);
  }
}

/// Whether sending a message scrolls to the latest (persisted toggle).
final scrollToBottomOnSendProvider =
    NotifierProvider<ScrollToBottomOnSend, bool>(ScrollToBottomOnSend.new);

/// What the conversation's context indicator shows: the context-window
/// percentage, the raw token count, or both. Persisted; defaults to
/// [ContextIndicatorMode.percentage] (the prior behaviour).
class ContextIndicatorModeSetting extends Notifier<ContextIndicatorMode> {
  @override
  ContextIndicatorMode build() {
    unawaited(_hydrate());
    return ContextIndicatorMode.percentage;
  }

  Future<void> _hydrate() async {
    final stored = await ref
        .read(conversationPreferencesStoreProvider)
        .readContextIndicatorMode();
    if (stored == null) return;
    final match = ContextIndicatorMode.values.where((m) => m.name == stored);
    if (match.isNotEmpty && match.first != state) state = match.first;
  }

  /// Persists and applies the context-indicator display mode.
  Future<void> set(ContextIndicatorMode value) async {
    if (value == state) return;
    state = value;
    await ref
        .read(conversationPreferencesStoreProvider)
        .writeContextIndicatorMode(value.name);
  }
}

/// The context-indicator display mode (persisted choice).
final contextIndicatorModeProvider =
    NotifierProvider<ContextIndicatorModeSetting, ContextIndicatorMode>(
  ContextIndicatorModeSetting.new,
);

/// Whether a confirmation is shown before pushing. Persisted; defaults to on
/// (a push can't be undone, so it's guarded by default).
class ConfirmBeforePush extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_hydrate());
    return true;
  }

  Future<void> _hydrate() async {
    final stored =
        await ref.read(conversationPreferencesStoreProvider).readConfirmPush();
    if (stored != null && stored != state) state = stored;
  }

  /// Persists and applies the confirm-before-push preference.
  Future<void> set({required bool value}) async {
    if (value == state) return;
    state = value;
    await ref
        .read(conversationPreferencesStoreProvider)
        .writeConfirmPush(value: value);
  }
}

/// Whether a confirmation is shown before pushing (persisted toggle).
final confirmBeforePushProvider =
    NotifierProvider<ConfirmBeforePush, bool>(ConfirmBeforePush.new);

/// Whether a confirmation is shown before opening a pull request. Persisted;
/// defaults to on.
class ConfirmBeforePr extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_hydrate());
    return true;
  }

  Future<void> _hydrate() async {
    final stored =
        await ref.read(conversationPreferencesStoreProvider).readConfirmPr();
    if (stored != null && stored != state) state = stored;
  }

  /// Persists and applies the confirm-before-PR preference.
  Future<void> set({required bool value}) async {
    if (value == state) return;
    state = value;
    await ref
        .read(conversationPreferencesStoreProvider)
        .writeConfirmPr(value: value);
  }
}

/// Whether a confirmation is shown before opening a PR (persisted toggle).
final confirmBeforePrProvider =
    NotifierProvider<ConfirmBeforePr, bool>(ConfirmBeforePr.new);

/// The thread-list ordering. Persisted; defaults to newest-created first.
/// Shared by the active and archived lists so the choice carries across both.
class ThreadSortSetting extends Notifier<ThreadSort> {
  @override
  ThreadSort build() {
    unawaited(_hydrate());
    return ThreadSort.created;
  }

  Future<void> _hydrate() async {
    final stored =
        await ref.read(threadListPreferencesStoreProvider).readSort();
    if (stored == null) return;
    final match = ThreadSort.values.where((s) => s.name == stored);
    if (match.isNotEmpty && match.first != state) state = match.first;
  }

  /// Persists and applies the thread-list ordering.
  Future<void> set(ThreadSort value) async {
    if (value == state) return;
    state = value;
    await ref.read(threadListPreferencesStoreProvider).writeSort(value.name);
  }
}

/// The thread-list ordering (persisted, shared across active + archived lists).
final threadSortProvider =
    NotifierProvider<ThreadSortSetting, ThreadSort>(ThreadSortSetting.new);

/// Whether the thread list uses the compact (single-line) density. Persisted;
/// defaults to the full tile.
class ThreadDensityCompact extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_hydrate());
    return false;
  }

  Future<void> _hydrate() async {
    final stored =
        await ref.read(threadListPreferencesStoreProvider).readCompact();
    if (stored != null && stored != state) state = stored;
  }

  /// Persists and applies the compact-density preference.
  Future<void> set({required bool value}) async {
    if (value == state) return;
    state = value;
    await ref
        .read(threadListPreferencesStoreProvider)
        .writeCompact(value: value);
  }
}

/// Whether the thread list uses the compact density (persisted toggle).
final threadDensityCompactProvider =
    NotifierProvider<ThreadDensityCompact, bool>(ThreadDensityCompact.new);

/// The app's theme mode (system/light/dark). Persisted; defaults to system.
class ThemeModeSetting extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    unawaited(_hydrate());
    return ThemeMode.system;
  }

  Future<void> _hydrate() async {
    final stored =
        await ref.read(appearancePreferencesStoreProvider).readThemeMode();
    final mode = _parse(stored);
    if (mode != state) state = mode;
  }

  /// Persists and applies the theme mode.
  Future<void> set(ThemeMode mode) async {
    if (mode == state) return;
    state = mode;
    await ref
        .read(appearancePreferencesStoreProvider)
        .writeThemeMode(mode.name);
  }

  static ThemeMode _parse(String? name) => switch (name) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };
}

/// The app's theme mode (persisted).
final themeModeSettingProvider =
    NotifierProvider<ThemeModeSetting, ThemeMode>(ThemeModeSetting.new);

/// The manual locale override, or null to follow the device language.
/// Persisted; defaults to null (system).
class LocaleSetting extends Notifier<Locale?> {
  @override
  Locale? build() {
    unawaited(_hydrate());
    return null;
  }

  Future<void> _hydrate() async {
    final tag =
        await ref.read(appearancePreferencesStoreProvider).readLocaleTag();
    final locale = tag == null ? null : Locale(tag);
    if (locale?.languageCode != state?.languageCode) state = locale;
  }

  /// Persists and applies the locale override (null = system default).
  Future<void> set(Locale? locale) async {
    if (locale?.languageCode == state?.languageCode) return;
    state = locale;
    await ref
        .read(appearancePreferencesStoreProvider)
        .writeLocaleTag(locale?.languageCode);
  }
}

/// The manual locale override, or null for the device language (persisted).
final localeSettingProvider =
    NotifierProvider<LocaleSetting, Locale?>(LocaleSetting.new);

/// The two built-in example themes shipped on first run. Both are
/// seed-derived (see [CustomTheme.derivedFromSeed]) so the library always has
/// a working theme without any user input — the user can edit, delete (for
/// non-built-ins), or import on top.
///
/// * `Midnight` leans dark: deep blue-violet seed, paired with a darker dark
///   scheme than the brand baseline.
/// * `Sandstone` leans light: warm amber seed, paired with a softer surface
///   ramp on both modes.
final List<CustomTheme> kBuiltInCustomThemes = <CustomTheme>[
  CustomTheme(
    id: 'uxnan.builtin.midnight',
    name: 'Midnight',
    description: 'Deep blue-violet — leans dark on both modes.',
    colorScheme: const ColorScheme(
      brightness: Brightness.light,
      primary: Color(0xFF4A3FB8),
      onPrimary: Color(0xFFFFFFFF),
      primaryContainer: Color(0xFFE2DEFF),
      onPrimaryContainer: Color(0xFF0E0664),
      secondary: Color(0xFF5C5B72),
      onSecondary: Color(0xFFFFFFFF),
      secondaryContainer: Color(0xFFE2E0F9),
      onSecondaryContainer: Color(0xFF191A2C),
      tertiary: Color(0xFF7A536D),
      onTertiary: Color(0xFFFFFFFF),
      tertiaryContainer: Color(0xFFFFD8F0),
      onTertiaryContainer: Color(0xFF2F1128),
      error: Color(0xFFB3261E),
      onError: Color(0xFFFFFFFF),
      errorContainer: Color(0xFFF9DEDC),
      onErrorContainer: Color(0xFF410E0B),
      surface: Color(0xFFFEFBFF),
      onSurface: Color(0xFF1B1B22),
      surfaceContainerLowest: Color(0xFFFFFFFF),
      surfaceContainerLow: Color(0xFFF6F3FA),
      surfaceContainer: Color(0xFFF1EDF7),
      surfaceContainerHigh: Color(0xFFEBE7F1),
      surfaceContainerHighest: Color(0xFFE5E1EC),
      onSurfaceVariant: Color(0xFF48464F),
      outline: Color(0xFF797681),
      outlineVariant: Color(0xFFC9C5D0),
      inverseSurface: Color(0xFF2F2F37),
      onInverseSurface: Color(0xFFF1EFF7),
      inversePrimary: Color(0xFFC4C0FF),
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
      surfaceTint: Color(0xFF4A3FB8),
    ),
  ),
  CustomTheme(
    id: 'uxnan.builtin.sandstone',
    name: 'Sandstone',
    description: 'Warm amber — leans light on both modes.',
    colorScheme: const ColorScheme(
      brightness: Brightness.light,
      primary: Color(0xFF9C5A1E),
      onPrimary: Color(0xFFFFFFFF),
      primaryContainer: Color(0xFFFFDCC2),
      onPrimaryContainer: Color(0xFF341000),
      secondary: Color(0xFF765846),
      onSecondary: Color(0xFFFFFFFF),
      secondaryContainer: Color(0xFFFFDCC2),
      onSecondaryContainer: Color(0xFF2B160A),
      tertiary: Color(0xFF636032),
      onTertiary: Color(0xFFFFFFFF),
      tertiaryContainer: Color(0xFFE9E1AA),
      onTertiaryContainer: Color(0xFF1E1C00),
      error: Color(0xFFB3261E),
      onError: Color(0xFFFFFFFF),
      errorContainer: Color(0xFFF9DEDC),
      onErrorContainer: Color(0xFF410E0B),
      surface: Color(0xFFFFFBFF),
      onSurface: Color(0xFF201A17),
      surfaceContainerLowest: Color(0xFFFFFFFF),
      surfaceContainerLow: Color(0xFFFEF1E7),
      surfaceContainer: Color(0xFFF8EBE0),
      surfaceContainerHigh: Color(0xFFF2E5DA),
      surfaceContainerHighest: Color(0xFFECE0D4),
      onSurfaceVariant: Color(0xFF51443A),
      outline: Color(0xFF827469),
      outlineVariant: Color(0xFFD4C3B4),
      inverseSurface: Color(0xFF362F2B),
      onInverseSurface: Color(0xFFFEEEDC),
      inversePrimary: Color(0xFFFFB689),
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
      surfaceTint: Color(0xFF9C5A1E),
    ),
  ),
];

/// Marker prefix for built-in theme ids. Any id that starts with this
/// string is treated as read-only (cannot be deleted) by the library
/// notifier.
const String kBuiltInThemeIdPrefix = 'uxnan.builtin.';

/// Whether [id] identifies one of the built-in shipped themes (and therefore
/// cannot be deleted from the user's library).
bool isBuiltInCustomThemeId(String id) => id.startsWith(kBuiltInThemeIdPrefix);

/// The user's custom-themes library. Persisted as a JSON array under
/// `uxnan.appearance.customThemes`. On first hydrate (and on a one-shot
/// legacy migration), the library is seeded with the [kBuiltInCustomThemes]
/// shipped examples so a first-run user always has two selectable themes
/// even before authoring one.
class CustomThemesLibrary extends Notifier<List<CustomTheme>> {
  @override
  List<CustomTheme> build() {
    unawaited(_hydrate());
    return List<CustomTheme>.unmodifiable(kBuiltInCustomThemes);
  }

  Future<void> _hydrate() async {
    final store = ref.read(appearancePreferencesStoreProvider);
    final stored = await store.readCustomThemesLibrary();
    if (stored.isNotEmpty) {
      if (!_listEquals(state, stored)) {
        state = List<CustomTheme>.unmodifiable(stored);
      }
      return;
    }
    // Legacy migration: if the old single-theme key is set, fold its
    // content into the library so existing installs do not lose their
    // authored theme on first hydrate.
    final legacy = await store.readCustomTheme();
    if (legacy != null) {
      final seeded = <CustomTheme>[
        ...kBuiltInCustomThemes,
        if (!kBuiltInCustomThemes.any((t) => t.id == legacy.id)) legacy,
      ];
      state = List<CustomTheme>.unmodifiable(seeded);
      await store.writeCustomThemesLibrary(seeded);
      // Activate the migrated theme + flip the master switch so the user
      // keeps seeing their previously authored palette.
      await ref.read(activeCustomThemeIdProvider.notifier).set(legacy.id);
      await ref.read(useCustomThemeProvider.notifier).set(value: true);
      // Drop the legacy key so we never re-migrate.
      await store.writeCustomTheme(null);
      return;
    }
    // First run / cleared storage: persist the built-in seed so a follow-
    // up read sees what the user is currently seeing on screen.
    await store.writeCustomThemesLibrary(kBuiltInCustomThemes);
  }

  /// Replaces a theme by id (or appends a new one). The id is preserved —
  /// the editor does not change ids on save.
  Future<void> upsert(CustomTheme theme) async {
    final next = <CustomTheme>[...state];
    final index = next.indexWhere((t) => t.id == theme.id);
    if (index >= 0) {
      next[index] = theme;
    } else {
      next.add(theme);
    }
    state = List<CustomTheme>.unmodifiable(next);
    await ref
        .read(appearancePreferencesStoreProvider)
        .writeCustomThemesLibrary(state);
  }

  /// Removes a theme by id. Built-in themes are protected — the call is a
  /// no-op for them so the user cannot strand themselves with an empty
  /// library. Returns true if a theme was removed.
  Future<bool> remove(String id) async {
    if (isBuiltInCustomThemeId(id)) return false;
    final next = state.where((t) => t.id != id).toList(growable: false);
    if (next.length == state.length) return false;
    state = List<CustomTheme>.unmodifiable(next);
    await ref
        .read(appearancePreferencesStoreProvider)
        .writeCustomThemesLibrary(state);
    return true;
  }

  /// Restores the library to the built-in seed (drops every authored
  /// theme). Used by Personalization's *Reset* action.
  Future<void> resetToBuiltIns() async {
    state = List<CustomTheme>.unmodifiable(kBuiltInCustomThemes);
    await ref
        .read(appearancePreferencesStoreProvider)
        .writeCustomThemesLibrary(state);
    await ref.read(activeCustomThemeIdProvider.notifier).set(null);
    await ref.read(useCustomThemeProvider.notifier).set(value: false);
  }

  static bool _listEquals(List<CustomTheme> a, List<CustomTheme> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

/// The user's custom-themes library (built-ins + any imported/authored
/// themes). Hydrates from disk and seeds the built-in examples on a fresh
/// install.
final customThemesLibraryProvider =
    NotifierProvider<CustomThemesLibrary, List<CustomTheme>>(
  CustomThemesLibrary.new,
);

/// The id of the user's active custom theme within the library, or null when
/// no theme is selected. Persisted independently of the master switch so
/// flipping the switch off and back on restores the same selection.
class ActiveCustomThemeId extends Notifier<String?> {
  @override
  String? build() {
    unawaited(_hydrate());
    return null;
  }

  Future<void> _hydrate() async {
    final stored = await ref
        .read(appearancePreferencesStoreProvider)
        .readActiveCustomThemeId();
    if (stored != state) state = stored;
  }

  Future<void> set(String? id) async {
    if (id == state) return;
    state = id;
    await ref
        .read(appearancePreferencesStoreProvider)
        .writeActiveCustomThemeId(id);
  }
}

/// The id of the active custom theme (null when none).
final activeCustomThemeIdProvider =
    NotifierProvider<ActiveCustomThemeId, String?>(ActiveCustomThemeId.new);

/// The master switch on the Personalization screen — when true, the app
/// uses the selected custom theme; when false, the user's System/Light/Dark
/// preference drives `MaterialApp.themeMode` against the brand baseline.
class UseCustomTheme extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_hydrate());
    return false;
  }

  Future<void> _hydrate() async {
    final stored =
        await ref.read(appearancePreferencesStoreProvider).readUseCustomTheme();
    if (stored != state) state = stored;
  }

  Future<void> set({required bool value}) async {
    if (value == state) return;
    state = value;
    await ref
        .read(appearancePreferencesStoreProvider)
        .writeUseCustomTheme(value: value);
  }
}

/// Whether the active theme should be the user's custom theme instead of
/// the brand baseline.
final useCustomThemeProvider =
    NotifierProvider<UseCustomTheme, bool>(UseCustomTheme.new);

/// The user's active [CustomTheme] (the one currently applied to the app),
/// or null when the master switch is off or no theme is selected. Derived
/// from [useCustomThemeProvider] + [activeCustomThemeIdProvider] +
/// [customThemesLibraryProvider] so a single source of truth feeds
/// `app.dart` and `ThemeSourceSetting` without a parallel write path.
final customThemeSettingProvider = Provider<CustomTheme?>((ref) {
  final useCustom = ref.watch(useCustomThemeProvider);
  if (!useCustom) return null;
  final id = ref.watch(activeCustomThemeIdProvider);
  if (id == null) return null;
  final library = ref.watch(customThemesLibraryProvider);
  for (final theme in library) {
    if (theme.id == id) return theme;
  }
  return null;
});

/// Whether the active theme is the hand-tuned brand baseline
/// ([ThemeSource.brand]) or the user's authored [CustomTheme]
/// ([ThemeSource.custom]). The Personalization screen flips this when the
/// user toggles the *Use a custom theme* switch on; the brand baseline is
/// the implicit default for a first-run user with the switch off.
class ThemeSourceSetting extends Notifier<ThemeSource> {
  @override
  ThemeSource build() {
    final hasCustom = ref.watch(customThemeSettingProvider) != null;
    return hasCustom ? ThemeSource.custom : ThemeSource.brand;
  }
}

/// The active theme source (brand baseline vs. user-authored custom theme).
final themeSourceSettingProvider =
    NotifierProvider<ThemeSourceSetting, ThemeSource>(ThemeSourceSetting.new);

/// Whether the *Custom themes* library collapsible on the Personalization
/// screen is expanded or collapsed. Persisted so the user's choice survives
/// restarts (the screen remembers whether the library was open or folded).
class CustomThemesExpanded extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_hydrate());
    return false;
  }

  Future<void> _hydrate() async {
    final stored = await ref
        .read(appearancePreferencesStoreProvider)
        .readCustomThemesExpanded();
    if (stored != state) state = stored;
  }

  Future<void> set({required bool value}) async {
    if (value == state) return;
    state = value;
    await ref
        .read(appearancePreferencesStoreProvider)
        .writeCustomThemesExpanded(value: value);
  }
}

/// Whether the *Custom themes* library collapsible is expanded.
final customThemesExpandedProvider =
    NotifierProvider<CustomThemesExpanded, bool>(CustomThemesExpanded.new);

/// Registers the FCM push token with the bridge once the session connects and
/// raises local notifications for turn-completed / turn-error events.
///
/// Best-effort and non-blocking: it lazily initializes the (guarded) push
/// service, and silently no-ops when Firebase native config is absent. Watch
/// this provider from a widget (e.g. the root app) to keep it alive; the UI
/// feeds it localized copy via the registrar's `strings` setter.
final pushRegistrarProvider = Provider<PushRegistrar>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  final processor = ref.watch(incomingMessageProcessorProvider);
  final pushService = ref.watch(pushNotificationServiceProvider);
  // Fire-and-forget init: must never block app startup.
  unawaited(pushService.init());
  // Foreground FCM suppression: skip a push for the conversation on screen, and
  // (while connected) defer to the live domain-event path so a foreground push
  // never duplicates the notification the WS already raises.
  pushService.foregroundThreadId = () => ref.read(foregroundThreadProvider);
  final registrar = PushRegistrar(
    pushService: pushService,
    sendRequest: coordinator.sendRequest,
    connectionPhases: coordinator.connectionPhaseStream,
    domainEvents: processor.bind(coordinator.incomingMessages),
    // Suppress a turn-end notification for the conversation already on screen.
    foregroundThreadId: () => ref.read(foregroundThreadProvider),
    // The user's per-channel toggles gate both the local notification and the
    // `preferences` sent on register.
    preferences: () => ref.read(notificationPreferencesProvider),
    // Resolve the agent label + thread title for the notification copy
    // ("{agent} replied" titled with the thread name).
    threadInfo: (id) {
      final threads = ref.read(threadsProvider).value ?? const <Thread>[];
      for (final t in threads) {
        if (t.id == id) {
          return (
            title: t.title,
            agent: AgentVisuals.labelFor(AgentIdParsing.fromWireId(t.agentId)),
          );
        }
      }
      return null;
    },
  );
  // The registrar tracks the live connection state; let the push service read
  // it so a foreground FCM push defers to the live domain-event path while
  // connected.
  pushService.isConnected = () => registrar.isConnected;
  ref.onDispose(registrar.dispose);
  return registrar;
});

/// Coordinates git actions (status, commit, push) for the active workspace.
final gitActionManagerProvider = Provider<GitActionManager>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  final processor = ref.watch(incomingMessageProcessorProvider);
  final manager = GitActionManager(
    sendRequest: coordinator.sendRequest,
    domainEvents: processor.bind(coordinator.incomingMessages),
    actionLog: ref.watch(gitActionLogRepositoryProvider),
    statusBus: ref.watch(gitStatusBusProvider),
  );
  ref.onDispose(manager.dispose);
  return manager;
});

/// The active workspace's git repository state, for the UI.
final gitRepoStateProvider = StreamProvider<GitRepoState?>(
  (ref) => ref.watch(gitActionManagerProvider).repoStateStream,
);

/// The in-flight git action's progress, for the UI.
final gitActiveActionProvider = StreamProvider<GitActionProgress?>(
  (ref) => ref.watch(gitActionManagerProvider).activeActionStream,
);

/// Recent git actions recorded for the given thread id, most recent first.
final gitActionHistoryProvider =
    StreamProvider.family<List<GitActionLogEntry>, String>(
  (ref, threadId) =>
      ref.watch(gitActionLogRepositoryProvider).watchForThread(threadId),
);
