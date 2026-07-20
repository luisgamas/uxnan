import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/core/utils/logger.dart';
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
/// The code is resolved against **one** host: the one the user chose. A
/// **Browse nearby bridges** action ([BridgeDiscoverySheet]) lets them pick a
/// discovered bridge instead of typing the address, which fills the host field
/// — an explicit choice either way. The code is deliberately never fanned out
/// to hosts the user did not name (see `_connect`).
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

  @override
  void dispose() {
    _host.dispose();
    _code.dispose();
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
    // The pairing code goes to EXACTLY ONE host: the one the user chose —
    // typed here, or picked in the discovery sheet (which fills this field).
    // It must never be fanned out to hosts the user did not name: the code is
    // a shared secret, mDNS records are unauthenticated and spoofable by any
    // device on the network, and whoever holds the code can pull the pairing
    // payload AND arm the bridge's bootstrap window (see the bridge's
    // `PairingCodeService.resolve`). See `docs/architecture.md`.
    try {
      final payload = await ref
          .read(manualPairingServiceProvider)
          .resolve(host: _host.text, code: _code.text);
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
