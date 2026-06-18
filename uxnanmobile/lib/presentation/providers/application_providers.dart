import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/coordinators/session_coordinator.dart';
import 'package:uxnan/application/managers/git_action_manager.dart';
import 'package:uxnan/application/managers/push_registrar.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/application/managers/workspace_browser.dart';
import 'package:uxnan/application/processors/incoming_message_processor.dart';
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
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/services/pairing_validator.dart';
import 'package:uxnan/domain/value_objects/accent_color.dart';
import 'package:uxnan/domain/value_objects/git/git_action_progress.dart';
import 'package:uxnan/domain/value_objects/notification_preferences.dart';
import 'package:uxnan/domain/value_objects/turn_timeline_snapshot.dart';
import 'package:uxnan/infrastructure/transport/secure_transport_layer.dart';
import 'package:uxnan/infrastructure/transport/transport_selector.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
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

/// The user-picked accent color (a seed for `ColorScheme.fromSeed`).
/// Persisted; defaults to the brand blue. The whole `ColorScheme` is
/// derived from this seed by `buildUxnanTheme` when it is not the brand
/// default, so every M3 role (primary, secondary, surfaces, containers,
/// outline, …) stays harmonious in both light and dark. Mirrors the
/// hydrate-then-persist pattern used by the other appearance notifiers.
class AccentSetting extends Notifier<AccentColorId> {
  @override
  AccentColorId build() {
    unawaited(_hydrate());
    return AccentPalette.defaultAccent;
  }

  Future<void> _hydrate() async {
    final stored =
        await ref.read(appearancePreferencesStoreProvider).readAccentId();
    final resolved = AccentPalette.fromId(stored);
    if (resolved != state) state = resolved;
  }

  /// Persists and applies the accent. No-op when [accent] is already the
  /// active one.
  Future<void> set(AccentColorId accent) async {
    if (accent == state) return;
    state = accent;
    await ref.read(appearancePreferencesStoreProvider).writeAccentId(accent.id);
  }

  /// Resets the accent to the brand default (clears the stored key).
  Future<void> reset() async {
    if (state == AccentPalette.defaultAccent) return;
    state = AccentPalette.defaultAccent;
    await ref.read(appearancePreferencesStoreProvider).writeAccentId(null);
  }
}

/// The user-picked accent (persisted; drives the whole `ColorScheme`).
final accentSettingProvider =
    NotifierProvider<AccentSetting, AccentColorId>(AccentSetting.new);

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
