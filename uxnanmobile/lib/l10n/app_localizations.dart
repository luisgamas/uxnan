import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_es.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('es')
  ];

  /// The application name shown in the title bar and about screen.
  ///
  /// In en, this message translates to:
  /// **'Uxnan'**
  String get appTitle;

  /// Title shown on the home screen when there are no paired bridges yet.
  ///
  /// In en, this message translates to:
  /// **'No active sessions'**
  String get homeEmptyTitle;

  /// Body text shown on the empty home screen.
  ///
  /// In en, this message translates to:
  /// **'Pair your phone with a PC running the Uxnan bridge to get started.'**
  String get homeEmptyBody;

  /// Label for the button that starts the pairing flow.
  ///
  /// In en, this message translates to:
  /// **'Pair a device'**
  String get actionPairDevice;

  /// No description provided for @connectionConnected.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get connectionConnected;

  /// No description provided for @connectionConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting…'**
  String get connectionConnecting;

  /// No description provided for @connectionDisconnected.
  ///
  /// In en, this message translates to:
  /// **'Disconnected'**
  String get connectionDisconnected;

  /// No description provided for @connectionReconnecting.
  ///
  /// In en, this message translates to:
  /// **'Reconnecting…'**
  String get connectionReconnecting;

  /// No description provided for @onboardingSkip.
  ///
  /// In en, this message translates to:
  /// **'Skip'**
  String get onboardingSkip;

  /// No description provided for @onboardingNext.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get onboardingNext;

  /// No description provided for @onboardingBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get onboardingBack;

  /// No description provided for @onboardingGetStarted.
  ///
  /// In en, this message translates to:
  /// **'Get started'**
  String get onboardingGetStarted;

  /// Welcome page headline.
  ///
  /// In en, this message translates to:
  /// **'Control your agents from anywhere'**
  String get onboardingWelcomeTitle;

  /// No description provided for @onboardingWelcomeBody.
  ///
  /// In en, this message translates to:
  /// **'Uxnan is a secure remote control for the AI coding agents running on your PC.'**
  String get onboardingWelcomeBody;

  /// No description provided for @onboardingFeaturesTitle.
  ///
  /// In en, this message translates to:
  /// **'Built for the way you work'**
  String get onboardingFeaturesTitle;

  /// No description provided for @featureMultiAgentTitle.
  ///
  /// In en, this message translates to:
  /// **'Multi-agent'**
  String get featureMultiAgentTitle;

  /// No description provided for @featureMultiAgentBody.
  ///
  /// In en, this message translates to:
  /// **'Works with Codex, Claude Code, Gemini CLI, OpenCode and more — no lock-in.'**
  String get featureMultiAgentBody;

  /// No description provided for @featureE2eeTitle.
  ///
  /// In en, this message translates to:
  /// **'End-to-end encrypted'**
  String get featureE2eeTitle;

  /// No description provided for @featureE2eeBody.
  ///
  /// In en, this message translates to:
  /// **'Messages are encrypted on your devices. The relay only sees opaque envelopes.'**
  String get featureE2eeBody;

  /// No description provided for @featureLocalFirstTitle.
  ///
  /// In en, this message translates to:
  /// **'Local-first'**
  String get featureLocalFirstTitle;

  /// No description provided for @featureLocalFirstBody.
  ///
  /// In en, this message translates to:
  /// **'Your code and conversations stay on your machine, never on a third-party server.'**
  String get featureLocalFirstBody;

  /// No description provided for @onboardingInstallTitle.
  ///
  /// In en, this message translates to:
  /// **'Install the bridge on your PC'**
  String get onboardingInstallTitle;

  /// No description provided for @onboardingInstallBody.
  ///
  /// In en, this message translates to:
  /// **'Run this in a terminal on the computer where your agents live:'**
  String get onboardingInstallBody;

  /// No description provided for @onboardingInstallHint.
  ///
  /// In en, this message translates to:
  /// **'Keep the terminal open — it shows the pairing QR.'**
  String get onboardingInstallHint;

  /// No description provided for @onboardingPairTitle.
  ///
  /// In en, this message translates to:
  /// **'Pair your phone'**
  String get onboardingPairTitle;

  /// No description provided for @onboardingPairBody.
  ///
  /// In en, this message translates to:
  /// **'Scan the QR code shown by the bridge to establish a secure session.'**
  String get onboardingPairBody;

  /// No description provided for @actionScanQr.
  ///
  /// In en, this message translates to:
  /// **'Scan QR code'**
  String get actionScanQr;

  /// No description provided for @commandCopied.
  ///
  /// In en, this message translates to:
  /// **'Command copied to clipboard'**
  String get commandCopied;

  /// No description provided for @actionCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get actionCopy;

  /// No description provided for @qrScannerTitle.
  ///
  /// In en, this message translates to:
  /// **'Scan pairing QR'**
  String get qrScannerTitle;

  /// No description provided for @qrPermissionTitle.
  ///
  /// In en, this message translates to:
  /// **'Camera access needed'**
  String get qrPermissionTitle;

  /// No description provided for @qrPermissionBody.
  ///
  /// In en, this message translates to:
  /// **'Uxnan uses the camera only to scan the bridge\'s pairing QR code.'**
  String get qrPermissionBody;

  /// No description provided for @actionAllowCamera.
  ///
  /// In en, this message translates to:
  /// **'Allow camera'**
  String get actionAllowCamera;

  /// No description provided for @actionOpenSettings.
  ///
  /// In en, this message translates to:
  /// **'Open settings'**
  String get actionOpenSettings;

  /// No description provided for @qrHint.
  ///
  /// In en, this message translates to:
  /// **'Point the camera at the QR code in your bridge terminal.'**
  String get qrHint;

  /// No description provided for @qrErrorExpired.
  ///
  /// In en, this message translates to:
  /// **'This QR code has expired. Generate a new one on your PC.'**
  String get qrErrorExpired;

  /// No description provided for @qrErrorMalformed.
  ///
  /// In en, this message translates to:
  /// **'This isn\'t a valid Uxnan pairing code.'**
  String get qrErrorMalformed;

  /// No description provided for @pairingConnecting.
  ///
  /// In en, this message translates to:
  /// **'Establishing a secure session…'**
  String get pairingConnecting;

  /// No description provided for @updateRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Update required'**
  String get updateRequiredTitle;

  /// No description provided for @updateRequiredBody.
  ///
  /// In en, this message translates to:
  /// **'This bridge uses a newer pairing format. Update the Uxnan app to continue.'**
  String get updateRequiredBody;

  /// No description provided for @actionDismiss.
  ///
  /// In en, this message translates to:
  /// **'Dismiss'**
  String get actionDismiss;

  /// No description provided for @conversationTitle.
  ///
  /// In en, this message translates to:
  /// **'Conversation'**
  String get conversationTitle;

  /// No description provided for @conversationEmpty.
  ///
  /// In en, this message translates to:
  /// **'No messages yet'**
  String get conversationEmpty;

  /// No description provided for @conversationEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Send a message to start the conversation.'**
  String get conversationEmptyBody;

  /// No description provided for @composerHint.
  ///
  /// In en, this message translates to:
  /// **'Message…'**
  String get composerHint;

  /// No description provided for @composerSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get composerSend;

  /// No description provided for @composerAttach.
  ///
  /// In en, this message translates to:
  /// **'Attach'**
  String get composerAttach;

  /// No description provided for @composerVoice.
  ///
  /// In en, this message translates to:
  /// **'Voice input'**
  String get composerVoice;

  /// No description provided for @conversationPreview.
  ///
  /// In en, this message translates to:
  /// **'Preview conversation (demo)'**
  String get conversationPreview;

  /// No description provided for @environmentTitle.
  ///
  /// In en, this message translates to:
  /// **'Environment'**
  String get environmentTitle;

  /// No description provided for @environmentModel.
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get environmentModel;

  /// No description provided for @environmentContext.
  ///
  /// In en, this message translates to:
  /// **'Context'**
  String get environmentContext;

  /// No description provided for @environmentApprovalMode.
  ///
  /// In en, this message translates to:
  /// **'Approval mode'**
  String get environmentApprovalMode;

  /// No description provided for @environmentGit.
  ///
  /// In en, this message translates to:
  /// **'Git'**
  String get environmentGit;

  /// No description provided for @environmentBranch.
  ///
  /// In en, this message translates to:
  /// **'Branch'**
  String get environmentBranch;

  /// No description provided for @environmentLocal.
  ///
  /// In en, this message translates to:
  /// **'Local'**
  String get environmentLocal;

  /// No description provided for @environmentCommitOrPush.
  ///
  /// In en, this message translates to:
  /// **'Commit or push'**
  String get environmentCommitOrPush;

  /// No description provided for @approvalQuestion.
  ///
  /// In en, this message translates to:
  /// **'How should actions be approved?'**
  String get approvalQuestion;

  /// No description provided for @approvalRequestTitle.
  ///
  /// In en, this message translates to:
  /// **'Request approval'**
  String get approvalRequestTitle;

  /// No description provided for @approvalRequestBody.
  ///
  /// In en, this message translates to:
  /// **'Always ask before editing external files or using the internet.'**
  String get approvalRequestBody;

  /// No description provided for @approvalAutoTitle.
  ///
  /// In en, this message translates to:
  /// **'Approve for me'**
  String get approvalAutoTitle;

  /// No description provided for @approvalAutoBody.
  ///
  /// In en, this message translates to:
  /// **'Only ask for actions detected as potentially risky.'**
  String get approvalAutoBody;

  /// No description provided for @approvalFullTitle.
  ///
  /// In en, this message translates to:
  /// **'Full access'**
  String get approvalFullTitle;

  /// No description provided for @approvalFullBody.
  ///
  /// In en, this message translates to:
  /// **'Unrestricted access to the internet and any file.'**
  String get approvalFullBody;

  /// No description provided for @gitActionsTitle.
  ///
  /// In en, this message translates to:
  /// **'Source control'**
  String get gitActionsTitle;

  /// No description provided for @gitCleanState.
  ///
  /// In en, this message translates to:
  /// **'Working tree clean'**
  String get gitCleanState;

  /// No description provided for @gitDirtyState.
  ///
  /// In en, this message translates to:
  /// **'Uncommitted changes'**
  String get gitDirtyState;

  /// No description provided for @gitChangedFiles.
  ///
  /// In en, this message translates to:
  /// **'Changed files'**
  String get gitChangedFiles;

  /// No description provided for @gitCommitButton.
  ///
  /// In en, this message translates to:
  /// **'Commit'**
  String get gitCommitButton;

  /// No description provided for @gitPushButton.
  ///
  /// In en, this message translates to:
  /// **'Push'**
  String get gitPushButton;

  /// No description provided for @gitCommitTitle.
  ///
  /// In en, this message translates to:
  /// **'Commit changes'**
  String get gitCommitTitle;

  /// No description provided for @gitCommitHint.
  ///
  /// In en, this message translates to:
  /// **'Describe your changes…'**
  String get gitCommitHint;

  /// No description provided for @gitNoRepository.
  ///
  /// In en, this message translates to:
  /// **'No git repository'**
  String get gitNoRepository;

  /// No description provided for @gitNoRepositoryBody.
  ///
  /// In en, this message translates to:
  /// **'Open a workspace with a git repository to manage source control.'**
  String get gitNoRepositoryBody;

  /// No description provided for @gitRecent.
  ///
  /// In en, this message translates to:
  /// **'Recent activity'**
  String get gitRecent;

  /// No description provided for @gitActionFailed.
  ///
  /// In en, this message translates to:
  /// **'Git action failed'**
  String get gitActionFailed;

  /// No description provided for @gitCommitSuccess.
  ///
  /// In en, this message translates to:
  /// **'Changes committed'**
  String get gitCommitSuccess;

  /// No description provided for @gitPushSuccess.
  ///
  /// In en, this message translates to:
  /// **'Push complete'**
  String get gitPushSuccess;

  /// No description provided for @gitStatusAdded.
  ///
  /// In en, this message translates to:
  /// **'Added'**
  String get gitStatusAdded;

  /// No description provided for @gitStatusModified.
  ///
  /// In en, this message translates to:
  /// **'Modified'**
  String get gitStatusModified;

  /// No description provided for @gitStatusDeleted.
  ///
  /// In en, this message translates to:
  /// **'Deleted'**
  String get gitStatusDeleted;

  /// No description provided for @gitStatusRenamed.
  ///
  /// In en, this message translates to:
  /// **'Renamed'**
  String get gitStatusRenamed;

  /// No description provided for @gitStatusUntracked.
  ///
  /// In en, this message translates to:
  /// **'Untracked'**
  String get gitStatusUntracked;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'es'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
