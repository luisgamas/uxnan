import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:nsd/nsd.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/discovered_bridge.dart';

/// Browses the LAN for bridges advertising `_uxnan._tcp` (mDNS/DNS-SD) and
/// streams the discovered set, so the user can pick a bridge instead of typing
/// its host. Backed by the native NsdManager (Android) / DNSSD (iOS) via the
/// `nsd` plugin — which handles the platform details (multicast lock, Bonjour).
///
/// Best-effort and self-healing: a platform that doesn't support discovery, a
/// denied permission, or any native error degrades to an empty stream (manual
/// host entry stays the fallback) — it never throws to the UI.
class BridgeDiscoveryService {
  /// The DNS-SD service type the bridge advertises (see the bridge's
  /// `transport/mdns-advertiser.ts`).
  static const String serviceType = '_uxnan._tcp';

  Discovery? _discovery;
  final StreamController<List<DiscoveredBridge>> _controller =
      StreamController<List<DiscoveredBridge>>.broadcast();

  /// The current set of discovered bridges (deduped by `host:port`, sorted by
  /// name). Emits a fresh list on every discovery change.
  Stream<List<DiscoveredBridge>> get bridges => _controller.stream;

  /// Starts discovery. Idempotent. Resolves each service to v4 addresses so a
  /// reachable host is known even when the TXT `addr` hint is missing.
  Future<void> start() async {
    if (_discovery != null) return;
    try {
      final discovery = await startDiscovery(
        serviceType,
        ipLookupType: IpLookupType.v4,
      );
      _discovery = discovery;
      discovery.addListener(_emit);
      _emit();
    } on Object catch (error, stackTrace) {
      AppLogger.warn('mDNS bridge discovery failed', error, stackTrace);
      if (!_controller.isClosed) _controller.add(const []);
    }
  }

  void _emit() {
    final discovery = _discovery;
    if (discovery == null || _controller.isClosed) return;
    final seen = <String>{};
    final bridges = <DiscoveredBridge>[];
    for (final service in discovery.services) {
      final bridge = bridgeFromService(service);
      if (bridge == null) continue;
      if (seen.add(bridge.hostPort)) bridges.add(bridge);
    }
    bridges.sort(
      (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
    );
    _controller.add(bridges);
  }

  /// Stops discovery and releases the stream. Safe to call more than once.
  Future<void> dispose() async {
    final discovery = _discovery;
    _discovery = null;
    if (discovery != null) {
      discovery.removeListener(_emit);
      try {
        await stopDiscovery(discovery);
      } on Object {
        // Best-effort teardown — a failed stop must not surface to the UI.
      }
    }
    if (!_controller.isClosed) await _controller.close();
  }
}

/// Maps a resolved nsd [Service] to a [DiscoveredBridge], or `null` when it
/// lacks a reachable host/port. Kept thin over [parseDiscoveredBridge] so the
/// parsing is unit-testable without the plugin.
DiscoveredBridge? bridgeFromService(Service service) => parseDiscoveredBridge(
      name: service.name,
      host: service.host,
      port: service.port,
      addresses: service.addresses ?? const <InternetAddress>[],
      txt: service.txt ?? const <String, Uint8List?>{},
    );

/// Builds a [DiscoveredBridge] from the raw discovery fields. Prefers the TXT
/// `addr`/`port` hints the bridge advertises, then falls back to the first
/// resolved IPv4 address and the SRV port. Returns `null` when no usable host
/// or port can be determined (such a service can't be paired with).
DiscoveredBridge? parseDiscoveredBridge({
  String? name,
  String? host,
  int? port,
  List<InternetAddress> addresses = const <InternetAddress>[],
  Map<String, Uint8List?> txt = const <String, Uint8List?>{},
}) {
  final txtAddr = _txtValue(txt, 'addr');
  final txtPort = int.tryParse(_txtValue(txt, 'port') ?? '');
  final firstV4 = addresses
      .firstWhere(
        (a) => a.type == InternetAddressType.IPv4,
        orElse: () =>
            addresses.isNotEmpty ? addresses.first : InternetAddress.anyIPv4,
      )
      .address;
  final resolvedHost = (txtAddr != null && txtAddr.isNotEmpty)
      ? txtAddr
      : (addresses.isNotEmpty ? firstV4 : (host ?? '').trim());
  final resolvedPort = txtPort ?? port;
  if (resolvedHost.isEmpty || resolvedPort == null || resolvedPort <= 0) {
    return null;
  }
  final display =
      (name != null && name.trim().isNotEmpty) ? name.trim() : resolvedHost;
  return DiscoveredBridge(
    name: display,
    host: resolvedHost,
    port: resolvedPort,
    deviceId: _txtValue(txt, 'id'),
  );
}

/// Decodes a TXT entry as a trimmed UTF-8 string, or `null` when absent/empty.
String? _txtValue(Map<String, Uint8List?> txt, String key) {
  final bytes = txt[key];
  if (bytes == null || bytes.isEmpty) return null;
  try {
    final value = utf8.decode(bytes).trim();
    return value.isEmpty ? null : value;
  } on FormatException {
    return null;
  }
}
