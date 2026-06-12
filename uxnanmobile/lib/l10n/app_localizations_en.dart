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
  String get connectionRelay => 'Relay';

  @override
  String get connectionDirect => 'Direct';

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
  String get devicesTitle => 'Devices';

  @override
  String get deviceActive => 'Active';

  @override
  String get deviceConnect => 'Connect';

  @override
  String deviceConnectFailed(String device) {
    return 'Couldn\'t reach $device. Staying on the current PC.';
  }

  @override
  String get deviceLastSeenLabel => 'Last seen';

  @override
  String get deviceNeverConnected => 'Never connected';

  @override
  String get devicePairedLabel => 'Paired';

  @override
  String get deviceRename => 'Rename';

  @override
  String get deviceVerifyConnection => 'Verify connection';

  @override
  String get deviceVerifying => 'Checking the bridge…';

  @override
  String get deviceVerifyOk => 'The bridge is reachable.';

  @override
  String get deviceVerifyFailed => 'The bridge did not respond. Reconnecting…';

  @override
  String get deviceNameTitle => 'Device name';

  @override
  String get deviceNameHint => 'e.g. Work MacBook';

  @override
  String get deviceRemove => 'Remove device';

  @override
  String deviceRemoveTitle(String device) {
    return 'Remove $device?';
  }

  @override
  String get deviceRemoveBody =>
      'Removes this PC and its conversations from your phone. You can pair again anytime.';

  @override
  String get deviceRemoveConfirm => 'Remove';

  @override
  String get actionSave => 'Save';

  @override
  String get actionCancel => 'Cancel';

  @override
  String get threadsTitle => 'Threads';

  @override
  String get threadsFilterAll => 'All';

  @override
  String get threadsViewOptions => 'View options';

  @override
  String get threadsSortBy => 'Sort by';

  @override
  String get threadsSortCreated => 'Creation date';

  @override
  String get threadsSortName => 'Name';

  @override
  String get threadsSortFolder => 'Folder';

  @override
  String get threadsCompact => 'Compact list';

  @override
  String get threadsMore => 'More options';

  @override
  String get threadsSearch => 'Search threads';

  @override
  String get threadsSearchHint => 'Search by name, ID, agent or folder';

  @override
  String get threadsSearchEmpty => 'No threads match';

  @override
  String get threadsEmpty => 'No threads yet';

  @override
  String get threadsNotConnected =>
      'Not connected to this PC — showing a cached view.';

  @override
  String get threadsEmptyBody =>
      'Threads from this PC will appear here. Pull down to refresh.';

  @override
  String get threadActionRename => 'Rename';

  @override
  String get threadActionCopyId => 'Copy thread ID';

  @override
  String get threadActionArchive => 'Archive';

  @override
  String get threadActionUnarchive => 'Unarchive';

  @override
  String get threadActionDelete => 'Delete';

  @override
  String get archivedTitle => 'Archived';

  @override
  String get archivedEmpty => 'No archived threads';

  @override
  String get archivedEmptyBody =>
      'Threads you archive are hidden here, not deleted. Long-press one to unarchive it.';

  @override
  String get threadRenameTitle => 'Rename thread';

  @override
  String get threadRenameHint => 'Thread title';

  @override
  String get threadIdCopied => 'Thread ID copied';

  @override
  String get threadResponding => 'Responding…';

  @override
  String get threadIdLabel => 'Thread ID';

  @override
  String get threadDeleteTitle => 'Delete thread?';

  @override
  String get threadDeleteBody =>
      'This removes the conversation from this device.';

  @override
  String get threadDeleteConfirm => 'Delete';

  @override
  String get conversationTitle => 'Conversation';

  @override
  String get conversationEmpty => 'No messages yet';

  @override
  String get conversationEmptyBody =>
      'Send a message to start the conversation.';

  @override
  String get conversationThinking => 'Thinking';

  @override
  String get conversationWorkLog => 'Work log';

  @override
  String get conversationChangedFiles => 'Changed files';

  @override
  String get conversationCopyResponse => 'Copy response';

  @override
  String get conversationResponseCopied => 'Response copied';

  @override
  String get conversationCopyMessage => 'Copy message';

  @override
  String get conversationMessageCopied => 'Message copied';

  @override
  String get conversationLastEdits => 'Last edits';

  @override
  String conversationFilesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count files',
      one: '1 file',
    );
    return '$_temp0';
  }

  @override
  String get composerHint => 'Message…';

  @override
  String get composerSend => 'Send';

  @override
  String get composerAttach => 'Attach';

  @override
  String get composerStop => 'Stop';

  @override
  String get composerVoice => 'Voice input';

  @override
  String get composerVoiceStop => 'Stop dictation';

  @override
  String get composerVoiceUnavailable =>
      'Voice input isn\'t available on this device.';

  @override
  String get composerOptionsShow => 'Show options';

  @override
  String get composerOptionsHide => 'Hide options';

  @override
  String get newThreadAction => 'New conversation';

  @override
  String get newThreadTitle => 'New conversation';

  @override
  String get newThreadProject => 'Project';

  @override
  String get newThreadWorkingDir => 'Working directory';

  @override
  String get newThreadBrowse => 'Browse…';

  @override
  String get newThreadChangeFolder => 'Change';

  @override
  String get newThreadFolderLabel => 'Folder';

  @override
  String get newThreadCapForking => 'Forking';

  @override
  String get workspaceBrowseTitle => 'Choose a folder';

  @override
  String get workspaceBrowseOpenHere => 'Open here';

  @override
  String get workspaceBrowseEmpty => 'No sub-folders here';

  @override
  String get workspaceBrowseFailed => 'Couldn\'t browse folders';

  @override
  String get workspaceBrowseGitRepo => 'Git repository';

  @override
  String get workspaceBrowseUp => 'Up one folder';

  @override
  String get newThreadAgent => 'Agent';

  @override
  String get newThreadModel => 'Model (optional)';

  @override
  String get newThreadModelHint => 'Default model';

  @override
  String get newThreadStart => 'Start conversation';

  @override
  String get modelPickerTitle => 'Select model';

  @override
  String get modelPickerSearchHint => 'Search models';

  @override
  String get modelPickerLoadFailed => 'Couldn\'t load models';

  @override
  String get modelPickerEmpty => 'No matching models';

  @override
  String get modelPickerDefault => 'Default';

  @override
  String get newThreadFailed => 'Couldn\'t start the conversation';

  @override
  String get newThreadLoadFailed => 'Couldn\'t load from the bridge';

  @override
  String get newThreadNoProjects => 'No projects available on this PC.';

  @override
  String get newThreadNoAgents => 'No agents available on this PC.';

  @override
  String get newThreadAgentUnavailable => 'Unavailable';

  @override
  String get newThreadCapStreaming => 'Streaming';

  @override
  String get newThreadCapPlan => 'Plan mode';

  @override
  String get newThreadCapApprovals => 'Approvals';

  @override
  String get newThreadCapImages => 'Images';

  @override
  String get environmentTitle => 'Environment';

  @override
  String get environmentModel => 'Model';

  @override
  String get environmentActiveModel => 'Active version';

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

  @override
  String get runOptionAuto => 'Auto';

  @override
  String get authRequiresLoginTitle => 'Agent not signed in';

  @override
  String get authRequiresLoginBody =>
      'Sign in to this agent\'s CLI on your PC to start sending messages.';

  @override
  String get authLoginInProgress => 'Signing in on your PC…';

  @override
  String get agentSignInRequired => 'Sign in required';

  @override
  String get agentCheckSignIn => 'Check sign-in';

  @override
  String get gitActionsTitle => 'Source control';

  @override
  String get gitCleanState => 'Working tree clean';

  @override
  String get gitDirtyState => 'Uncommitted changes';

  @override
  String get gitChangedFiles => 'Changed files';

  @override
  String get gitCommitButton => 'Commit';

  @override
  String get gitPushButton => 'Push';

  @override
  String get gitCommitTitle => 'Commit changes';

  @override
  String get gitCommitHint => 'Describe your changes…';

  @override
  String get gitNoRepository => 'No git repository';

  @override
  String get gitNoRepositoryBody =>
      'Open a workspace with a git repository to manage source control.';

  @override
  String get gitRecent => 'Recent activity';

  @override
  String get gitActionFailed => 'Git action failed';

  @override
  String get gitCommitSuccess => 'Changes committed';

  @override
  String get gitPushSuccess => 'Push complete';

  @override
  String get gitStatusAdded => 'Added';

  @override
  String get gitStatusModified => 'Modified';

  @override
  String get gitStatusDeleted => 'Deleted';

  @override
  String get gitStatusRenamed => 'Renamed';

  @override
  String get gitStatusUntracked => 'Untracked';

  @override
  String get pushChannelName => 'Agent activity';

  @override
  String get pushChannelDescription =>
      'Turn completions and errors from your coding agents.';

  @override
  String get pushFallbackTitle => 'Uxnan';

  @override
  String pushTurnCompletedBody(String agent) {
    return '$agent replied';
  }

  @override
  String pushTurnErrorBody(String agent) {
    return '$agent reported an error';
  }

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsNotificationsSection => 'Notifications';

  @override
  String get settingsNotificationsHint =>
      'Choose which agent events notify you. These apply to background push and on-device notifications.';

  @override
  String get settingsTurnCompletedTitle => 'Replies';

  @override
  String get settingsTurnCompletedSubtitle =>
      'Notify me when an agent finishes responding.';

  @override
  String get settingsTurnErrorTitle => 'Errors';

  @override
  String get settingsTurnErrorSubtitle => 'Notify me when an agent run fails.';

  @override
  String get settingsConversationSection => 'Conversation';

  @override
  String get settingsShowThinkingTitle => 'Show agent thinking';

  @override
  String get settingsShowThinkingSubtitle =>
      'Display the agent\'s reasoning in a collapsible section.';

  @override
  String get settingsScrollOnSendTitle => 'Scroll to latest on send';

  @override
  String get settingsScrollOnSendSubtitle =>
      'Jump to your message when you send, even if you\'ve scrolled up.';
}
