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
    return Scaffold(
      appBar: AppBar(title: Text(l10n.qrScannerTitle)),
      body: switch (_access) {
        _CameraAccess.checking =>
          const Center(child: CircularProgressIndicator()),
        _CameraAccess.granted => _ScannerView(
            controller: _controller!,
            onDetect: _onDetect,
            connecting: _connecting,
          ),
        _CameraAccess.denied => _PermissionRequest(
            onAllow: () => _resolvePermission(request: true),
            permanentlyDenied: false,
          ),
        _CameraAccess.permanentlyDenied => const _PermissionRequest(
            onAllow: openAppSettings,
            permanentlyDenied: true,
          ),
      },
    );
  }
}

class _ScannerView extends StatelessWidget {
  const _ScannerView({
    required this.controller,
    required this.onDetect,
    required this.connecting,
  });

  final MobileScannerController controller;
  final void Function(BarcodeCapture) onDetect;
  final bool connecting;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final textTheme = Theme.of(context).textTheme;

    return Stack(
      fit: StackFit.expand,
      children: [
        MobileScanner(controller: controller, onDetect: onDetect),
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
                  const CircularProgressIndicator(),
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
            FilledButton(
              onPressed: onAllow,
              child: Text(
                permanentlyDenied
                    ? l10n.actionOpenSettings
                    : l10n.actionAllowCamera,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
