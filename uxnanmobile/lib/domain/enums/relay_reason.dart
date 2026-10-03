/// Why a session to a PC runs through the relay, when there is something worth
/// knowing about it. A relay session away from home needs no reason; these
/// name the cases where a direct path was there and still not taken.
enum RelayReason {
  /// The phone is on a local network (Wi-Fi or Ethernet), the PC announced
  /// itself on it (mDNS `_uxnan._tcp`, its TXT `id` this PC's `macDeviceId`),
  /// and yet none of its direct addresses answered — typically a network that
  /// isolates its devices from each other (a guest Wi-Fi, "AP isolation").
  sameNetworkUnreachable,

  /// A direct address answered but failed the E2EE handshake — not the PC
  /// this phone trusts (another device on that address, or a spoofed mDNS
  /// announcement), or a protocol error or timeout after the socket opened.
  /// The same attempt went on to the relay. Recorded, not shown: the person
  /// has nothing to act on, and a spoofer must not be able to put words on
  /// the screen.
  directHandshakeFailed,
}
