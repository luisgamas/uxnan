import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/discovered_bridge.dart';
import 'package:uxnan/infrastructure/discovery/bridge_discovery_service.dart';
import 'package:uxnan/infrastructure/pairing/manual_pairing_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/pairing/bridge_discovery_sheet.dart';
import 'package:uxnan/presentation/screens/pairing/qr_scanner_screen.dart'
    show QrScannerScreen;
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_button.dart';
import 'package:uxnan/presentation/widgets/ne_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Pair with the bridge by typing its host + a short pairing code — the
/// no-camera alternative to [QrScannerScreen]. Resolves the code against the
/// bridge's `GET /pair/resolve` endpoint, then runs the normal pairing
/// handshake (`SessionCoordinator.processPairingPayload`).
///
/// The resolve itself races the typed host against any bridge the screen has
/// passively discovered via mDNS in the background (`resolveAny`), so a
/// stale/wrong typed address — or one that just isn't reachable on the
/// phone's *current* network — doesn't dead-end pairing when the right
/// bridge is otherwise reachable. A **Browse nearby bridges** action
/// ([BridgeDiscoverySheet]) additionally lets the user pick a bridge instead
/// of typing the host at all; manual entry stays the fallback either way.
///
/// Chrome follows the Neural Expressive language (guide §4.1–4.3): a
/// transparent [NeTopBar] with a scroll veil over an [IconSurface] back, an
/// Icon Surface hero, a dynamic-corner [ExpressiveCard] for the discovery,
/// the form fields grouped in an [NeSurface] with filled (borderless) inputs,
/// and a pill primary CTA with the [PolygonLoader] for the connecting state.
class ManualCodeScreen extends ConsumerStatefulWidget {
  /// Creates a [ManualCodeScreen].
  const ManualCodeScreen({super.key});

  @override
  ConsumerState<ManualCodeScreen> createState() => _ManualCodeScreenState();
}

class _ManualCodeScreenState extends ConsumerState<ManualCodeScreen> {
  final TextEditingController _host = TextEditingController();
  final TextEditingController _code = TextEditingController();
  bool _connecting = false;
  String? _error;

  // Passive LAN discovery for the connect-time host race: a private
  // BridgeDiscoveryService (not the shared, sheet-scoped
  // bridgeDiscoveryProvider) started as soon as this screen opens, so nearby
  // bridges are already known by the time the user taps Connect — without
  // adding latency to the happy path (typing a host + a code takes longer
  // than mDNS needs to answer). Best-effort: an empty/failed discovery just
  // leaves the typed host as the only candidate, exactly like before this
  // feature existed.
  final BridgeDiscoveryService _discovery = BridgeDiscoveryService();
  List<DiscoveredBridge> _discovered = const [];
  StreamSubscription<List<DiscoveredBridge>>? _discoverySub;

  @override
  void initState() {
    super.initState();
    _discoverySub =
        _discovery.bridges.listen((bridges) => _discovered = bridges);
    unawaited(_discovery.start());
  }

  @override
  void dispose() {
    _host.dispose();
    _code.dispose();
    unawaited(_discoverySub?.cancel());
    unawaited(_discovery.dispose());
    super.dispose();
  }

  String _messageFor(ManualPairingErrorKind kind, AppLocalizations l10n) =>
      switch (kind) {
        ManualPairingErrorKind.invalidInput => l10n.manualCodeErrorInvalidInput,
        ManualPairingErrorKind.network => l10n.manualCodeErrorNetwork,
        ManualPairingErrorKind.invalidOrExpiredCode =>
          l10n.manualCodeErrorInvalidCode,
        ManualPairingErrorKind.rateLimited => l10n.manualCodeErrorRateLimited,
        ManualPairingErrorKind.server => l10n.manualCodeErrorServer,
        ManualPairingErrorKind.malformedPayload => l10n.manualCodeErrorPayload,
      };

  /// Opens the mDNS discovery sheet; a picked bridge pre-fills the host field
  /// (the user still types the pairing code).
  Future<void> _browse() async {
    final hostPort = await BridgeDiscoverySheet.show(context);
    if (hostPort == null || !mounted) return;
    setState(() => _host.text = hostPort);
  }

  Future<void> _connect() async {
    final l10n = AppLocalizations.of(context);
    FocusScope.of(context).unfocus();
    setState(() {
      _connecting = true;
      _error = null;
    });
    // The typed host first (so it wins ties in `resolveAny`'s dedupe), then
    // whatever the passive mDNS scan has found by now — so a stale/wrong
    // typed address doesn't dead-end pairing when the right bridge is
    // discoverable on the same network.
    final candidates = <String>[
      _host.text,
      for (final bridge in _discovered) bridge.hostPort,
    ];
    try {
      final payload = await ref
          .read(manualPairingServiceProvider)
          .resolveAny(hosts: candidates, code: _code.text);
      await ref.read(sessionCoordinatorProvider).processPairingPayload(payload);
      if (mounted) context.go(AppRoutes.home);
    } on ManualPairingException catch (error, stackTrace) {
      AppLogger.warn('Manual pairing failed', error, stackTrace);
      if (!mounted) return;
      setState(() {
        _connecting = false;
        _error = _messageFor(error.kind, l10n);
      });
    } on Object catch (error, stackTrace) {
      // The code resolved but the handshake/validation failed.
      AppLogger.warn('Manual pairing handshake failed', error, stackTrace);
      if (!mounted) return;
      setState(() {
        _connecting = false;
        _error = l10n.manualCodeErrorServer;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final textTheme = theme.textTheme;

    // Content scrolls under the transparent NE top bar (guide §4.1 layering):
    // a Stack with the scroll view behind the veiled bar + IconSurface back.
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: SafeArea(
              top: false,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: ListView(
                    padding: EdgeInsets.fromLTRB(
                      UxnanSpacing.xl,
                      NeTopBar.preferredHeight(context),
                      UxnanSpacing.xl,
                      UxnanSpacing.xl,
                    ),
                    children: [
                      // Icon Surface hero (neutral surface tone, not primary).
                      Center(
                        child: Container(
                          width: 88,
                          height: 80,
                          decoration: BoxDecoration(
                            color: colors.primaryContainer,
                            borderRadius:
                                const BorderRadius.all(UxnanRadius.xl),
                          ),
                          child: Icon(
                            Icons.vpn_key_rounded,
                            size: 38,
                            color: colors.onPrimaryContainer,
                            semanticLabel: l10n.manualCodeTitle,
                          ),
                        ),
                      ),
                      const SizedBox(height: UxnanSpacing.lg),
                      Text(
                        l10n.manualCodeTitle,
                        style: textTheme.headlineMedium,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: UxnanSpacing.sm),
                      Text(
                        l10n.manualCodeIntro,
                        style: textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: UxnanSpacing.xl),

                      // Discovery shortcut as a dynamic-corner card (single).
                      ExpressiveCard(
                        onTap: _connecting ? null : _browse,
                        padding: const EdgeInsets.symmetric(
                          horizontal: UxnanSpacing.lg,
                          vertical: UxnanSpacing.md,
                        ),
                        child: Row(
                          children: [
                            Icon(
                              Icons.wifi_find_rounded,
                              color: colors.primary,
                              semanticLabel: l10n.manualCodeBrowse,
                            ),
                            const SizedBox(width: UxnanSpacing.lg),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    l10n.manualCodeBrowse,
                                    style: textTheme.titleMedium,
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    l10n.manualCodeBrowseHint,
                                    style: textTheme.bodySmall?.copyWith(
                                      color: colors.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Icon(
                              Icons.chevron_right_rounded,
                              color: colors.onSurfaceVariant,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: UxnanSpacing.xl),

                      // Manual entry grouped on one surface with filled inputs.
                      Padding(
                        padding: const EdgeInsets.only(
                          left: UxnanSpacing.xs,
                          bottom: UxnanSpacing.sm,
                        ),
                        child: Text(
                          l10n.manualCodeFormTitle,
                          style: textTheme.labelMedium?.copyWith(
                            color: colors.onSurfaceVariant,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      NeSurface(
                        padding: const EdgeInsets.all(UxnanSpacing.lg),
                        child: Column(
                          children: [
                            _FilledField(
                              controller: _host,
                              enabled: !_connecting,
                              icon: Icons.dns_rounded,
                              label: l10n.manualCodeHostLabel,
                              hint: l10n.manualCodeHostHint,
                              keyboardType: TextInputType.url,
                              textInputAction: TextInputAction.next,
                            ),
                            const SizedBox(height: UxnanSpacing.md),
                            _FilledField(
                              controller: _code,
                              enabled: !_connecting,
                              icon: Icons.key_rounded,
                              label: l10n.manualCodeCodeLabel,
                              hint: l10n.manualCodeCodeHint,
                              textCapitalization: TextCapitalization.characters,
                              textInputAction: TextInputAction.done,
                              onSubmitted: (_) {
                                if (!_connecting) _connect();
                              },
                            ),
                          ],
                        ),
                      ),

                      if (_error != null) ...[
                        const SizedBox(height: UxnanSpacing.lg),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              Icons.error_outline_rounded,
                              color: colors.error,
                              size: 20,
                              semanticLabel: 'Error',
                            ),
                            const SizedBox(width: UxnanSpacing.sm),
                            Expanded(
                              child: Text(
                                _error!,
                                style: textTheme.bodySmall
                                    ?.copyWith(color: colors.error),
                              ),
                            ),
                          ],
                        ),
                      ],

                      const SizedBox(height: UxnanSpacing.xl),

                      // Canonical NE pill CTA (same shape/size as NeButton); keeps a
                      // custom child to show the PolygonLoader while resolving.
                      SizedBox(
                        height: NeButton.height,
                        child: FilledButton(
                          onPressed: _connecting ? null : _connect,
                          style: FilledButton.styleFrom(
                            shape: const StadiumBorder(),
                            padding: const EdgeInsets.symmetric(horizontal: 24),
                            minimumSize: const Size(0, NeButton.height),
                          ),
                          child: _connecting
                              ? Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    PolygonLoader(
                                      size: 20,
                                      color: colors.onPrimary,
                                    ),
                                    const SizedBox(width: UxnanSpacing.md),
                                    Text(l10n.manualCodeConnecting),
                                  ],
                                )
                              : Text(l10n.manualCodeConnect),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // Transparent NE top bar overlaid above the scroll content.
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: NeTopBar(
              leading: IconSurface(
                icon: Icons.arrow_back_rounded,
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                onPressed: () => Navigator.of(context).maybePop(),
              ),
              title: Text(
                l10n.manualCodeTitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: textTheme.titleLarge?.copyWith(fontSize: 20),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A Neural Expressive **filled** text field (guide §4.3 input treatment): a
/// borderless `surfaceContainerHighest` field with a rounded shape and a
/// leading glyph, replacing M3's hard `OutlineInputBorder`.
class _FilledField extends StatelessWidget {
  const _FilledField({
    required this.controller,
    required this.enabled,
    required this.icon,
    required this.label,
    required this.hint,
    this.keyboardType,
    this.textInputAction,
    this.textCapitalization = TextCapitalization.none,
    this.onSubmitted,
  });

  final TextEditingController controller;
  final bool enabled;
  final IconData icon;
  final String label;
  final String hint;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final TextCapitalization textCapitalization;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return TextField(
      controller: controller,
      enabled: enabled,
      autocorrect: false,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      textCapitalization: textCapitalization,
      onSubmitted: onSubmitted,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon, color: colors.onSurfaceVariant),
        filled: true,
        fillColor: colors.surfaceContainerHighest,
        // Borderless filled field with a soft rounded shape; the focused
        // state gets a 2 dp primary outline (guide §4.3 focused state).
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: colors.primary, width: 2),
        ),
      ),
    );
  }
}
