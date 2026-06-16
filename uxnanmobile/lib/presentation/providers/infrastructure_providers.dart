import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/repositories/i_composer_draft_repository.dart';
import 'package:uxnan/domain/repositories/i_git_action_log_repository.dart';
import 'package:uxnan/domain/repositories/i_message_repository.dart';
import 'package:uxnan/domain/repositories/i_thread_repository.dart';
import 'package:uxnan/domain/repositories/i_trusted_device_repository.dart';
import 'package:uxnan/infrastructure/notifications/push_notification_service.dart';
import 'package:uxnan/infrastructure/repositories/drift_composer_draft_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_git_action_log_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_message_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/repositories/trusted_device_repository.dart';
import 'package:uxnan/infrastructure/speech/speech_to_text_service.dart';
import 'package:uxnan/infrastructure/storage/appearance_preferences_store.dart';
import 'package:uxnan/infrastructure/storage/conversation_preferences_store.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';
import 'package:uxnan/infrastructure/storage/notification_preferences_store.dart';
import 'package:uxnan/infrastructure/storage/phone_identity_store.dart';
import 'package:uxnan/infrastructure/storage/secure_store.dart';

/// Infrastructure-layer providers.
///
/// This is the single place where the presentation layer is allowed to
/// reference concrete `infrastructure/` implementations: each provider
/// instantiates a concrete class and exposes it through its domain interface
/// (spec 03-technical-reference.md section 1.5).

/// The shared local drift database. Closed when the scope is disposed.
final databaseProvider = Provider<UxnanDatabase>((ref) {
  final database = UxnanDatabase();
  ref.onDispose(database.close);
  return database;
});

/// Thread repository, backed by drift.
final threadRepositoryProvider = Provider<IThreadRepository>(
  (ref) => DriftThreadRepository(ref.watch(databaseProvider)),
);

/// Composer-draft repository, backed by drift.
final composerDraftRepositoryProvider = Provider<IComposerDraftRepository>(
  (ref) => DriftComposerDraftRepository(ref.watch(databaseProvider)),
);

/// Message repository, backed by drift.
final messageRepositoryProvider = Provider<IMessageRepository>(
  (ref) => DriftMessageRepository(ref.watch(databaseProvider)),
);

/// Git action-log repository, backed by drift.
final gitActionLogRepositoryProvider = Provider<IGitActionLogRepository>(
  (ref) => DriftGitActionLogRepository(ref.watch(databaseProvider)),
);

/// Encrypted secure storage (Keychain / Keystore).
final secureStoreProvider =
    Provider<SecureStore>((ref) => FlutterSecureStore());

/// Loads or creates the phone's persistent Ed25519 identity.
final phoneIdentityStoreProvider = Provider<PhoneIdentityStore>(
  (ref) => PhoneIdentityStore(ref.watch(secureStoreProvider)),
);

/// Persists the user's notification preferences (non-sensitive, on-device).
final notificationPreferencesStoreProvider =
    Provider<NotificationPreferencesStore>(
  (ref) => NotificationPreferencesStore(),
);

/// Persists conversation-view preferences (non-sensitive, on-device).
final conversationPreferencesStoreProvider =
    Provider<ConversationPreferencesStore>(
  (ref) => ConversationPreferencesStore(),
);

/// Persists appearance + language preferences (non-sensitive, on-device).
final appearancePreferencesStoreProvider = Provider<AppearancePreferencesStore>(
  (ref) => AppearancePreferencesStore(),
);

/// Firebase Cloud Messaging + local notifications, fully guarded so the app
/// runs without Firebase native config. Initialized lazily by the push module;
/// `isAvailable` is `false` until [PushNotificationService.init] succeeds.
final pushNotificationServiceProvider = Provider<PushNotificationService>(
  (ref) {
    final service = PushNotificationService();
    ref.onDispose(service.dispose);
    return service;
  },
);

/// On-device speech-to-text for composer dictation. Guarded — no-ops without
/// the native plugin / mic permission, so it never blocks the UI.
final speechToTextServiceProvider = Provider<SpeechToTextService>((ref) {
  final service = SpeechToTextService();
  ref.onDispose(service.cancel);
  return service;
});

/// Trusted-device repository (drift for metadata + secure storage for the
/// bridge identity key).
final trustedDeviceRepositoryProvider = Provider<ITrustedDeviceRepository>(
  (ref) => TrustedDeviceRepository(
    ref.watch(databaseProvider),
    ref.watch(secureStoreProvider),
  ),
);
