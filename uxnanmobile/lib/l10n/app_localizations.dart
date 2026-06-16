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

  /// No description provided for @newThreadCapabilities.
  ///
  /// In en, this message translates to:
  /// **'Capabilities'**
  String get newThreadCapabilities;

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
  /// **'Theme, accent color and language'**
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

  /// No description provided for @personalizationAccentSection.
  ///
  /// In en, this message translates to:
  /// **'Accent color'**
  String get personalizationAccentSection;

  /// No description provided for @personalizationAccentComingSoon.
  ///
  /// In en, this message translates to:
  /// **'Coming soon'**
  String get personalizationAccentComingSoon;

  /// No description provided for @personalizationAccentComingSoonBody.
  ///
  /// In en, this message translates to:
  /// **'Custom accent colors are in design — they\'ll arrive once they stay coherent across the whole app.'**
  String get personalizationAccentComingSoonBody;

  /// No description provided for @personalizationLanguageSection.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get personalizationLanguageSection;

  /// No description provided for @languageSystemDefault.
  ///
  /// In en, this message translates to:
  /// **'System default'**
  String get languageSystemDefault;

  /// App name with the 'Mobile' suffix, shown in the devices-screen footer. Localized — 'Uxnan Móvil' in Spanish.
  ///
  /// In en, this message translates to:
  /// **'Uxnan Mobile'**
  String get appTitleMobile;

  /// Short release-stage label (e.g. ALPHA / BETA / STABLE) shown in the devices-screen footer to communicate the maturity of the build.
  ///
  /// In en, this message translates to:
  /// **'ALPHA'**
  String get appVersionStage;
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
