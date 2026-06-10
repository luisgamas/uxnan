/// Application-wide configuration resolved at compile time.
///
/// Values are injected with `--dart-define` (see
/// `architecture/03-technical-reference.md` section 3.3). Defaults target the
/// production environment so release builds are safe without explicit defines.
class AppConstants {
  const AppConstants._();

  // Note: the bridge address is NOT a compile-time constant. A paired bridge's
  // transports (direct LAN/Tailscale `hosts` and the optional `relay`) come from
  // the pairing QR (`PairingPayload`) and are persisted on the `TrustedDevice`.
  // There is intentionally no `RELAY_URL` define.

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
