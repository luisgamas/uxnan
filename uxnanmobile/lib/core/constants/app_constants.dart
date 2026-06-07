/// Application-wide configuration resolved at compile time.
///
/// Values are injected with `--dart-define` (see
/// `architecture/03-technical-reference.md` section 3.3). Defaults target the
/// production environment so release builds are safe without explicit defines.
class AppConstants {
  const AppConstants._();

  /// Relay WebSocket URL, injected at build time.
  static const String relayUrl = String.fromEnvironment(
    'RELAY_URL',
    defaultValue: 'wss://relay.uxnan.io',
  );

  /// Active environment: `dev`, `staging` or `prod`.
  static const String env = String.fromEnvironment(
    'ENV',
    defaultValue: 'prod',
  );

  /// Enables verbose logging (dev and staging only).
  static const bool enableLogging = bool.fromEnvironment(
    'ENABLE_LOGGING',
  );

  /// Whether the app is running in the development environment.
  static bool get isDev => env == 'dev';

  /// Whether the app is running in the staging environment.
  static bool get isStaging => env == 'staging';

  /// Whether the app is running in the production environment.
  static bool get isProd => env == 'prod';

  /// Maximum size of a single WebSocket message (1 MB), per spec 02b §3.1.
  static const int maxMessageBytes = 1048576;

  /// Default page size when loading turns/messages from local storage.
  static const int defaultPageSize = 50;
}
