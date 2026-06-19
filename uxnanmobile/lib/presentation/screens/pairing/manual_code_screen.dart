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

/// Pair with the bridge by typing its host + a short pairing code — the
/// no-camera alternative to [QrScannerScreen]. Resolves the code against the
/// bridge's `GET /pair/resolve` endpoint, then runs the normal pairing
/// handshake (`SessionCoordinator.processPairingPayload`).
///
/// A **Browse nearby bridges** action runs mDNS discovery
/// ([BridgeDiscoverySheet]) so the user can pick a bridge instead of typing the
/// host; manual entry stays the fallback.
///
/// FOR-DEV (UI): this is a minimal, M3-standard form pending the user's
/// on-device visual review (AGENTS.md "UI changes").
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
    return Scaffold(
      appBar: AppBar(title: Text(l10n.manualCodeTitle)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(UxnanSpacing.xl),
          children: [
            Text(
              l10n.manualCodeIntro,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: UxnanSpacing.lg),
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _connecting ? null : _browse,
                icon: const Icon(Icons.wifi_find_rounded, size: 18),
                label: Text(l10n.manualCodeBrowse),
              ),
            ),
            const SizedBox(height: UxnanSpacing.lg),
            TextField(
              controller: _host,
              enabled: !_connecting,
              autocorrect: false,
              keyboardType: TextInputType.url,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: l10n.manualCodeHostLabel,
                hintText: l10n.manualCodeHostHint,
                prefixIcon: const Icon(Icons.dns_rounded),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: UxnanSpacing.lg),
            TextField(
              controller: _code,
              enabled: !_connecting,
              autocorrect: false,
              textCapitalization: TextCapitalization.characters,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) {
                if (!_connecting) _connect();
              },
              decoration: InputDecoration(
                labelText: l10n.manualCodeCodeLabel,
                hintText: l10n.manualCodeCodeHint,
                prefixIcon: const Icon(Icons.key_rounded),
                border: const OutlineInputBorder(),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: UxnanSpacing.lg),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.error_outline_rounded,
                    color: theme.colorScheme.error,
                    size: 20,
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(
                    child: Text(
                      _error!,
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.error),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: UxnanSpacing.xl),
            SizedBox(
              height: 56,
              child: FilledButton(
                onPressed: _connecting ? null : _connect,
                child: _connecting
                    ? Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
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
    );
  }
}
