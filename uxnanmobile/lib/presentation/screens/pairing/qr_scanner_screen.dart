import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/entities/pairing_payload.dart';
import 'package:uxnan/domain/services/pairing_validator.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/screens/pairing/update_prompt_dialog.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_button.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';

/// Camera state for the scanner screen.
enum _CameraAccess {
  /// Still resolving the permission status.
  checking,

  /// Camera permission granted.
  granted,

  /// Permission denied (can be requested again).
  denied,

  /// Permission permanently denied (must be changed in Settings).
  permanentlyDenied,

  /// The camera failed to start (a `MobileScannerException`).
  error,
}

/// Scans a bridge pairing QR, validates it and starts the pairing handshake
/// (spec 02a §5.5.2).
class QrScannerScreen extends ConsumerStatefulWidget {
  /// Creates a [QrScannerScreen].
  const QrScannerScreen({super.key});

  @override
  ConsumerState<QrScannerScreen> createState() => _QrScannerScreenState();
}

class _QrScannerScreenState extends ConsumerState<QrScannerScreen> {
  MobileScannerController? _controller;
  _CameraAccess _access = _CameraAccess.checking;
  MobileScannerException? _scanError;
  bool _handling = false;
  bool _connecting = false;

  @override
  void initState() {
    super.initState();
    unawaited(_resolvePermission());
  }

  @override
  void dispose() {
    unawaited(_controller?.dispose());
    super.dispose();
  }

  Future<void> _resolvePermission({bool request = false}) async {
    var status = await Permission.camera.status;
    if (!status.isGranted && request) {
      status = await Permission.camera.request();
    }
    if (!mounted) return;
    setState(() {
      if (status.isGranted) {
        _access = _CameraAccess.granted;
        _controller ??= MobileScannerController();
      } else if (status.isPermanentlyDenied) {
        _access = _CameraAccess.permanentlyDenied;
      } else {
        _access = _CameraAccess.denied;
      }
    });
  }

  /// Hoists a `MobileScanner` start failure out of its (rapidly rebuilding)
  /// `errorBuilder` into stable top-level state, so the fallback screen and
  /// its buttons don't get torn down/rebuilt under the user's finger.
  void _onScannerError(MobileScannerException error) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _access == _CameraAccess.error) return;
      setState(() {
        _scanError = error;
        _access = _CameraAccess.error;
      });
    });
  }

  /// Disposes the failed controller and creates a fresh one so the
  /// `MobileScanner` widget re-mounts and re-attempts `start()` (autoStart).
  Future<void> _retryCamera() async {
    final old = _controller;
    _controller = null;
    _scanError = null;
    if (mounted) setState(() => _access = _CameraAccess.checking);
    await old?.dispose();
    if (!mounted) return;
    setState(() {
      _controller = MobileScannerController();
      _access = _CameraAccess.granted;
    });
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handling || capture.barcodes.isEmpty) return;
    final raw = capture.barcodes.first.rawValue;
    if (raw == null) return;

    setState(() => _handling = true);
    await _controller?.stop();
    if (!mounted) return;

    final result = ref.read(pairingValidatorProvider).validate(raw);
    final l10n = AppLocalizations.of(context);

    switch (result.status) {
      case PairingValidationStatus.valid:
        await _startPairing(result.payload!);
      case PairingValidationStatus.unsupportedVersion:
        await UpdatePromptDialog.show(context);
        await _resumeScanning();
      case PairingValidationStatus.expired:
        _showError(l10n.qrErrorExpired);
        await _resumeScanning();
      case PairingValidationStatus.malformed:
        _showError(l10n.qrErrorMalformed);
        await _resumeScanning();
    }
  }

  Future<void> _startPairing(PairingPayload payload) async {
    setState(() => _connecting = true);
    try {
      await ref.read(sessionCoordinatorProvider).processPairingPayload(payload);
      if (mounted) context.go(AppRoutes.home);
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Pairing failed', error, stackTrace);
      if (!mounted) return;
      setState(() => _connecting = false);
      _showError(AppLocalizations.of(context).qrErrorMalformed);
      await _resumeScanning();
    }
  }

  Future<void> _resumeScanning() async {
    if (!mounted) return;
    setState(() => _handling = false);
    await _controller?.start();
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final body = switch (_access) {
      _CameraAccess.checking => const Center(
          child: PolygonLoader(size: 36),
        ),
      _CameraAccess.granted => _ScannerView(
          controller: _controller!,
          onDetect: _onDetect,
          connecting: _connecting,
          onError: _onScannerError,
        ),
      _CameraAccess.error => _ScannerError(
          error: _scanError!,
          onRetry: _retryCamera,
        ),
      _CameraAccess.denied => _PermissionRequest(
          onAllow: () => _resolvePermission(request: true),
          permanentlyDenied: false,
        ),
      _CameraAccess.permanentlyDenied => const _PermissionRequest(
          onAllow: openAppSettings,
          permanentlyDenied: true,
        ),
    };
    // Transparent NE top bar overlaid above the camera (or the permission /
    // checking states), matching the rest of the app's chrome.
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(child: body),
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
                l10n.qrScannerTitle,
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

class _ScannerView extends StatelessWidget {
  const _ScannerView({
    required this.controller,
    required this.onDetect,
    required this.connecting,
    required this.onError,
  });

  final MobileScannerController controller;
  final void Function(BarcodeCapture) onDetect;
  final bool connecting;

  /// Reports a camera start failure up to the screen so it can render the
  /// fallback at a stable level (the package's `errorBuilder` rebuilds with
  /// the scanner, which would make the fallback buttons unreliable).
  final void Function(MobileScannerException) onError;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;

    return Stack(
      fit: StackFit.expand,
      children: [
        // On a start failure, report the error upward and paint black for the
        // single frame before the screen swaps to the stable fallback — never
        // the package's cryptic default error glyph.
        MobileScanner(
          controller: controller,
          onDetect: onDetect,
          errorBuilder: (context, error, child) {
            onError(error);
            return const ColoredBox(color: Colors.black);
          },
        ),
        const _ScanWindowOverlay(),
        Align(
          alignment: Alignment.bottomCenter,
          child: Padding(
            padding: const EdgeInsets.all(UxnanSpacing.xl),
            child: Text(
              l10n.qrHint,
              textAlign: TextAlign.center,
              style: textTheme.bodyMedium?.copyWith(color: Colors.white),
            ),
          ),
        ),
        if (connecting)
          ColoredBox(
            color: Colors.black54,
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const PolygonLoader(size: 48, color: Colors.white),
                  const SizedBox(height: UxnanSpacing.lg),
                  Text(
                    l10n.pairingConnecting,
                    style: textTheme.bodyMedium?.copyWith(color: Colors.white),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _ScanWindowOverlay extends StatelessWidget {
  const _ScanWindowOverlay();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Center(
      child: Container(
        width: 240,
        height: 240,
        decoration: BoxDecoration(
          border: Border.all(color: colors.primary, width: 3),
          borderRadius: const BorderRadius.all(UxnanRadius.xl),
        ),
      ),
    );
  }
}

/// Shown over the (dark) camera area when `MobileScanner` reports a start
/// failure: the real error code/message plus a manual-code fallback and a
/// retry, instead of the package's default error glyph.
class _ScannerError extends StatelessWidget {
  const _ScannerError({required this.error, required this.onRetry});

  final MobileScannerException error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;
    final detail = error.errorDetails?.message;
    final diagnostic = detail != null && detail.isNotEmpty
        ? '${error.errorCode.name}: $detail'
        : error.errorCode.name;

    return ColoredBox(
      color: colors.surface,
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(UxnanSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.no_photography_rounded,
                size: 56,
                color: colors.onSurface,
                semanticLabel: 'Camera error',
              ),
              const SizedBox(height: UxnanSpacing.lg),
              Text(
                l10n.qrCameraErrorTitle,
                style: textTheme.headlineMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: UxnanSpacing.sm),
              Text(
                l10n.qrCameraErrorBody,
                style: textTheme.bodyMedium?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: UxnanSpacing.md),
              Text(
                diagnostic,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                  fontFamily: 'JetBrainsMono',
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: UxnanSpacing.xl),
              NeButton(
                onPressed: () => context.go(AppRoutes.manualPairing),
                label: l10n.manualCodeTitle,
              ),
              const SizedBox(height: UxnanSpacing.sm),
              TextButton(
                onPressed: () => unawaited(onRetry()),
                child: Text(l10n.actionRetry),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PermissionRequest extends StatelessWidget {
  const _PermissionRequest({
    required this.onAllow,
    required this.permanentlyDenied,
  });

  final VoidCallback onAllow;
  final bool permanentlyDenied;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;
    final colorScheme = Theme.of(context).colorScheme;

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(UxnanSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.photo_camera_rounded,
              size: 56,
              color: colorScheme.onSurface,
              semanticLabel: 'Camera',
            ),
            const SizedBox(height: UxnanSpacing.lg),
            Text(
              l10n.qrPermissionTitle,
              style: textTheme.headlineMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              l10n.qrPermissionBody,
              style: textTheme.bodyMedium?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: UxnanSpacing.xl),
            NeButton(
              onPressed: onAllow,
              label: permanentlyDenied
                  ? l10n.actionOpenSettings
                  : l10n.actionAllowCamera,
            ),
          ],
        ),
      ),
    );
  }
}
