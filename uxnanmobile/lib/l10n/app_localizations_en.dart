// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Uxnan';

  @override
  String get homeEmptyTitle => 'No active sessions';

  @override
  String get homeEmptyBody =>
      'Pair your phone with a PC running the Uxnan bridge to get started.';

  @override
  String get actionPairDevice => 'Pair a device';

  @override
  String get connectionConnected => 'Connected';

  @override
  String get connectionConnecting => 'Connecting…';

  @override
  String get connectionDisconnected => 'Disconnected';

  @override
  String get connectionReconnecting => 'Reconnecting…';

  @override
  String get onboardingSkip => 'Skip';

  @override
  String get onboardingNext => 'Next';

  @override
  String get onboardingBack => 'Back';

  @override
  String get onboardingGetStarted => 'Get started';

  @override
  String get onboardingWelcomeTitle => 'Control your agents from anywhere';

  @override
  String get onboardingWelcomeBody =>
      'Uxnan is a secure remote control for the AI coding agents running on your PC.';

  @override
  String get onboardingFeaturesTitle => 'Built for the way you work';

  @override
  String get featureMultiAgentTitle => 'Multi-agent';

  @override
  String get featureMultiAgentBody =>
      'Works with Codex, Claude Code, Gemini CLI, OpenCode and more — no lock-in.';

  @override
  String get featureE2eeTitle => 'End-to-end encrypted';

  @override
  String get featureE2eeBody =>
      'Messages are encrypted on your devices. The relay only sees opaque envelopes.';

  @override
  String get featureLocalFirstTitle => 'Local-first';

  @override
  String get featureLocalFirstBody =>
      'Your code and conversations stay on your machine, never on a third-party server.';

  @override
  String get onboardingInstallTitle => 'Install the bridge on your PC';

  @override
  String get onboardingInstallBody =>
      'Run this in a terminal on the computer where your agents live:';

  @override
  String get onboardingInstallHint =>
      'Keep the terminal open — it shows the pairing QR.';

  @override
  String get onboardingPairTitle => 'Pair your phone';

  @override
  String get onboardingPairBody =>
      'Scan the QR code shown by the bridge to establish a secure session.';

  @override
  String get actionScanQr => 'Scan QR code';

  @override
  String get commandCopied => 'Command copied to clipboard';

  @override
  String get actionCopy => 'Copy';

  @override
  String get qrScannerTitle => 'Scan pairing QR';

  @override
  String get qrPermissionTitle => 'Camera access needed';

  @override
  String get qrPermissionBody =>
      'Uxnan uses the camera only to scan the bridge\'s pairing QR code.';

  @override
  String get actionAllowCamera => 'Allow camera';

  @override
  String get actionOpenSettings => 'Open settings';

  @override
  String get qrHint =>
      'Point the camera at the QR code in your bridge terminal.';

  @override
  String get qrErrorExpired =>
      'This QR code has expired. Generate a new one on your PC.';

  @override
  String get qrErrorMalformed => 'This isn\'t a valid Uxnan pairing code.';

  @override
  String get pairingConnecting => 'Establishing a secure session…';

  @override
  String get updateRequiredTitle => 'Update required';

  @override
  String get updateRequiredBody =>
      'This bridge uses a newer pairing format. Update the Uxnan app to continue.';

  @override
  String get actionDismiss => 'Dismiss';

  @override
  String get conversationTitle => 'Conversation';

  @override
  String get conversationEmpty => 'No messages yet';

  @override
  String get conversationEmptyBody =>
      'Send a message to start the conversation.';

  @override
  String get composerHint => 'Message…';

  @override
  String get composerSend => 'Send';

  @override
  String get composerAttach => 'Attach';

  @override
  String get composerVoice => 'Voice input';

  @override
  String get conversationPreview => 'Preview conversation (demo)';

  @override
  String get environmentTitle => 'Environment';

  @override
  String get environmentModel => 'Model';

  @override
  String get environmentContext => 'Context';

  @override
  String get environmentApprovalMode => 'Approval mode';

  @override
  String get environmentGit => 'Git';

  @override
  String get environmentBranch => 'Branch';

  @override
  String get environmentLocal => 'Local';

  @override
  String get environmentCommitOrPush => 'Commit or push';

  @override
  String get approvalQuestion => 'How should actions be approved?';

  @override
  String get approvalRequestTitle => 'Request approval';

  @override
  String get approvalRequestBody =>
      'Always ask before editing external files or using the internet.';

  @override
  String get approvalAutoTitle => 'Approve for me';

  @override
  String get approvalAutoBody =>
      'Only ask for actions detected as potentially risky.';

  @override
  String get approvalFullTitle => 'Full access';

  @override
  String get approvalFullBody =>
      'Unrestricted access to the internet and any file.';
}
