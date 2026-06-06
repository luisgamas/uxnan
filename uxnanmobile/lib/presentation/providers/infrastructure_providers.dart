import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/repositories/i_composer_draft_repository.dart';
import 'package:uxnan/domain/repositories/i_thread_repository.dart';
import 'package:uxnan/domain/repositories/i_trusted_device_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_composer_draft_repository.dart';
import 'package:uxnan/infrastructure/repositories/drift_thread_repository.dart';
import 'package:uxnan/infrastructure/repositories/trusted_device_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';
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

/// Encrypted secure storage (Keychain / Keystore).
final secureStoreProvider =
    Provider<SecureStore>((ref) => FlutterSecureStore());

/// Loads or creates the phone's persistent Ed25519 identity.
final phoneIdentityStoreProvider = Provider<PhoneIdentityStore>(
  (ref) => PhoneIdentityStore(ref.watch(secureStoreProvider)),
);

/// Trusted-device repository (drift for metadata + secure storage for the
/// bridge identity key).
final trustedDeviceRepositoryProvider = Provider<ITrustedDeviceRepository>(
  (ref) => TrustedDeviceRepository(
    ref.watch(databaseProvider),
    ref.watch(secureStoreProvider),
  ),
);
