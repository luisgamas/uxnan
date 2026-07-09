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

  /// Transport indicator: the live connection runs over the hosted relay.
  ///
  /// In en, this message translates to:
  /// **'Relay'**
  String get connectionRelay;

  /// Transport indicator: the live connection is a direct LAN/Tailscale link.
  ///
  /// In en, this message translates to:
  /// **'Direct'**
  String get connectionDirect;

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
  /// **'Works with Claude Code, Codex, Gemini, OpenCode and Pi — with more agents on the way. No lock-in.'**
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
  /// **'On the computer where your agents live, install the bridge once, then start it:'**
  String get onboardingInstallBody;

  /// No description provided for @onboardingInstallStepInstall.
  ///
  /// In en, this message translates to:
  /// **'1. Install (once)'**
  String get onboardingInstallStepInstall;

  /// No description provided for @onboardingInstallStepStart.
  ///
  /// In en, this message translates to:
  /// **'2. Start the bridge'**
  String get onboardingInstallStepStart;

  /// No description provided for @onboardingInstallRootNote.
  ///
  /// In en, this message translates to:
  /// **'The folder where you start the bridge becomes its root. From your phone you\'ll see every folder and repo under it — so you only start the bridge once, not separately for each project.'**
  String get onboardingInstallRootNote;

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

  /// No description provided for @qrCameraErrorTitle.
  ///
  /// In en, this message translates to:
  /// **'Camera unavailable'**
  String get qrCameraErrorTitle;

  /// No description provided for @qrCameraErrorBody.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t start the camera to scan. You can pair with a code instead, or try again.'**
  String get qrCameraErrorBody;

  /// No description provided for @actionRetry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get actionRetry;

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

  /// No description provided for @devicesTitle.
  ///
  /// In en, this message translates to:
  /// **'Devices'**
  String get devicesTitle;

  /// No description provided for @deviceActive.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get deviceActive;

  /// No description provided for @deviceConnect.
  ///
  /// In en, this message translates to:
  /// **'Connect'**
  String get deviceConnect;

  /// No description provided for @deviceConnectFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t reach {device}. Staying on the current PC.'**
  String deviceConnectFailed(String device);

  /// No description provided for @deviceLastSeenLabel.
  ///
  /// In en, this message translates to:
  /// **'Last seen'**
  String get deviceLastSeenLabel;

  /// No description provided for @deviceNeverConnected.
  ///
  /// In en, this message translates to:
  /// **'Never connected'**
  String get deviceNeverConnected;

  /// No description provided for @devicePairedLabel.
  ///
  /// In en, this message translates to:
  /// **'Paired'**
  String get devicePairedLabel;

  /// No description provided for @deviceRename.
  ///
  /// In en, this message translates to:
  /// **'Rename'**
  String get deviceRename;

  /// No description provided for @deviceVerifyConnection.
  ///
  /// In en, this message translates to:
  /// **'Verify connection'**
  String get deviceVerifyConnection;

  /// No description provided for @deviceVerifying.
  ///
  /// In en, this message translates to:
  /// **'Checking the bridge…'**
  String get deviceVerifying;

  /// No description provided for @deviceVerifyOk.
  ///
  /// In en, this message translates to:
  /// **'The bridge is reachable.'**
  String get deviceVerifyOk;

  /// No description provided for @deviceVerifyFailed.
  ///
  /// In en, this message translates to:
  /// **'The bridge did not respond. Reconnecting…'**
  String get deviceVerifyFailed;

  /// No description provided for @deviceNameTitle.
  ///
  /// In en, this message translates to:
  /// **'Device name'**
  String get deviceNameTitle;

  /// No description provided for @deviceNameHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Work MacBook'**
  String get deviceNameHint;

  /// Menu action that unpairs/removes a paired PC from the phone.
  ///
  /// In en, this message translates to:
  /// **'Remove device'**
  String get deviceRemove;

  /// Confirmation dialog title when removing a paired PC.
  ///
  /// In en, this message translates to:
  /// **'Remove {device}?'**
  String deviceRemoveTitle(String device);

  /// Confirmation dialog body for removing a paired PC.
  ///
  /// In en, this message translates to:
  /// **'Removes this PC and its conversations from your phone. You can pair again anytime.'**
  String get deviceRemoveBody;

  /// Confirm button label in the remove-device dialog.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get deviceRemoveConfirm;

  /// No description provided for @actionSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get actionSave;

  /// No description provided for @actionCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get actionCancel;

  /// No description provided for @actionApply.
  ///
  /// In en, this message translates to:
  /// **'Apply'**
  String get actionApply;

  /// No description provided for @threadsTitle.
  ///
  /// In en, this message translates to:
  /// **'Threads'**
  String get threadsTitle;

  /// No description provided for @threadsFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get threadsFilterAll;

  /// No description provided for @threadsFilterByAgent.
  ///
  /// In en, this message translates to:
  /// **'Agent'**
  String get threadsFilterByAgent;

  /// No description provided for @threadsFilterByProject.
  ///
  /// In en, this message translates to:
  /// **'Project'**
  String get threadsFilterByProject;

  /// No description provided for @threadsFilterScopeTooltip.
  ///
  /// In en, this message translates to:
  /// **'Filter scope'**
  String get threadsFilterScopeTooltip;

  /// No description provided for @threadsViewOptions.
  ///
  /// In en, this message translates to:
  /// **'View options'**
  String get threadsViewOptions;

  /// No description provided for @threadsSortBy.
  ///
  /// In en, this message translates to:
  /// **'Sort by'**
  String get threadsSortBy;

  /// No description provided for @threadsSortCreated.
  ///
  /// In en, this message translates to:
  /// **'Creation date'**
  String get threadsSortCreated;

  /// No description provided for @threadsSortName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get threadsSortName;

  /// No description provided for @threadsSortFolder.
  ///
  /// In en, this message translates to:
  /// **'Folder'**
  String get threadsSortFolder;

  /// No description provided for @threadsCompact.
  ///
  /// In en, this message translates to:
  /// **'Compact list'**
  String get threadsCompact;

  /// No description provided for @threadsMore.
  ///
  /// In en, this message translates to:
  /// **'More options'**
  String get threadsMore;

  /// No description provided for @threadsSearch.
  ///
  /// In en, this message translates to:
  /// **'Search threads'**
  String get threadsSearch;

  /// No description provided for @threadsSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search by name, ID, agent or folder'**
  String get threadsSearchHint;

  /// No description provided for @threadsSearchEmpty.
  ///
  /// In en, this message translates to:
  /// **'No threads match'**
  String get threadsSearchEmpty;

  /// No description provided for @threadsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No threads yet'**
  String get threadsEmpty;

  /// No description provided for @threadsNotConnected.
  ///
  /// In en, this message translates to:
  /// **'Not connected to this PC — showing a cached view.'**
  String get threadsNotConnected;

  /// No description provided for @threadsEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Threads from this PC will appear here. Pull down to refresh.'**
  String get threadsEmptyBody;

  /// No description provided for @threadActionRename.
  ///
  /// In en, this message translates to:
  /// **'Rename'**
  String get threadActionRename;

  /// No description provided for @threadActionCopyId.
  ///
  /// In en, this message translates to:
  /// **'Copy thread ID'**
  String get threadActionCopyId;

  /// No description provided for @threadActionFork.
  ///
  /// In en, this message translates to:
  /// **'Fork conversation'**
  String get threadActionFork;

  /// No description provided for @threadForkFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t fork this conversation'**
  String get threadForkFailed;

  /// No description provided for @conversationLoadEarlier.
  ///
  /// In en, this message translates to:
  /// **'Show earlier messages'**
  String get conversationLoadEarlier;

  /// No description provided for @conversationScrollToBottom.
  ///
  /// In en, this message translates to:
  /// **'Scroll to latest'**
  String get conversationScrollToBottom;

  /// No description provided for @threadActionArchive.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get threadActionArchive;

  /// No description provided for @threadActionUnarchive.
  ///
  /// In en, this message translates to:
  /// **'Unarchive'**
  String get threadActionUnarchive;

  /// No description provided for @threadActionDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get threadActionDelete;

  /// No description provided for @archivedTitle.
  ///
  /// In en, this message translates to:
  /// **'Archived'**
  String get archivedTitle;

  /// No description provided for @archivedEmpty.
  ///
  /// In en, this message translates to:
  /// **'No archived threads'**
  String get archivedEmpty;

  /// No description provided for @archivedEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Threads you archive are hidden here, not deleted. Long-press one to unarchive it.'**
  String get archivedEmptyBody;

  /// No description provided for @threadRenameTitle.
  ///
  /// In en, this message translates to:
  /// **'Rename thread'**
  String get threadRenameTitle;

  /// No description provided for @threadRenameHint.
  ///
  /// In en, this message translates to:
  /// **'Thread title'**
  String get threadRenameHint;

  /// No description provided for @threadIdCopied.
  ///
  /// In en, this message translates to:
  /// **'Thread ID copied'**
  String get threadIdCopied;

  /// No description provided for @threadResponding.
  ///
  /// In en, this message translates to:
  /// **'Responding…'**
  String get threadResponding;

  /// No description provided for @threadIdLabel.
  ///
  /// In en, this message translates to:
  /// **'Thread ID'**
  String get threadIdLabel;

  /// No description provided for @threadActionSessionInfo.
  ///
  /// In en, this message translates to:
  /// **'Session info'**
  String get threadActionSessionInfo;

  /// No description provided for @sessionInfoTitle.
  ///
  /// In en, this message translates to:
  /// **'Session info'**
  String get sessionInfoTitle;

  /// No description provided for @sessionInfoAgentSessionLabel.
  ///
  /// In en, this message translates to:
  /// **'Agent session ID'**
  String get sessionInfoAgentSessionLabel;

  /// No description provided for @sessionInfoUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Not available yet'**
  String get sessionInfoUnavailable;

  /// No description provided for @sessionInfoResumeHint.
  ///
  /// In en, this message translates to:
  /// **'Resume this conversation from the agent\'s CLI on your PC.'**
  String get sessionInfoResumeHint;

  /// No description provided for @sessionInfoCopied.
  ///
  /// In en, this message translates to:
  /// **'Copied to clipboard'**
  String get sessionInfoCopied;

  /// No description provided for @threadDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete thread?'**
  String get threadDeleteTitle;

  /// No description provided for @threadDeleteBody.
  ///
  /// In en, this message translates to:
  /// **'This removes the conversation from this device.'**
  String get threadDeleteBody;

  /// No description provided for @threadDeleteConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get threadDeleteConfirm;

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

  /// Header of the collapsible section showing the agent's reasoning.
  ///
  /// In en, this message translates to:
  /// **'Thinking'**
  String get conversationThinking;

  /// Header of the collapsible list of commands/tools an agent turn ran.
  ///
  /// In en, this message translates to:
  /// **'Work log'**
  String get conversationWorkLog;

  /// Header of the collapsible list of files an agent turn modified.
  ///
  /// In en, this message translates to:
  /// **'Changed files'**
  String get conversationChangedFiles;

  /// Action that copies the agent's full text answer.
  ///
  /// In en, this message translates to:
  /// **'Copy response'**
  String get conversationCopyResponse;

  /// Snackbar confirming the agent response was copied.
  ///
  /// In en, this message translates to:
  /// **'Response copied'**
  String get conversationResponseCopied;

  /// Action that copies the user's own message (revealed by tapping the bubble).
  ///
  /// In en, this message translates to:
  /// **'Copy message'**
  String get conversationCopyMessage;

  /// Snackbar confirming the user's message was copied.
  ///
  /// In en, this message translates to:
  /// **'Message copied'**
  String get conversationMessageCopied;

  /// Label of the diff summary strip above the composer.
  ///
  /// In en, this message translates to:
  /// **'Last edits'**
  String get conversationLastEdits;

  /// File count in the diff summary strip.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 file} other{{count} files}}'**
  String conversationFilesCount(int count);

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

  /// No description provided for @composerAttachGallery.
  ///
  /// In en, this message translates to:
  /// **'Photo library'**
  String get composerAttachGallery;

  /// No description provided for @composerAttachCamera.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get composerAttachCamera;

  /// No description provided for @composerAttachFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t attach that image'**
  String get composerAttachFailed;

  /// Tooltip on the button that cancels the in-flight agent turn (replaces Send while running).
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get composerStop;

  /// No description provided for @composerVoice.
  ///
  /// In en, this message translates to:
  /// **'Voice input'**
  String get composerVoice;

  /// Tooltip on the mic button while voice dictation is active.
  ///
  /// In en, this message translates to:
  /// **'Stop dictation'**
  String get composerVoiceStop;

  /// Snackbar shown when speech recognition can't be initialized (no permission / unsupported).
  ///
  /// In en, this message translates to:
  /// **'Voice input isn\'t available on this device.'**
  String get composerVoiceUnavailable;

  /// No description provided for @composerOptionsShow.
  ///
  /// In en, this message translates to:
  /// **'Show options'**
  String get composerOptionsShow;

  /// No description provided for @composerOptionsHide.
  ///
  /// In en, this message translates to:
  /// **'Hide options'**
  String get composerOptionsHide;

  /// Title of the composer '+' turn-tools sheet (attach + run options + approval) and tooltip of the '+' button.
  ///
  /// In en, this message translates to:
  /// **'Turn options'**
  String get composerTools;

  /// Header of the inline @-mention suggestion panel above the composer.
  ///
  /// In en, this message translates to:
  /// **'Files & folders'**
  String get composerMentionFilesTitle;

  /// No description provided for @composerMentionLoading.
  ///
  /// In en, this message translates to:
  /// **'Listing…'**
  String get composerMentionLoading;

  /// No description provided for @composerMentionEmpty.
  ///
  /// In en, this message translates to:
  /// **'No matching files'**
  String get composerMentionEmpty;

  /// No description provided for @composerMentionMore.
  ///
  /// In en, this message translates to:
  /// **'Keep typing to narrow results…'**
  String get composerMentionMore;

  /// No description provided for @composerMentionNoWorkspace.
  ///
  /// In en, this message translates to:
  /// **'No folder for this conversation'**
  String get composerMentionNoWorkspace;

  /// No description provided for @composerMentionError.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t list this folder'**
  String get composerMentionError;

  /// Header of the inline /-command palette above the composer.
  ///
  /// In en, this message translates to:
  /// **'Commands'**
  String get composerCommandsTitle;

  /// No description provided for @composerCommandsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No matching command'**
  String get composerCommandsEmpty;

  /// No description provided for @composerCmdFilesLabel.
  ///
  /// In en, this message translates to:
  /// **'Attach file or folder'**
  String get composerCmdFilesLabel;

  /// No description provided for @composerCmdFilesDesc.
  ///
  /// In en, this message translates to:
  /// **'Insert an @ reference to a file or folder'**
  String get composerCmdFilesDesc;

  /// No description provided for @composerCmdExplainLabel.
  ///
  /// In en, this message translates to:
  /// **'Explain'**
  String get composerCmdExplainLabel;

  /// No description provided for @composerCmdExplainTemplate.
  ///
  /// In en, this message translates to:
  /// **'Explain how this works: '**
  String get composerCmdExplainTemplate;

  /// No description provided for @composerCmdReviewLabel.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get composerCmdReviewLabel;

  /// No description provided for @composerCmdReviewTemplate.
  ///
  /// In en, this message translates to:
  /// **'Review this for bugs and improvements: '**
  String get composerCmdReviewTemplate;

  /// No description provided for @composerCmdFixLabel.
  ///
  /// In en, this message translates to:
  /// **'Fix'**
  String get composerCmdFixLabel;

  /// No description provided for @composerCmdFixTemplate.
  ///
  /// In en, this message translates to:
  /// **'Find and fix the bug in: '**
  String get composerCmdFixTemplate;

  /// No description provided for @composerCmdTestsLabel.
  ///
  /// In en, this message translates to:
  /// **'Tests'**
  String get composerCmdTestsLabel;

  /// No description provided for @composerCmdTestsTemplate.
  ///
  /// In en, this message translates to:
  /// **'Write tests for: '**
  String get composerCmdTestsTemplate;

  /// No description provided for @settingsPromptTemplatesTitle.
  ///
  /// In en, this message translates to:
  /// **'Prompt templates'**
  String get settingsPromptTemplatesTitle;

  /// No description provided for @settingsPromptTemplatesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Edit the / command palette snippets'**
  String get settingsPromptTemplatesSubtitle;

  /// No description provided for @promptTemplatesTitle.
  ///
  /// In en, this message translates to:
  /// **'Prompt templates'**
  String get promptTemplatesTitle;

  /// No description provided for @promptTemplatesAdd.
  ///
  /// In en, this message translates to:
  /// **'New template'**
  String get promptTemplatesAdd;

  /// No description provided for @promptTemplatesReset.
  ///
  /// In en, this message translates to:
  /// **'Reset to defaults'**
  String get promptTemplatesReset;

  /// No description provided for @promptTemplatesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No templates'**
  String get promptTemplatesEmpty;

  /// No description provided for @promptTemplatesEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Create snippets you can drop into a message from the composer\'s / palette.'**
  String get promptTemplatesEmptyBody;

  /// No description provided for @promptTemplatesNewTitle.
  ///
  /// In en, this message translates to:
  /// **'New template'**
  String get promptTemplatesNewTitle;

  /// No description provided for @promptTemplatesEditTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit template'**
  String get promptTemplatesEditTitle;

  /// No description provided for @promptTemplatesLabelField.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get promptTemplatesLabelField;

  /// No description provided for @promptTemplatesLabelHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Review'**
  String get promptTemplatesLabelHint;

  /// No description provided for @promptTemplatesBodyField.
  ///
  /// In en, this message translates to:
  /// **'Text'**
  String get promptTemplatesBodyField;

  /// No description provided for @promptTemplatesBodyHint.
  ///
  /// In en, this message translates to:
  /// **'The text inserted into the message'**
  String get promptTemplatesBodyHint;

  /// No description provided for @promptTemplatesDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete template?'**
  String get promptTemplatesDeleteTitle;

  /// Confirmation body when deleting a prompt template.
  ///
  /// In en, this message translates to:
  /// **'\"{label}\" will be removed.'**
  String promptTemplatesDeleteBody(String label);

  /// No description provided for @promptTemplatesDeleteConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get promptTemplatesDeleteConfirm;

  /// No description provided for @promptTemplatesResetTitle.
  ///
  /// In en, this message translates to:
  /// **'Reset templates?'**
  String get promptTemplatesResetTitle;

  /// No description provided for @promptTemplatesResetBody.
  ///
  /// In en, this message translates to:
  /// **'This restores the default templates and drops your edits.'**
  String get promptTemplatesResetBody;

  /// No description provided for @newThreadAction.
  ///
  /// In en, this message translates to:
  /// **'New conversation'**
  String get newThreadAction;

  /// No description provided for @newThreadTitle.
  ///
  /// In en, this message translates to:
  /// **'New conversation'**
  String get newThreadTitle;

  /// No description provided for @newThreadProject.
  ///
  /// In en, this message translates to:
  /// **'Project'**
  String get newThreadProject;

  /// No description provided for @newThreadWorkingDir.
  ///
  /// In en, this message translates to:
  /// **'Working directory'**
  String get newThreadWorkingDir;

  /// No description provided for @newThreadBrowse.
  ///
  /// In en, this message translates to:
  /// **'Browse…'**
  String get newThreadBrowse;

  /// No description provided for @newThreadChangeFolder.
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get newThreadChangeFolder;

  /// No description provided for @newThreadFolderLabel.
  ///
  /// In en, this message translates to:
  /// **'Folder'**
  String get newThreadFolderLabel;

  /// No description provided for @newThreadCapForking.
  ///
  /// In en, this message translates to:
  /// **'Forking'**
  String get newThreadCapForking;

  /// No description provided for @workspaceBrowseTitle.
  ///
  /// In en, this message translates to:
  /// **'Choose a folder'**
  String get workspaceBrowseTitle;

  /// No description provided for @workspaceBrowseOpenHere.
  ///
  /// In en, this message translates to:
  /// **'Open here'**
  String get workspaceBrowseOpenHere;

  /// No description provided for @workspaceBrowseEmpty.
  ///
  /// In en, this message translates to:
  /// **'No sub-folders here'**
  String get workspaceBrowseEmpty;

  /// No description provided for @workspaceBrowseFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t browse folders'**
  String get workspaceBrowseFailed;

  /// No description provided for @workspaceBrowseGitRepo.
  ///
  /// In en, this message translates to:
  /// **'Git repository'**
  String get workspaceBrowseGitRepo;

  /// Tooltip on the button that ascends to the parent folder in the workspace browser.
  ///
  /// In en, this message translates to:
  /// **'Up one folder'**
  String get workspaceBrowseUp;

  /// No description provided for @newThreadAgent.
  ///
  /// In en, this message translates to:
  /// **'Agent'**
  String get newThreadAgent;

  /// No description provided for @newThreadModel.
  ///
  /// In en, this message translates to:
  /// **'Model (optional)'**
  String get newThreadModel;

  /// No description provided for @newThreadModelHint.
  ///
  /// In en, this message translates to:
  /// **'Default model'**
  String get newThreadModelHint;

  /// No description provided for @newThreadStart.
  ///
  /// In en, this message translates to:
  /// **'Start conversation'**
  String get newThreadStart;

  /// No description provided for @modelPickerTitle.
  ///
  /// In en, this message translates to:
  /// **'Select model'**
  String get modelPickerTitle;

  /// No description provided for @modelPickerSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search models'**
  String get modelPickerSearchHint;

  /// No description provided for @modelPickerLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load models'**
  String get modelPickerLoadFailed;

  /// No description provided for @modelPickerEmpty.
  ///
  /// In en, this message translates to:
  /// **'No matching models'**
  String get modelPickerEmpty;

  /// No description provided for @modelPickerDefault.
  ///
  /// In en, this message translates to:
  /// **'Default'**
  String get modelPickerDefault;

  /// No description provided for @modelPickerRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh models'**
  String get modelPickerRefresh;

  /// No description provided for @newThreadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t start the conversation'**
  String get newThreadFailed;

  /// No description provided for @newThreadLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load from the bridge'**
  String get newThreadLoadFailed;

  /// No description provided for @newThreadNoProjects.
  ///
  /// In en, this message translates to:
  /// **'No projects available on this PC.'**
  String get newThreadNoProjects;

  /// No description provided for @newThreadNoAgents.
  ///
  /// In en, this message translates to:
  /// **'No agents available on this PC.'**
  String get newThreadNoAgents;

  /// No description provided for @newThreadAgentUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Unavailable'**
  String get newThreadAgentUnavailable;

  /// No description provided for @newThreadCapStreaming.
  ///
  /// In en, this message translates to:
  /// **'Streaming'**
  String get newThreadCapStreaming;

  /// No description provided for @newThreadCapPlan.
  ///
  /// In en, this message translates to:
  /// **'Plan mode'**
  String get newThreadCapPlan;

  /// No description provided for @newThreadCapApprovals.
  ///
  /// In en, this message translates to:
  /// **'Approvals'**
  String get newThreadCapApprovals;

  /// No description provided for @newThreadCapImages.
  ///
  /// In en, this message translates to:
  /// **'Images'**
  String get newThreadCapImages;

  /// No description provided for @newThreadCapAutonomous.
  ///
  /// In en, this message translates to:
  /// **'Autonomous mode'**
  String get newThreadCapAutonomous;

  /// No description provided for @newThreadCapabilities.
  ///
  /// In en, this message translates to:
  /// **'Capabilities'**
  String get newThreadCapabilities;

  /// No description provided for @newThreadWorktree.
  ///
  /// In en, this message translates to:
  /// **'Run in a worktree'**
  String get newThreadWorktree;

  /// No description provided for @newThreadWorktreeDesc.
  ///
  /// In en, this message translates to:
  /// **'Create an isolated branch checkout so this conversation can\'t touch your current working tree.'**
  String get newThreadWorktreeDesc;

  /// No description provided for @newThreadWorktreeBranchHint.
  ///
  /// In en, this message translates to:
  /// **'Branch name'**
  String get newThreadWorktreeBranchHint;

  /// No description provided for @newThreadWorktreeManaged.
  ///
  /// In en, this message translates to:
  /// **'Let the bridge pick the location'**
  String get newThreadWorktreeManaged;

  /// No description provided for @newThreadWorktreeFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t create the worktree'**
  String get newThreadWorktreeFailed;

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

  /// No description provided for @environmentActiveModel.
  ///
  /// In en, this message translates to:
  /// **'Active version'**
  String get environmentActiveModel;

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

  /// Title shown on a pending approval card while it is still actionable.
  ///
  /// In en, this message translates to:
  /// **'Needs approval'**
  String get approvalNeedsApproval;

  /// Title shown on a resolved approval card (after the user has chosen), replacing the actionable 'Needs approval' headline so the settled state reads at a glance.
  ///
  /// In en, this message translates to:
  /// **'Decision recorded'**
  String get approvalDecidedTitle;

  /// Prefix for the timestamp on a resolved approval card, formatted like 'Answered · 14:32' (today) or 'Answered · may 17 · 14:32' (older).
  ///
  /// In en, this message translates to:
  /// **'Answered'**
  String get approvalAnsweredAt;

  /// No description provided for @approvalActionFallback.
  ///
  /// In en, this message translates to:
  /// **'Action awaiting approval'**
  String get approvalActionFallback;

  /// No description provided for @approvalApprove.
  ///
  /// In en, this message translates to:
  /// **'Approve'**
  String get approvalApprove;

  /// No description provided for @approvalReject.
  ///
  /// In en, this message translates to:
  /// **'Reject'**
  String get approvalReject;

  /// No description provided for @approvalAllowSession.
  ///
  /// In en, this message translates to:
  /// **'Always allow this session'**
  String get approvalAllowSession;

  /// No description provided for @approvalApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get approvalApproved;

  /// No description provided for @approvalRejected.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get approvalRejected;

  /// No description provided for @approvalAllowedSession.
  ///
  /// In en, this message translates to:
  /// **'Allowed for this session'**
  String get approvalAllowedSession;

  /// No description provided for @approvalFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t send your response — try again'**
  String get approvalFailed;

  /// No description provided for @approvalRiskLow.
  ///
  /// In en, this message translates to:
  /// **'Low risk'**
  String get approvalRiskLow;

  /// No description provided for @approvalRiskMedium.
  ///
  /// In en, this message translates to:
  /// **'Medium risk'**
  String get approvalRiskMedium;

  /// No description provided for @approvalRiskHigh.
  ///
  /// In en, this message translates to:
  /// **'High risk'**
  String get approvalRiskHigh;

  /// No description provided for @approvalRiskUnknown.
  ///
  /// In en, this message translates to:
  /// **'Risk unknown'**
  String get approvalRiskUnknown;

  /// Title shown on a pending question card while it is still actionable.
  ///
  /// In en, this message translates to:
  /// **'Needs your answer'**
  String get questionNeedsAnswer;

  /// Title shown on a resolved question card (after the user has answered), replacing the actionable 'Needs your answer' headline so the settled state reads at a glance.
  ///
  /// In en, this message translates to:
  /// **'Answer recorded'**
  String get questionAnswered;

  /// Prefix for the timestamp on a resolved question card, formatted like 'Answered · 14:32' (today) or 'Answered · may 17 · 14:32' (older).
  ///
  /// In en, this message translates to:
  /// **'Answered'**
  String get questionAnsweredAt;

  /// Fallback badge label above a question when the agent did not provide a header.
  ///
  /// In en, this message translates to:
  /// **'Question'**
  String get questionHeaderFallback;

  /// Primary button that sends the user's chosen answers on a question card.
  ///
  /// In en, this message translates to:
  /// **'Submit'**
  String get questionSubmit;

  /// Secondary button that answers a question card with no selection (empty answers).
  ///
  /// In en, this message translates to:
  /// **'Skip'**
  String get questionSkip;

  /// Shown in place of the chosen labels on a resolved question card when the user skipped that question.
  ///
  /// In en, this message translates to:
  /// **'Skipped'**
  String get questionSkipped;

  /// Inline error shown on a question card when the bridge rejected the answer; the options re-enable so the user can retry.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t send your answer — try again'**
  String get questionFailed;

  /// Run-option value meaning 'leave the agent's default' (no explicit choice).
  ///
  /// In en, this message translates to:
  /// **'Auto'**
  String get runOptionAuto;

  /// Banner title shown when the active thread's agent is not logged in on the PC.
  ///
  /// In en, this message translates to:
  /// **'Agent not signed in'**
  String get authRequiresLoginTitle;

  /// Banner body explaining the agent must be logged in on the PC.
  ///
  /// In en, this message translates to:
  /// **'Sign in to this agent\'s CLI on your PC to start sending messages.'**
  String get authRequiresLoginBody;

  /// Banner shown while an interactive login is in progress on the PC.
  ///
  /// In en, this message translates to:
  /// **'Signing in on your PC…'**
  String get authLoginInProgress;

  /// Short marker shown on an agent (new-conversation card and threads-list dot) when it is not signed in on the PC.
  ///
  /// In en, this message translates to:
  /// **'Sign in required'**
  String get agentSignInRequired;

  /// Button on a not-signed-in agent card that re-queries the agent's sign-in status (after the user logs in on the PC).
  ///
  /// In en, this message translates to:
  /// **'Check sign-in'**
  String get agentCheckSignIn;

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

  /// No description provided for @gitSelectAll.
  ///
  /// In en, this message translates to:
  /// **'Select all'**
  String get gitSelectAll;

  /// No description provided for @gitDeselectAll.
  ///
  /// In en, this message translates to:
  /// **'Deselect all'**
  String get gitDeselectAll;

  /// No description provided for @gitSelectedCount.
  ///
  /// In en, this message translates to:
  /// **'{count} of {total} selected'**
  String gitSelectedCount(int count, int total);

  /// No description provided for @gitExpandAll.
  ///
  /// In en, this message translates to:
  /// **'Expand all'**
  String get gitExpandAll;

  /// No description provided for @gitCollapseAll.
  ///
  /// In en, this message translates to:
  /// **'Collapse all'**
  String get gitCollapseAll;

  /// No description provided for @gitDiffEmpty.
  ///
  /// In en, this message translates to:
  /// **'No textual changes to show.'**
  String get gitDiffEmpty;

  /// No description provided for @gitDiffError.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load this file\'s diff.'**
  String get gitDiffError;

  /// No description provided for @gitCommitMessageLabel.
  ///
  /// In en, this message translates to:
  /// **'Commit title'**
  String get gitCommitMessageLabel;

  /// No description provided for @gitCommitDescriptionLabel.
  ///
  /// In en, this message translates to:
  /// **'Description (optional)'**
  String get gitCommitDescriptionLabel;

  /// No description provided for @gitCommitDescriptionHint.
  ///
  /// In en, this message translates to:
  /// **'Add more detail about these changes…'**
  String get gitCommitDescriptionHint;

  /// No description provided for @gitCommitTitleRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a commit title'**
  String get gitCommitTitleRequired;

  /// No description provided for @gitCommitScopeAll.
  ///
  /// In en, this message translates to:
  /// **'Committing all changes'**
  String get gitCommitScopeAll;

  /// No description provided for @gitCommitScopeSelected.
  ///
  /// In en, this message translates to:
  /// **'Committing {count} selected file(s)'**
  String gitCommitScopeSelected(int count);

  /// No description provided for @gitCoAuthorAdd.
  ///
  /// In en, this message translates to:
  /// **'Add Co-author'**
  String get gitCoAuthorAdd;

  /// No description provided for @gitCoAuthorLabel.
  ///
  /// In en, this message translates to:
  /// **'Co-author'**
  String get gitCoAuthorLabel;

  /// No description provided for @gitCoAuthorHint.
  ///
  /// In en, this message translates to:
  /// **'Name <email>'**
  String get gitCoAuthorHint;

  /// No description provided for @gitCoAuthorInvalid.
  ///
  /// In en, this message translates to:
  /// **'Use the format: Name <email>'**
  String get gitCoAuthorInvalid;

  /// No description provided for @gitDiscard.
  ///
  /// In en, this message translates to:
  /// **'Discard'**
  String get gitDiscard;

  /// No description provided for @gitDiscardSelected.
  ///
  /// In en, this message translates to:
  /// **'Discard selected'**
  String get gitDiscardSelected;

  /// No description provided for @gitDiscardAll.
  ///
  /// In en, this message translates to:
  /// **'Discard all'**
  String get gitDiscardAll;

  /// No description provided for @gitDiscardConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Discard changes?'**
  String get gitDiscardConfirmTitle;

  /// No description provided for @gitDiscardConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'{count} file(s) will be reverted to the last commit, and any new files will be deleted. This can\'t be undone.'**
  String gitDiscardConfirmBody(int count);

  /// No description provided for @gitDiscardSuccess.
  ///
  /// In en, this message translates to:
  /// **'Changes discarded'**
  String get gitDiscardSuccess;

  /// No description provided for @gitCreatePr.
  ///
  /// In en, this message translates to:
  /// **'Create PR'**
  String get gitCreatePr;

  /// No description provided for @gitPrDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Open pull request'**
  String get gitPrDialogTitle;

  /// No description provided for @gitPrTitleLabel.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get gitPrTitleLabel;

  /// No description provided for @gitPrBodyLabel.
  ///
  /// In en, this message translates to:
  /// **'Description (optional)'**
  String get gitPrBodyLabel;

  /// No description provided for @gitPrBaseLabel.
  ///
  /// In en, this message translates to:
  /// **'Target branch (base)'**
  String get gitPrBaseLabel;

  /// No description provided for @gitPrHeadLabel.
  ///
  /// In en, this message translates to:
  /// **'Source branch (head)'**
  String get gitPrHeadLabel;

  /// No description provided for @gitPrPushNote.
  ///
  /// In en, this message translates to:
  /// **'The source branch is pushed to the remote before the PR is opened.'**
  String get gitPrPushNote;

  /// No description provided for @gitPrTitleRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a PR title'**
  String get gitPrTitleRequired;

  /// No description provided for @gitPrCreate.
  ///
  /// In en, this message translates to:
  /// **'Create'**
  String get gitPrCreate;

  /// No description provided for @gitPrSuccess.
  ///
  /// In en, this message translates to:
  /// **'Pull request opened'**
  String get gitPrSuccess;

  /// No description provided for @gitPrViewAction.
  ///
  /// In en, this message translates to:
  /// **'View'**
  String get gitPrViewAction;

  /// No description provided for @gitCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get gitCancel;

  /// No description provided for @gitSelectFilesFirst.
  ///
  /// In en, this message translates to:
  /// **'Select at least one file'**
  String get gitSelectFilesFirst;

  /// No description provided for @gitNothingToCommit.
  ///
  /// In en, this message translates to:
  /// **'No changes to commit'**
  String get gitNothingToCommit;

  /// No description provided for @gitRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get gitRefresh;

  /// No description provided for @gitUndoCommit.
  ///
  /// In en, this message translates to:
  /// **'Undo last commit'**
  String get gitUndoCommit;

  /// No description provided for @gitUndoCommitConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Undo last commit?'**
  String get gitUndoCommitConfirmTitle;

  /// No description provided for @gitUndoCommitConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'The last commit is undone but its changes are kept, so you can adjust and commit again before pushing.'**
  String get gitUndoCommitConfirmBody;

  /// No description provided for @gitUndoCommitSuccess.
  ///
  /// In en, this message translates to:
  /// **'Last commit undone'**
  String get gitUndoCommitSuccess;

  /// No description provided for @gitPushConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Push commits?'**
  String get gitPushConfirmTitle;

  /// No description provided for @gitPushConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'This publishes your commits to the remote and can\'t be undone.'**
  String get gitPushConfirmBody;

  /// No description provided for @gitPrConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Open pull request?'**
  String get gitPrConfirmTitle;

  /// No description provided for @gitPrConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'A pull request can\'t be deleted from the repository, but you can close it later from the GitHub app or website.'**
  String get gitPrConfirmBody;

  /// No description provided for @gitPrFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open the pull request'**
  String get gitPrFailed;

  /// No description provided for @gitSwitchBranch.
  ///
  /// In en, this message translates to:
  /// **'Switch branch'**
  String get gitSwitchBranch;

  /// No description provided for @gitPull.
  ///
  /// In en, this message translates to:
  /// **'Pull'**
  String get gitPull;

  /// No description provided for @gitPullSuccess.
  ///
  /// In en, this message translates to:
  /// **'Pulled from the remote'**
  String get gitPullSuccess;

  /// No description provided for @gitNewBranch.
  ///
  /// In en, this message translates to:
  /// **'New branch'**
  String get gitNewBranch;

  /// No description provided for @gitNewBranchHint.
  ///
  /// In en, this message translates to:
  /// **'Branch name'**
  String get gitNewBranchHint;

  /// No description provided for @gitNewBranchSuccess.
  ///
  /// In en, this message translates to:
  /// **'Branch created and checked out'**
  String get gitNewBranchSuccess;

  /// No description provided for @gitNewWorktree.
  ///
  /// In en, this message translates to:
  /// **'New worktree'**
  String get gitNewWorktree;

  /// No description provided for @gitNewWorktreeSuccess.
  ///
  /// In en, this message translates to:
  /// **'Worktree created'**
  String get gitNewWorktreeSuccess;

  /// No description provided for @gitSwitchBranchTitle.
  ///
  /// In en, this message translates to:
  /// **'Switch branch'**
  String get gitSwitchBranchTitle;

  /// No description provided for @gitSwitchBranchCurrent.
  ///
  /// In en, this message translates to:
  /// **'On {branch}'**
  String gitSwitchBranchCurrent(String branch);

  /// No description provided for @gitSwitchCarryTitle.
  ///
  /// In en, this message translates to:
  /// **'Move your changes?'**
  String get gitSwitchCarryTitle;

  /// No description provided for @gitSwitchCarryBody.
  ///
  /// In en, this message translates to:
  /// **'You have uncommitted changes. Carry them to {target}, or leave them on {current}? Left changes are saved and restored when you switch back.'**
  String gitSwitchCarryBody(String target, String current);

  /// No description provided for @gitSwitchCarry.
  ///
  /// In en, this message translates to:
  /// **'Carry changes'**
  String get gitSwitchCarry;

  /// No description provided for @gitSwitchLeave.
  ///
  /// In en, this message translates to:
  /// **'Leave on current'**
  String get gitSwitchLeave;

  /// No description provided for @gitSwitchSuccess.
  ///
  /// In en, this message translates to:
  /// **'Switched to {branch}'**
  String gitSwitchSuccess(String branch);

  /// No description provided for @gitHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get gitHistoryTitle;

  /// No description provided for @gitHistoryButton.
  ///
  /// In en, this message translates to:
  /// **'View history'**
  String get gitHistoryButton;

  /// No description provided for @gitHistoryListView.
  ///
  /// In en, this message translates to:
  /// **'List'**
  String get gitHistoryListView;

  /// No description provided for @gitHistoryGraphView.
  ///
  /// In en, this message translates to:
  /// **'Graph'**
  String get gitHistoryGraphView;

  /// No description provided for @gitHistoryViewTooltip.
  ///
  /// In en, this message translates to:
  /// **'Toggle view'**
  String get gitHistoryViewTooltip;

  /// No description provided for @gitHistoryCompact.
  ///
  /// In en, this message translates to:
  /// **'Compact view'**
  String get gitHistoryCompact;

  /// No description provided for @gitHistoryComfortable.
  ///
  /// In en, this message translates to:
  /// **'Comfortable view'**
  String get gitHistoryComfortable;

  /// No description provided for @gitHistoryShowGraph.
  ///
  /// In en, this message translates to:
  /// **'Show graph lines'**
  String get gitHistoryShowGraph;

  /// No description provided for @gitHistoryHideGraph.
  ///
  /// In en, this message translates to:
  /// **'Hide graph lines'**
  String get gitHistoryHideGraph;

  /// No description provided for @gitHistoryBackToTop.
  ///
  /// In en, this message translates to:
  /// **'Back to top'**
  String get gitHistoryBackToTop;

  /// No description provided for @gitHistorySearch.
  ///
  /// In en, this message translates to:
  /// **'Search commits'**
  String get gitHistorySearch;

  /// No description provided for @gitHistorySearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search by message, SHA or author'**
  String get gitHistorySearchHint;

  /// No description provided for @gitHistorySearchEmpty.
  ///
  /// In en, this message translates to:
  /// **'No commits match'**
  String get gitHistorySearchEmpty;

  /// No description provided for @gitHistoryViewBranch.
  ///
  /// In en, this message translates to:
  /// **'View branch or ref'**
  String get gitHistoryViewBranch;

  /// No description provided for @gitHistoryPickBranchTitle.
  ///
  /// In en, this message translates to:
  /// **'View history of…'**
  String get gitHistoryPickBranchTitle;

  /// No description provided for @gitHistoryHeadOption.
  ///
  /// In en, this message translates to:
  /// **'Current branch (HEAD)'**
  String get gitHistoryHeadOption;

  /// No description provided for @gitHistoryLocalSection.
  ///
  /// In en, this message translates to:
  /// **'Local branches'**
  String get gitHistoryLocalSection;

  /// No description provided for @gitHistoryRemoteSection.
  ///
  /// In en, this message translates to:
  /// **'Remote branches'**
  String get gitHistoryRemoteSection;

  /// Header chip shown when the history is being viewed from a non-default ref (a branch/tag), not the current HEAD.
  ///
  /// In en, this message translates to:
  /// **'Viewing {ref}'**
  String gitHistoryViewingRef(String ref);

  /// No description provided for @gitHistoryDiffSection.
  ///
  /// In en, this message translates to:
  /// **'Diff'**
  String get gitHistoryDiffSection;

  /// No description provided for @gitHistoryDiffTruncated.
  ///
  /// In en, this message translates to:
  /// **'Diff truncated — too large to show in full.'**
  String get gitHistoryDiffTruncated;

  /// No description provided for @gitHistoryNoFileChanges.
  ///
  /// In en, this message translates to:
  /// **'No file changes in this commit.'**
  String get gitHistoryNoFileChanges;

  /// No description provided for @gitHistoryNoTextDiff.
  ///
  /// In en, this message translates to:
  /// **'No textual changes.'**
  String get gitHistoryNoTextDiff;

  /// No description provided for @gitHistoryBinaryDiff.
  ///
  /// In en, this message translates to:
  /// **'Binary file — no text diff.'**
  String get gitHistoryBinaryDiff;

  /// Secondary label on a renamed file in the commit detail, showing the previous path.
  ///
  /// In en, this message translates to:
  /// **'from {oldPath}'**
  String gitHistoryRenamedFrom(String oldPath);

  /// No description provided for @gitHistoryDetailLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load this commit'**
  String get gitHistoryDetailLoadFailed;

  /// No description provided for @gitHistoryEmpty.
  ///
  /// In en, this message translates to:
  /// **'No commits yet'**
  String get gitHistoryEmpty;

  /// No description provided for @gitHistoryEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Once you commit changes they\'ll show up here.'**
  String get gitHistoryEmptyBody;

  /// No description provided for @gitHistoryLoadMore.
  ///
  /// In en, this message translates to:
  /// **'Load older commits'**
  String get gitHistoryLoadMore;

  /// No description provided for @gitHistoryLoadingMore.
  ///
  /// In en, this message translates to:
  /// **'Loading…'**
  String get gitHistoryLoadingMore;

  /// No description provided for @gitHistoryErrorTitle.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load commit history'**
  String get gitHistoryErrorTitle;

  /// No description provided for @gitHistoryRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get gitHistoryRetry;

  /// No description provided for @gitHistoryMergeBadge.
  ///
  /// In en, this message translates to:
  /// **'Merge'**
  String get gitHistoryMergeBadge;

  /// No description provided for @gitHistoryCommitBy.
  ///
  /// In en, this message translates to:
  /// **'by {name}'**
  String gitHistoryCommitBy(String name);

  /// No description provided for @gitHistoryParentsLabel.
  ///
  /// In en, this message translates to:
  /// **'Parents'**
  String get gitHistoryParentsLabel;

  /// No description provided for @gitHistoryDetailsTitle.
  ///
  /// In en, this message translates to:
  /// **'Commit details'**
  String get gitHistoryDetailsTitle;

  /// No description provided for @gitHistoryDetailsMessage.
  ///
  /// In en, this message translates to:
  /// **'Full message'**
  String get gitHistoryDetailsMessage;

  /// No description provided for @gitHistoryDetailsAuthor.
  ///
  /// In en, this message translates to:
  /// **'Author'**
  String get gitHistoryDetailsAuthor;

  /// No description provided for @gitHistoryDetailsCommitter.
  ///
  /// In en, this message translates to:
  /// **'Committer'**
  String get gitHistoryDetailsCommitter;

  /// No description provided for @gitHistoryDetailsDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get gitHistoryDetailsDate;

  /// No description provided for @gitHistoryDetailsStats.
  ///
  /// In en, this message translates to:
  /// **'Changes'**
  String get gitHistoryDetailsStats;

  /// No description provided for @gitHistoryDetailsFiles.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 file changed} other{{count} files changed}}'**
  String gitHistoryDetailsFiles(int count);

  /// No description provided for @gitHistoryDetailsParents.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 parent} other{{count} parents}}'**
  String gitHistoryDetailsParents(int count);

  /// No description provided for @gitHistoryCopySha.
  ///
  /// In en, this message translates to:
  /// **'Copy SHA'**
  String get gitHistoryCopySha;

  /// No description provided for @gitHistoryCopiedSha.
  ///
  /// In en, this message translates to:
  /// **'SHA copied'**
  String get gitHistoryCopiedSha;

  /// No description provided for @gitHistoryCopyMessage.
  ///
  /// In en, this message translates to:
  /// **'Copy message'**
  String get gitHistoryCopyMessage;

  /// No description provided for @gitHistoryCopiedMessage.
  ///
  /// In en, this message translates to:
  /// **'Message copied'**
  String get gitHistoryCopiedMessage;

  /// No description provided for @gitHistoryFilesTouched.
  ///
  /// In en, this message translates to:
  /// **'{additions} additions, {deletions} deletions, {files} files'**
  String gitHistoryFilesTouched(int additions, int deletions, int files);

  /// Name of the Android notification channel for agent activity.
  ///
  /// In en, this message translates to:
  /// **'Agent activity'**
  String get pushChannelName;

  /// Description of the Android notification channel.
  ///
  /// In en, this message translates to:
  /// **'Turn completions and errors from your coding agents.'**
  String get pushChannelDescription;

  /// Notification title used when the thread name is unknown.
  ///
  /// In en, this message translates to:
  /// **'Uxnan'**
  String get pushFallbackTitle;

  /// Body of the turn-completed notification (titled with the thread name).
  ///
  /// In en, this message translates to:
  /// **'{agent} replied'**
  String pushTurnCompletedBody(String agent);

  /// Body of the turn-error notification.
  ///
  /// In en, this message translates to:
  /// **'{agent} reported an error'**
  String pushTurnErrorBody(String agent);

  /// Title of the app settings screen (and its app-bar action tooltip).
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// Section header for the notification preferences.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get settingsNotificationsSection;

  /// Helper text under the notification preference toggles.
  ///
  /// In en, this message translates to:
  /// **'Choose which agent events notify you. These apply to background push and on-device notifications.'**
  String get settingsNotificationsHint;

  /// Title of the turn-completed notification toggle.
  ///
  /// In en, this message translates to:
  /// **'Replies'**
  String get settingsTurnCompletedTitle;

  /// Subtitle of the turn-completed notification toggle.
  ///
  /// In en, this message translates to:
  /// **'Notify me when an agent finishes responding.'**
  String get settingsTurnCompletedSubtitle;

  /// Title of the turn-error notification toggle.
  ///
  /// In en, this message translates to:
  /// **'Errors'**
  String get settingsTurnErrorTitle;

  /// Subtitle of the turn-error notification toggle.
  ///
  /// In en, this message translates to:
  /// **'Notify me when an agent run fails.'**
  String get settingsTurnErrorSubtitle;

  /// Section header for conversation-view preferences.
  ///
  /// In en, this message translates to:
  /// **'Conversation'**
  String get settingsConversationSection;

  /// Title of the toggle that shows the agent's reasoning section.
  ///
  /// In en, this message translates to:
  /// **'Show agent thinking'**
  String get settingsShowThinkingTitle;

  /// Subtitle of the show-thinking toggle.
  ///
  /// In en, this message translates to:
  /// **'Display the agent\'s reasoning in a collapsible section.'**
  String get settingsShowThinkingSubtitle;

  /// Title of the toggle that jumps the conversation to the bottom when you send a message.
  ///
  /// In en, this message translates to:
  /// **'Scroll to latest on send'**
  String get settingsScrollOnSendTitle;

  /// Subtitle of the scroll-on-send toggle.
  ///
  /// In en, this message translates to:
  /// **'Jump to your message when you send, even if you\'ve scrolled up.'**
  String get settingsScrollOnSendSubtitle;

  /// Title of the setting choosing what the above-composer context indicator shows.
  ///
  /// In en, this message translates to:
  /// **'Context indicator'**
  String get settingsContextIndicatorTitle;

  /// Subtitle of the context-indicator setting.
  ///
  /// In en, this message translates to:
  /// **'Show the context-window percentage, the token count, or both.'**
  String get settingsContextIndicatorSubtitle;

  /// Context-indicator option: show the context-window usage percentage.
  ///
  /// In en, this message translates to:
  /// **'Percentage'**
  String get settingsContextIndicatorPercentage;

  /// Context-indicator option: show the raw token count.
  ///
  /// In en, this message translates to:
  /// **'Tokens'**
  String get settingsContextIndicatorTokens;

  /// Context-indicator option: show both the token count and the percentage.
  ///
  /// In en, this message translates to:
  /// **'Both'**
  String get settingsContextIndicatorBoth;

  /// No description provided for @settingsGitSection.
  ///
  /// In en, this message translates to:
  /// **'Source control'**
  String get settingsGitSection;

  /// No description provided for @settingsConfirmPushTitle.
  ///
  /// In en, this message translates to:
  /// **'Confirm before push'**
  String get settingsConfirmPushTitle;

  /// No description provided for @settingsConfirmPushSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Ask before pushing — a push can\'t be undone.'**
  String get settingsConfirmPushSubtitle;

  /// No description provided for @settingsConfirmPrTitle.
  ///
  /// In en, this message translates to:
  /// **'Confirm before pull request'**
  String get settingsConfirmPrTitle;

  /// No description provided for @settingsConfirmPrSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Ask before opening a pull request.'**
  String get settingsConfirmPrSubtitle;

  /// Header for the settings section that controls the AI model picker.
  ///
  /// In en, this message translates to:
  /// **'Models'**
  String get settingsModelsSection;

  /// Title of the toggle that shows/hides Claude Code's opus/sonnet/haiku “latest” alias models in the model picker.
  ///
  /// In en, this message translates to:
  /// **'Show Claude Code “latest” models'**
  String get settingsClaudeLatestTitle;

  /// Subtitle of the Claude Code latest-models toggle.
  ///
  /// In en, this message translates to:
  /// **'List the Opus, Sonnet and Haiku “(latest)” aliases in the model picker.'**
  String get settingsClaudeLatestSubtitle;

  /// Explanatory note under the Claude Code latest-models toggle, describing what the latest aliases do.
  ///
  /// In en, this message translates to:
  /// **'The “(latest)” aliases always route to the newest version of each tier your account can use, so you don\'t have to pick an exact one. Turn this off to hide them and choose only pinned, exact versions. Conversations already using an alias keep working.'**
  String get settingsClaudeLatestHint;

  /// No description provided for @settingsAppearanceSection.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get settingsAppearanceSection;

  /// No description provided for @settingsPersonalizationTitle.
  ///
  /// In en, this message translates to:
  /// **'Personalization'**
  String get settingsPersonalizationTitle;

  /// No description provided for @settingsPersonalizationSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Theme, custom themes and language'**
  String get settingsPersonalizationSubtitle;

  /// No description provided for @personalizationTitle.
  ///
  /// In en, this message translates to:
  /// **'Personalization'**
  String get personalizationTitle;

  /// No description provided for @personalizationThemeSection.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get personalizationThemeSection;

  /// No description provided for @themeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get themeSystem;

  /// No description provided for @themeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get themeLight;

  /// No description provided for @themeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get themeDark;

  /// Label for the 'custom theme' option in the theme-mode selector. Selecting this disables the system/light/dark controls and lets the user author or pick a custom theme.
  ///
  /// In en, this message translates to:
  /// **'Custom'**
  String get themeCustom;

  /// No description provided for @personalizationCustomThemeSection.
  ///
  /// In en, this message translates to:
  /// **'Custom theme'**
  String get personalizationCustomThemeSection;

  /// No description provided for @personalizationCustomThemeDescription.
  ///
  /// In en, this message translates to:
  /// **'Design every Material 3 color role, export to JSON, or import a theme someone shared with you.'**
  String get personalizationCustomThemeDescription;

  /// No description provided for @personalizationCustomThemeAuthor.
  ///
  /// In en, this message translates to:
  /// **'New theme'**
  String get personalizationCustomThemeAuthor;

  /// No description provided for @personalizationCustomThemeAuthorSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Start from a seed color and fine-tune every role'**
  String get personalizationCustomThemeAuthorSubtitle;

  /// No description provided for @personalizationCustomThemeEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit current theme'**
  String get personalizationCustomThemeEdit;

  /// No description provided for @personalizationCustomThemeEditSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Tweak the light and dark color roles'**
  String get personalizationCustomThemeEditSubtitle;

  /// No description provided for @personalizationCustomThemeReset.
  ///
  /// In en, this message translates to:
  /// **'Use the default theme'**
  String get personalizationCustomThemeReset;

  /// No description provided for @personalizationCustomThemeResetSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Discard the custom theme and return to the brand baseline'**
  String get personalizationCustomThemeResetSubtitle;

  /// No description provided for @customThemeEditorTitle.
  ///
  /// In en, this message translates to:
  /// **'Custom theme'**
  String get customThemeEditorTitle;

  /// No description provided for @customThemeEditorLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get customThemeEditorLight;

  /// No description provided for @customThemeEditorDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get customThemeEditorDark;

  /// No description provided for @customThemeEditorName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get customThemeEditorName;

  /// No description provided for @customThemeEditorDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get customThemeEditorDescription;

  /// No description provided for @customThemeEditorNameHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Midnight Purple'**
  String get customThemeEditorNameHint;

  /// No description provided for @customThemeEditorDescriptionHint.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get customThemeEditorDescriptionHint;

  /// No description provided for @customThemeEditorDeriveFromSeed.
  ///
  /// In en, this message translates to:
  /// **'Derive from seed'**
  String get customThemeEditorDeriveFromSeed;

  /// No description provided for @customThemeEditorSeedHint.
  ///
  /// In en, this message translates to:
  /// **'Seed color'**
  String get customThemeEditorSeedHint;

  /// No description provided for @customThemeEditorRole.
  ///
  /// In en, this message translates to:
  /// **'Role'**
  String get customThemeEditorRole;

  /// No description provided for @customThemeEditorResetRole.
  ///
  /// In en, this message translates to:
  /// **'Reset role'**
  String get customThemeEditorResetRole;

  /// No description provided for @customThemeEditorResetBrightness.
  ///
  /// In en, this message translates to:
  /// **'Reset brightness'**
  String get customThemeEditorResetBrightness;

  /// No description provided for @customThemeEditorExport.
  ///
  /// In en, this message translates to:
  /// **'Export'**
  String get customThemeEditorExport;

  /// No description provided for @customThemeEditorImport.
  ///
  /// In en, this message translates to:
  /// **'Import'**
  String get customThemeEditorImport;

  /// No description provided for @customThemeEditorSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get customThemeEditorSave;

  /// No description provided for @customThemeEditorExportDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Theme JSON'**
  String get customThemeEditorExportDialogTitle;

  /// No description provided for @customThemeEditorExportDialogBody.
  ///
  /// In en, this message translates to:
  /// **'Share the JSON below — paste it into any device signed in to your account to recreate the theme.'**
  String get customThemeEditorExportDialogBody;

  /// No description provided for @customThemeEditorImportDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Import theme'**
  String get customThemeEditorImportDialogTitle;

  /// No description provided for @customThemeEditorImportDialogBody.
  ///
  /// In en, this message translates to:
  /// **'Paste a theme JSON exported from another device.'**
  String get customThemeEditorImportDialogBody;

  /// No description provided for @customThemeEditorImportFieldHint.
  ///
  /// In en, this message translates to:
  /// **'Paste theme JSON here'**
  String get customThemeEditorImportFieldHint;

  /// No description provided for @customThemeEditorCopied.
  ///
  /// In en, this message translates to:
  /// **'Theme JSON copied to clipboard'**
  String get customThemeEditorCopied;

  /// No description provided for @customThemeEditorImported.
  ///
  /// In en, this message translates to:
  /// **'Theme imported'**
  String get customThemeEditorImported;

  /// No description provided for @customThemeEditorImportFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not import theme — check the JSON.'**
  String get customThemeEditorImportFailed;

  /// No description provided for @customThemeEditorResetConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Reset theme?'**
  String get customThemeEditorResetConfirmTitle;

  /// No description provided for @customThemeEditorResetConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'The current custom theme will be discarded and the app will return to the brand baseline.'**
  String get customThemeEditorResetConfirmBody;

  /// No description provided for @customThemeEditorResetConfirmAction.
  ///
  /// In en, this message translates to:
  /// **'Reset'**
  String get customThemeEditorResetConfirmAction;

  /// No description provided for @customThemeEditorDeriveSeedTitle.
  ///
  /// In en, this message translates to:
  /// **'Derive from seed'**
  String get customThemeEditorDeriveSeedTitle;

  /// No description provided for @customThemeEditorDeriveSeedBody.
  ///
  /// In en, this message translates to:
  /// **'Pick a single seed color; every role for the selected brightness will be regenerated from it via Material 3.'**
  String get customThemeEditorDeriveSeedBody;

  /// No description provided for @customThemeEditorPickColorTitle.
  ///
  /// In en, this message translates to:
  /// **'Pick color'**
  String get customThemeEditorPickColorTitle;

  /// No description provided for @customThemeEditorResetRoleConfirm.
  ///
  /// In en, this message translates to:
  /// **'Reset this role to its derived value?'**
  String get customThemeEditorResetRoleConfirm;

  /// No description provided for @customThemeEditorDefaultName.
  ///
  /// In en, this message translates to:
  /// **'Custom theme'**
  String get customThemeEditorDefaultName;

  /// No description provided for @customThemeEditorSaved.
  ///
  /// In en, this message translates to:
  /// **'Theme JSON saved'**
  String get customThemeEditorSaved;

  /// No description provided for @customThemeEditorSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t save the theme JSON'**
  String get customThemeEditorSaveFailed;

  /// No description provided for @customThemeEditorShareFile.
  ///
  /// In en, this message translates to:
  /// **'Share file'**
  String get customThemeEditorShareFile;

  /// No description provided for @personalizationLanguageSection.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get personalizationLanguageSection;

  /// Label for the master switch on the Personalization screen. When on, the active custom theme replaces System/Light/Dark; when off, the segmented mode picker drives the app theme.
  ///
  /// In en, this message translates to:
  /// **'Use a custom theme'**
  String get personalizationUseCustomThemeLabel;

  /// No description provided for @personalizationUseCustomThemeSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Replace System/Light/Dark with one of your saved themes.'**
  String get personalizationUseCustomThemeSubtitle;

  /// Section title for the collapsible list of saved custom themes on the Personalization screen.
  ///
  /// In en, this message translates to:
  /// **'Custom themes'**
  String get personalizationCustomThemesHeader;

  /// Badge shown next to a custom theme that is currently applied to the app.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get personalizationCustomThemeActiveBadge;

  /// Badge shown next to one of the shipped example themes that cannot be deleted from the library.
  ///
  /// In en, this message translates to:
  /// **'Built-in'**
  String get personalizationCustomThemeBuiltInBadge;

  /// No description provided for @personalizationCustomThemeExport.
  ///
  /// In en, this message translates to:
  /// **'Export JSON'**
  String get personalizationCustomThemeExport;

  /// No description provided for @personalizationCustomThemeExportCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy to clipboard'**
  String get personalizationCustomThemeExportCopy;

  /// No description provided for @personalizationCustomThemeExportFile.
  ///
  /// In en, this message translates to:
  /// **'Save to file'**
  String get personalizationCustomThemeExportFile;

  /// No description provided for @personalizationCustomThemeNewDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'New custom theme'**
  String get personalizationCustomThemeNewDialogTitle;

  /// No description provided for @personalizationCustomThemeNewDialogBody.
  ///
  /// In en, this message translates to:
  /// **'Pick a seed color and the brightness the new theme should target.'**
  String get personalizationCustomThemeNewDialogBody;

  /// No description provided for @personalizationCustomThemeDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get personalizationCustomThemeDelete;

  /// No description provided for @personalizationCustomThemeDeleteConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete theme?'**
  String get personalizationCustomThemeDeleteConfirmTitle;

  /// No description provided for @personalizationCustomThemeDeleteConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'This removes the theme from your library. This can\'t be undone.'**
  String get personalizationCustomThemeDeleteConfirmBody;

  /// No description provided for @personalizationCustomThemeDeleteConfirmAction.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get personalizationCustomThemeDeleteConfirmAction;

  /// No description provided for @personalizationCustomThemeDeleteFailed.
  ///
  /// In en, this message translates to:
  /// **'Built-in themes can\'t be deleted'**
  String get personalizationCustomThemeDeleteFailed;

  /// No description provided for @personalizationCustomThemesImportAction.
  ///
  /// In en, this message translates to:
  /// **'Import theme'**
  String get personalizationCustomThemesImportAction;

  /// No description provided for @personalizationCustomThemesImportActionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Paste a single theme or a list of themes as JSON'**
  String get personalizationCustomThemesImportActionSubtitle;

  /// No description provided for @personalizationCustomThemesExportAllAction.
  ///
  /// In en, this message translates to:
  /// **'Export all themes'**
  String get personalizationCustomThemesExportAllAction;

  /// No description provided for @personalizationCustomThemesExportAllActionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Copy the whole library as a single JSON document'**
  String get personalizationCustomThemesExportAllActionSubtitle;

  /// No description provided for @personalizationCustomThemesResetAction.
  ///
  /// In en, this message translates to:
  /// **'Reset library'**
  String get personalizationCustomThemesResetAction;

  /// No description provided for @personalizationCustomThemesResetActionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Restore the built-in examples and discard authored themes'**
  String get personalizationCustomThemesResetActionSubtitle;

  /// No description provided for @personalizationCustomThemesImportDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Import theme'**
  String get personalizationCustomThemesImportDialogTitle;

  /// No description provided for @personalizationCustomThemesImportDialogBody.
  ///
  /// In en, this message translates to:
  /// **'Paste a theme JSON exported from another device. You can paste a single theme or a JSON array of themes to import them all at once.'**
  String get personalizationCustomThemesImportDialogBody;

  /// No description provided for @personalizationCustomThemesImportFieldHint.
  ///
  /// In en, this message translates to:
  /// **'Paste theme JSON here'**
  String get personalizationCustomThemesImportFieldHint;

  /// Button that imports theme JSON by picking a .json file from the device.
  ///
  /// In en, this message translates to:
  /// **'From file'**
  String get themeImportFromFile;

  /// Button that imports theme JSON by fetching it from an http(s) URL.
  ///
  /// In en, this message translates to:
  /// **'From URL'**
  String get themeImportFromUrl;

  /// Title of the dialog that asks for a URL to fetch a theme JSON from.
  ///
  /// In en, this message translates to:
  /// **'Import from URL'**
  String get themeImportUrlTitle;

  /// Hint text for the theme-import URL field.
  ///
  /// In en, this message translates to:
  /// **'https://…/theme.json'**
  String get themeImportUrlHint;

  /// Confirm button that fetches the theme JSON from the entered URL.
  ///
  /// In en, this message translates to:
  /// **'Fetch'**
  String get themeImportUrlFetch;

  /// Error shown when the theme-import URL is malformed.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid http(s):// URL.'**
  String get themeImportUrlInvalid;

  /// Error shown when fetching a theme JSON from the URL fails.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t fetch a theme from that URL.'**
  String get themeImportUrlError;

  /// Error shown when the picked theme .json file can't be read.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t read that file.'**
  String get themeImportFileError;

  /// Snackbar text shown after a successful import. The number of themes imported is appended in the message.
  ///
  /// In en, this message translates to:
  /// **'Theme imported'**
  String get personalizationCustomThemesImportSuccess;

  /// No description provided for @personalizationCustomThemesImportPartial.
  ///
  /// In en, this message translates to:
  /// **'Some themes couldn\'t be imported'**
  String get personalizationCustomThemesImportPartial;

  /// No description provided for @personalizationCustomThemesImportFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not import — check the JSON'**
  String get personalizationCustomThemesImportFailed;

  /// No description provided for @personalizationCustomThemesCopied.
  ///
  /// In en, this message translates to:
  /// **'Theme JSON copied to clipboard'**
  String get personalizationCustomThemesCopied;

  /// No description provided for @personalizationCustomThemesCopiedAll.
  ///
  /// In en, this message translates to:
  /// **'Library JSON copied to clipboard'**
  String get personalizationCustomThemesCopiedAll;

  /// No description provided for @personalizationCustomThemesSaved.
  ///
  /// In en, this message translates to:
  /// **'Library JSON saved'**
  String get personalizationCustomThemesSaved;

  /// No description provided for @personalizationCustomThemesSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t save the library JSON'**
  String get personalizationCustomThemesSaveFailed;

  /// No description provided for @themeManagerTitle.
  ///
  /// In en, this message translates to:
  /// **'Themes'**
  String get themeManagerTitle;

  /// No description provided for @themeManagerEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No themes yet'**
  String get themeManagerEmptyTitle;

  /// No description provided for @themeManagerEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Create one from a seed color or import a theme JSON.'**
  String get themeManagerEmptyBody;

  /// No description provided for @themeBrightnessDual.
  ///
  /// In en, this message translates to:
  /// **'Light & dark'**
  String get themeBrightnessDual;

  /// No description provided for @themeBrightnessLightOnly.
  ///
  /// In en, this message translates to:
  /// **'Light only'**
  String get themeBrightnessLightOnly;

  /// No description provided for @themeBrightnessDarkOnly.
  ///
  /// In en, this message translates to:
  /// **'Dark only'**
  String get themeBrightnessDarkOnly;

  /// No description provided for @themeManagerSelectedCount.
  ///
  /// In en, this message translates to:
  /// **'{count} selected'**
  String themeManagerSelectedCount(int count);

  /// No description provided for @themeManagerSelectAll.
  ///
  /// In en, this message translates to:
  /// **'Select all'**
  String get themeManagerSelectAll;

  /// No description provided for @themeManagerExitSelection.
  ///
  /// In en, this message translates to:
  /// **'Cancel selection'**
  String get themeManagerExitSelection;

  /// No description provided for @themeManagerDeleteSelectedTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete selected themes?'**
  String get themeManagerDeleteSelectedTitle;

  /// No description provided for @themeManagerDeleteSelectedBody.
  ///
  /// In en, this message translates to:
  /// **'This removes {count} theme(s) from your library. Built-in themes are kept and can\'t be deleted. This can\'t be undone.'**
  String themeManagerDeleteSelectedBody(int count);

  /// No description provided for @themeManagerBuiltInsSkipped.
  ///
  /// In en, this message translates to:
  /// **'Built-in themes can\'t be deleted and were kept.'**
  String get themeManagerBuiltInsSkipped;

  /// No description provided for @themeNewSheetBody.
  ///
  /// In en, this message translates to:
  /// **'Pick a seed color. We\'ll generate a full Material 3 light and dark theme you can fine-tune.'**
  String get themeNewSheetBody;

  /// No description provided for @themeNewSheetCreate.
  ///
  /// In en, this message translates to:
  /// **'Create & edit'**
  String get themeNewSheetCreate;

  /// No description provided for @customThemeEditorAddDarkSide.
  ///
  /// In en, this message translates to:
  /// **'Add a dark side'**
  String get customThemeEditorAddDarkSide;

  /// No description provided for @customThemeEditorAddLightSide.
  ///
  /// In en, this message translates to:
  /// **'Add a light side'**
  String get customThemeEditorAddLightSide;

  /// No description provided for @customThemeEditorSingleNote.
  ///
  /// In en, this message translates to:
  /// **'Only the {brightness} side is defined; the other is generated automatically.'**
  String customThemeEditorSingleNote(String brightness);

  /// No description provided for @personalizationManageThemesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'{count} saved'**
  String personalizationManageThemesSubtitle(int count);

  /// No description provided for @languageSystemDefault.
  ///
  /// In en, this message translates to:
  /// **'System default'**
  String get languageSystemDefault;

  /// Short release-stage label (e.g. ALPHA / BETA / STABLE) shown in the devices-screen footer to communicate the maturity of the build.
  ///
  /// In en, this message translates to:
  /// **'ALPHA'**
  String get appVersionStage;

  /// No description provided for @actionEnterCode.
  ///
  /// In en, this message translates to:
  /// **'Enter a code instead'**
  String get actionEnterCode;

  /// No description provided for @manualCodeTitle.
  ///
  /// In en, this message translates to:
  /// **'Pair with a code'**
  String get manualCodeTitle;

  /// No description provided for @manualCodeIntro.
  ///
  /// In en, this message translates to:
  /// **'On your PC, the bridge shows a host and a short pairing code. Enter them here to pair without scanning a QR.'**
  String get manualCodeIntro;

  /// No description provided for @manualCodeHostLabel.
  ///
  /// In en, this message translates to:
  /// **'Bridge host'**
  String get manualCodeHostLabel;

  /// No description provided for @manualCodeHostHint.
  ///
  /// In en, this message translates to:
  /// **'192.168.1.100:19850'**
  String get manualCodeHostHint;

  /// No description provided for @manualCodeCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Pairing code'**
  String get manualCodeCodeLabel;

  /// No description provided for @manualCodeCodeHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 7Q4K2F9P'**
  String get manualCodeCodeHint;

  /// No description provided for @manualCodeConnect.
  ///
  /// In en, this message translates to:
  /// **'Pair'**
  String get manualCodeConnect;

  /// No description provided for @manualCodeConnecting.
  ///
  /// In en, this message translates to:
  /// **'Resolving code…'**
  String get manualCodeConnecting;

  /// No description provided for @manualCodeFormTitle.
  ///
  /// In en, this message translates to:
  /// **'Bridge details'**
  String get manualCodeFormTitle;

  /// No description provided for @manualCodeBrowse.
  ///
  /// In en, this message translates to:
  /// **'Browse nearby bridges'**
  String get manualCodeBrowse;

  /// No description provided for @manualCodeBrowseHint.
  ///
  /// In en, this message translates to:
  /// **'Find a bridge on your Wi-Fi automatically'**
  String get manualCodeBrowseHint;

  /// No description provided for @bridgeDiscoveryTitle.
  ///
  /// In en, this message translates to:
  /// **'Nearby bridges'**
  String get bridgeDiscoveryTitle;

  /// No description provided for @bridgeDiscoverySearching.
  ///
  /// In en, this message translates to:
  /// **'Searching your network…'**
  String get bridgeDiscoverySearching;

  /// No description provided for @bridgeDiscoveryEmpty.
  ///
  /// In en, this message translates to:
  /// **'No bridges found yet. Make sure the bridge is running on the same Wi-Fi, or type the host below.'**
  String get bridgeDiscoveryEmpty;

  /// No description provided for @manualCodeErrorInvalidInput.
  ///
  /// In en, this message translates to:
  /// **'Enter the bridge host and the pairing code.'**
  String get manualCodeErrorInvalidInput;

  /// No description provided for @manualCodeErrorNetwork.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t reach the bridge. Check the host and that the bridge is running on the same network.'**
  String get manualCodeErrorNetwork;

  /// No description provided for @manualCodeErrorInvalidCode.
  ///
  /// In en, this message translates to:
  /// **'That code is wrong or has expired. Generate a new one on your PC.'**
  String get manualCodeErrorInvalidCode;

  /// No description provided for @manualCodeErrorRateLimited.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts. Wait a moment and try again.'**
  String get manualCodeErrorRateLimited;

  /// No description provided for @manualCodeErrorServer.
  ///
  /// In en, this message translates to:
  /// **'The bridge couldn\'t complete pairing. Try again.'**
  String get manualCodeErrorServer;

  /// No description provided for @manualCodeErrorPayload.
  ///
  /// In en, this message translates to:
  /// **'The bridge sent an invalid pairing response.'**
  String get manualCodeErrorPayload;

  /// No description provided for @gitRevertLast.
  ///
  /// In en, this message translates to:
  /// **'Revert last commit'**
  String get gitRevertLast;

  /// No description provided for @gitRevertConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Revert the last commit?'**
  String get gitRevertConfirmTitle;

  /// No description provided for @gitRevertConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'Creates a new commit that undoes the last one. History is kept (unlike Undo commit). You can push it like any commit.'**
  String get gitRevertConfirmBody;

  /// No description provided for @gitRevertSuccess.
  ///
  /// In en, this message translates to:
  /// **'Last commit reverted'**
  String get gitRevertSuccess;

  /// No description provided for @gitRemoveWorktree.
  ///
  /// In en, this message translates to:
  /// **'Remove worktree'**
  String get gitRemoveWorktree;

  /// No description provided for @gitRemoveWorktreeConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove this worktree?'**
  String get gitRemoveWorktreeConfirmTitle;

  /// No description provided for @gitRemoveWorktreeConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'Deletes the worktree folder backing this conversation (the branch is kept). The conversation\'s workspace will no longer exist.'**
  String get gitRemoveWorktreeConfirmBody;

  /// No description provided for @gitRemoveWorktreeForceTitle.
  ///
  /// In en, this message translates to:
  /// **'Worktree has changes'**
  String get gitRemoveWorktreeForceTitle;

  /// No description provided for @gitRemoveWorktreeForceBody.
  ///
  /// In en, this message translates to:
  /// **'The worktree has uncommitted or untracked changes. Force-remove and lose them?'**
  String get gitRemoveWorktreeForceBody;

  /// No description provided for @gitForceRemove.
  ///
  /// In en, this message translates to:
  /// **'Force remove'**
  String get gitForceRemove;

  /// No description provided for @gitDeleteBranch.
  ///
  /// In en, this message translates to:
  /// **'Delete branch'**
  String get gitDeleteBranch;

  /// No description provided for @gitDeleteBranchConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete branch?'**
  String get gitDeleteBranchConfirmTitle;

  /// No description provided for @gitDeleteBranchConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'Delete the local branch \"{branch}\"?'**
  String gitDeleteBranchConfirmBody(String branch);

  /// No description provided for @gitDeleteBranchForceTitle.
  ///
  /// In en, this message translates to:
  /// **'Branch not merged'**
  String get gitDeleteBranchForceTitle;

  /// No description provided for @gitDeleteBranchForceBody.
  ///
  /// In en, this message translates to:
  /// **'\"{branch}\" isn\'t fully merged. Force-delete and lose its unmerged commits?'**
  String gitDeleteBranchForceBody(String branch);

  /// No description provided for @gitForceDelete.
  ///
  /// In en, this message translates to:
  /// **'Force delete'**
  String get gitForceDelete;

  /// No description provided for @conversationCwdMissing.
  ///
  /// In en, this message translates to:
  /// **'This conversation\'s folder no longer exists. Reconnect or remove it.'**
  String get conversationCwdMissing;

  /// No description provided for @conversationAutonomousMode.
  ///
  /// In en, this message translates to:
  /// **'This agent runs in autonomous mode — it acts and edits without asking for approval first.'**
  String get conversationAutonomousMode;

  /// Title of the workspace file browser and its top-bar tooltip.
  ///
  /// In en, this message translates to:
  /// **'Files'**
  String get fileBrowserTitle;

  /// Settings-menu toggle that controls whether file extensions are visible in the file browser list.
  ///
  /// In en, this message translates to:
  /// **'Show file extensions'**
  String get fileBrowserShowExtensions;

  /// Settings-menu toggle that controls whether dotfiles (names starting with '.') are visible in the file browser list.
  ///
  /// In en, this message translates to:
  /// **'Show hidden files'**
  String get fileBrowserShowHidden;

  /// Settings-menu toggle that controls whether each file row shows a details line (size and last-modified date) under its name.
  ///
  /// In en, this message translates to:
  /// **'Show file details'**
  String get fileBrowserShowDetails;

  /// Settings-menu toggle that switches the file browser to denser, shorter rows (off by default, where rows are taller).
  ///
  /// In en, this message translates to:
  /// **'Compact rows'**
  String get fileBrowserCompactRows;

  /// App-bar action in the file browser that collapses every expanded folder at once.
  ///
  /// In en, this message translates to:
  /// **'Collapse all folders'**
  String get fileBrowserCollapseAll;

  /// Tooltip on the button in the file browser's status bar that copies the workspace root path.
  ///
  /// In en, this message translates to:
  /// **'Copy workspace path'**
  String get fileBrowserCopyPath;

  /// Snackbar shown when the workspace path is copied to the clipboard.
  ///
  /// In en, this message translates to:
  /// **'Workspace path copied'**
  String get fileBrowserPathCopied;

  /// Body of the empty-state shown when a workspace directory contains no entries.
  ///
  /// In en, this message translates to:
  /// **'This folder is empty'**
  String get fileBrowserEmpty;

  /// Title of the empty-state shown when a workspace directory contains no entries.
  ///
  /// In en, this message translates to:
  /// **'Nothing here'**
  String get fileBrowserEmptyTitle;

  /// Title of the error state shown when the file browser fails to load a directory.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the workspace'**
  String get fileBrowserLoadFailed;

  /// Tooltip on the conversation top-bar action that opens the workspace file browser.
  ///
  /// In en, this message translates to:
  /// **'Browse files'**
  String get fileBrowserOpenTooltip;

  /// Tooltip on the action that switches the file viewer from the markdown preview to the raw source.
  ///
  /// In en, this message translates to:
  /// **'View source'**
  String get fileViewerViewSource;

  /// Tooltip on the action that switches the file viewer from the raw source to the markdown preview.
  ///
  /// In en, this message translates to:
  /// **'View preview'**
  String get fileViewerViewPreview;

  /// Tooltip on the action that enables the git diff overlay in the file viewer.
  ///
  /// In en, this message translates to:
  /// **'Show diff'**
  String get fileViewerShowDiff;

  /// Tooltip on the action that disables the git diff overlay in the file viewer.
  ///
  /// In en, this message translates to:
  /// **'Hide diff'**
  String get fileViewerHideDiff;

  /// Tooltip on the action that copies the file's content to the clipboard.
  ///
  /// In en, this message translates to:
  /// **'Copy file'**
  String get fileViewerCopy;

  /// Snackbar shown when the file content is copied to the clipboard.
  ///
  /// In en, this message translates to:
  /// **'File copied'**
  String get fileViewerCopied;

  /// Snackbar shown when the file content cannot be copied (e.g. a binary read returned no payload).
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t copy this file'**
  String get fileViewerCopyFailed;

  /// Snackbar shown when a link tapped in the Markdown preview is copied to the clipboard (the viewer never opens an external browser).
  ///
  /// In en, this message translates to:
  /// **'Link copied: {href}'**
  String fileViewerLinkCopied(String href);

  /// Title of the binary-file placeholder shown in the file viewer when the content is base64-encoded.
  ///
  /// In en, this message translates to:
  /// **'Binary file'**
  String get fileViewerBinaryTitle;

  /// Body of the binary-file placeholder explaining that the file can't be previewed on the phone.
  ///
  /// In en, this message translates to:
  /// **'Binary files can\'t be previewed on the phone. Pull the file to your PC to inspect it.'**
  String get fileViewerBinaryBody;

  /// Title of the error state shown when the file viewer fails to load a file.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open this file'**
  String get fileViewerLoadFailed;

  /// Mode pill label shown in the file viewer's footer when a markdown file is rendered as a styled preview.
  ///
  /// In en, this message translates to:
  /// **'Preview'**
  String get fileViewerModePreview;

  /// Mode pill label shown in the file viewer's footer when a markdown file is rendered as raw text.
  ///
  /// In en, this message translates to:
  /// **'Source'**
  String get fileViewerModeSource;

  /// Tooltip on the action that switches the file viewer into the inline text editor.
  ///
  /// In en, this message translates to:
  /// **'Edit file'**
  String get fileViewerEdit;

  /// Tooltip on the action that saves the edited file content back to the workspace.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get fileViewerSave;

  /// Snackbar shown when an edited file is written back to the workspace.
  ///
  /// In en, this message translates to:
  /// **'File saved'**
  String get fileViewerSaved;

  /// Snackbar shown when saving an edited file fails, with the bridge error.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t save this file: {error}'**
  String fileViewerSaveFailed(String error);

  /// Title of the dialog confirming the user wants to discard unsaved edits.
  ///
  /// In en, this message translates to:
  /// **'Discard changes?'**
  String get fileViewerDiscardTitle;

  /// Body of the dialog confirming the user wants to discard unsaved edits.
  ///
  /// In en, this message translates to:
  /// **'Your edits to this file haven\'t been saved. Discard them?'**
  String get fileViewerDiscardBody;

  /// Confirm button that discards the unsaved edits and leaves the editor.
  ///
  /// In en, this message translates to:
  /// **'Discard'**
  String get fileViewerDiscard;

  /// Cancel button that keeps the unsaved edits and stays in the editor.
  ///
  /// In en, this message translates to:
  /// **'Keep editing'**
  String get fileViewerKeepEditing;

  /// Settings section header for the app-update / version checker.
  ///
  /// In en, this message translates to:
  /// **'Updates'**
  String get settingsUpdatesSection;

  /// Title of the settings tile that checks the store for a newer app version.
  ///
  /// In en, this message translates to:
  /// **'Check for updates'**
  String get updateCheckTitle;

  /// Subtitle of the update-check settings tile.
  ///
  /// In en, this message translates to:
  /// **'See if a newer version of Uxnan is available.'**
  String get updateCheckSubtitle;

  /// Button that runs an update check immediately.
  ///
  /// In en, this message translates to:
  /// **'Check now'**
  String get updateCheckAction;

  /// Status shown while an update check is in flight.
  ///
  /// In en, this message translates to:
  /// **'Checking for updates…'**
  String get updateStatusChecking;

  /// Status shown when no newer version is available.
  ///
  /// In en, this message translates to:
  /// **'You\'re on the latest version.'**
  String get updateStatusUpToDate;

  /// Status shown when the platform/build has no in-app update mechanism (e.g. a sideloaded build, or a platform other than Android/iOS).
  ///
  /// In en, this message translates to:
  /// **'In-app updates aren\'t available for this build.'**
  String get updateStatusUnsupported;

  /// Status shown when an update check failed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t check for updates. Try again later.'**
  String get updateStatusError;

  /// Title of the update-available banner and card.
  ///
  /// In en, this message translates to:
  /// **'Update available'**
  String get updateAvailableTitle;

  /// Body of the update-available banner when the version is unknown.
  ///
  /// In en, this message translates to:
  /// **'A new version of Uxnan is ready to install.'**
  String get updateAvailableBody;

  /// Body of the update-available banner when the new version is known.
  ///
  /// In en, this message translates to:
  /// **'Uxnan {version} is ready to install.'**
  String updateAvailableBodyVersion(String version);

  /// Button that starts applying the available update (Play flow on Android, App Store on iOS).
  ///
  /// In en, this message translates to:
  /// **'Update'**
  String get updateAction;

  /// Label of the update button while the update flow is being launched.
  ///
  /// In en, this message translates to:
  /// **'Starting…'**
  String get updateActionStarting;

  /// Button that dismisses the update banner for the current version.
  ///
  /// In en, this message translates to:
  /// **'Not now'**
  String get updateDismissAction;

  /// Title of the informational banner shown when the paired PC's Uxnan bridge is outdated.
  ///
  /// In en, this message translates to:
  /// **'Bridge update available'**
  String get bridgeUpdateTitle;

  /// Body of the bridge-update banner when the latest bridge version is unknown.
  ///
  /// In en, this message translates to:
  /// **'Your PC\'s Uxnan bridge is out of date. Update it on your computer for the latest features and fixes.'**
  String get bridgeUpdateBody;

  /// Body of the bridge-update banner when the latest bridge version is known.
  ///
  /// In en, this message translates to:
  /// **'A newer bridge ({version}) is available. Update it on your computer for the latest features and fixes.'**
  String bridgeUpdateBodyVersion(String version);

  /// Accessibility label / tooltip for the button that dismisses the bridge-update banner.
  ///
  /// In en, this message translates to:
  /// **'Dismiss'**
  String get bridgeUpdateDismiss;

  /// Label above the store release notes for the available update.
  ///
  /// In en, this message translates to:
  /// **'What\'s new'**
  String get updateWhatsNewLabel;

  /// Label for the installed app version row in the Updates section.
  ///
  /// In en, this message translates to:
  /// **'Current version'**
  String get updateCurrentVersionTitle;

  /// Button that starts the in-app background download of the available update (Android).
  ///
  /// In en, this message translates to:
  /// **'Download'**
  String get updateDownloadAction;

  /// Button that installs a downloaded update (Android; the app restarts).
  ///
  /// In en, this message translates to:
  /// **'Install now'**
  String get updateInstallAction;

  /// Status shown while the update downloads in the background.
  ///
  /// In en, this message translates to:
  /// **'Downloading update…'**
  String get updateStatusDownloading;

  /// Status shown while the update downloads, with a percentage.
  ///
  /// In en, this message translates to:
  /// **'Downloading update… {percent}%'**
  String updateStatusDownloadingPercent(int percent);

  /// Status shown when a flexible update finished downloading.
  ///
  /// In en, this message translates to:
  /// **'Update downloaded — ready to install.'**
  String get updateStatusDownloaded;

  /// Status shown while the downloaded update is being installed.
  ///
  /// In en, this message translates to:
  /// **'Installing update…'**
  String get updateStatusInstalling;

  /// Header above the automatic check-interval selector.
  ///
  /// In en, this message translates to:
  /// **'Check automatically'**
  String get updateIntervalSectionTitle;

  /// Check-interval option: check on every app launch.
  ///
  /// In en, this message translates to:
  /// **'Every launch'**
  String get updateIntervalEveryLaunch;

  /// Check-interval option: every 6 hours.
  ///
  /// In en, this message translates to:
  /// **'Every 6 hours'**
  String get updateIntervalEvery6h;

  /// Check-interval option: every 12 hours.
  ///
  /// In en, this message translates to:
  /// **'Every 12 hours'**
  String get updateIntervalEvery12h;

  /// Check-interval option: every 24 hours (the default).
  ///
  /// In en, this message translates to:
  /// **'Every day'**
  String get updateIntervalEvery24h;

  /// Check-interval option: every 48 hours.
  ///
  /// In en, this message translates to:
  /// **'Every 2 days'**
  String get updateIntervalEvery48h;

  /// Check-interval option: weekly.
  ///
  /// In en, this message translates to:
  /// **'Every week'**
  String get updateIntervalWeekly;

  /// Check-interval option: monthly.
  ///
  /// In en, this message translates to:
  /// **'Every month'**
  String get updateIntervalMonthly;

  /// Settings landing subtitle for the Notifications section.
  ///
  /// In en, this message translates to:
  /// **'Replies, errors and delivery'**
  String get settingsNotificationsNavSubtitle;

  /// Settings landing subtitle for the Conversation section.
  ///
  /// In en, this message translates to:
  /// **'Thinking, models, context and templates'**
  String get settingsConversationNavSubtitle;

  /// Settings landing subtitle for the Models section.
  ///
  /// In en, this message translates to:
  /// **'Model picker options'**
  String get settingsModelsNavSubtitle;

  /// Settings landing subtitle for the Source control section.
  ///
  /// In en, this message translates to:
  /// **'Push and pull-request confirmations'**
  String get settingsGitNavSubtitle;

  /// Settings landing subtitle for the Updates section.
  ///
  /// In en, this message translates to:
  /// **'Version, check schedule and install'**
  String get settingsUpdatesNavSubtitle;

  /// Header for the About group on the settings landing.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get settingsAboutSection;

  /// Title of the About section (app info and developer).
  ///
  /// In en, this message translates to:
  /// **'About Uxnan'**
  String get settingsAboutTitle;

  /// Settings landing subtitle for the About section.
  ///
  /// In en, this message translates to:
  /// **'App info and developer'**
  String get settingsAboutSubtitle;

  /// Title of the open-source licenses screen.
  ///
  /// In en, this message translates to:
  /// **'Open-source licenses'**
  String get settingsLicensesTitle;

  /// Settings/About subtitle for the open-source licenses entry.
  ///
  /// In en, this message translates to:
  /// **'Third-party packages Uxnan uses'**
  String get settingsLicensesSubtitle;

  /// One-line description of the app on the About screen.
  ///
  /// In en, this message translates to:
  /// **'Drive your PC coding agents from your phone — end-to-end encrypted.'**
  String get aboutDescription;

  /// Header for the developer group on the About screen.
  ///
  /// In en, this message translates to:
  /// **'Developer'**
  String get aboutDeveloperSection;

  /// About screen row that opens the project's source repository.
  ///
  /// In en, this message translates to:
  /// **'Source code'**
  String get aboutSourceCodeTitle;

  /// Subtitle for the source-code row on the About screen.
  ///
  /// In en, this message translates to:
  /// **'View the project on GitHub'**
  String get aboutSourceCodeSubtitle;

  /// Header for the legal group on the About screen.
  ///
  /// In en, this message translates to:
  /// **'Legal'**
  String get aboutLegalSection;

  /// Installed app version shown on the About screen.
  ///
  /// In en, this message translates to:
  /// **'Version {version}'**
  String aboutVersionLabel(String version);

  /// Shown when the license registry has no entries.
  ///
  /// In en, this message translates to:
  /// **'No licenses found.'**
  String get licensesEmpty;

  /// Number of licenses a package registered.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 license} other{{count} licenses}}'**
  String licenseCountLabel(int count);

  /// Settings landing group header for General (appearance, notifications).
  ///
  /// In en, this message translates to:
  /// **'General'**
  String get settingsGeneralSection;

  /// Settings landing group header for Workspace (conversation, source control).
  ///
  /// In en, this message translates to:
  /// **'Workspace'**
  String get settingsWorkspaceSection;

  /// Settings landing group header for System (updates, about).
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsSystemSection;

  /// Conversation section sub-group for agent behaviour (thinking, context).
  ///
  /// In en, this message translates to:
  /// **'Agents'**
  String get settingsConversationAgentsGroup;

  /// Conversation section sub-group for Claude model-picker options.
  ///
  /// In en, this message translates to:
  /// **'Claude'**
  String get settingsConversationClaudeGroup;

  /// Conversation section sub-group for chat behaviour (scroll, templates).
  ///
  /// In en, this message translates to:
  /// **'Conversation'**
  String get settingsConversationChatGroup;

  /// Notifications section sub-group header for the event toggles.
  ///
  /// In en, this message translates to:
  /// **'Agent events'**
  String get settingsNotificationsEventsGroup;

  /// Source control section sub-group header for the confirmation toggles.
  ///
  /// In en, this message translates to:
  /// **'Confirmations'**
  String get settingsGitConfirmationsGroup;

  /// Updates section sub-group header for the current version + update state.
  ///
  /// In en, this message translates to:
  /// **'Version'**
  String get settingsUpdatesVersionGroup;

  /// Shown when the license registry failed to load.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the licenses.'**
  String get licensesError;
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
