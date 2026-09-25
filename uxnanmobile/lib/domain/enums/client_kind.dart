/// What kind of client is connected to a bridge, or started a conversation
/// (`ClientKind` in `shared/src/models/sync.ts`).
enum ClientKind {
  /// A paired phone (this app, on any device).
  phone,

  /// Uxnan Desktop on the bridge's own machine.
  desktop;

  /// Parses the wire value; `null` for anything this build does not know.
  static ClientKind? fromWire(Object? value) => switch (value) {
        'phone' => ClientKind.phone,
        'desktop' => ClientKind.desktop,
        _ => null,
      };
}
