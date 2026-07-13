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
      'Works with Claude Code, Codex, Gemini, OpenCode and Pi — with more agents on the way. No lock-in.';

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
      'On the computer where your agents live, install the bridge once, then start it:';

  @override
  String get onboardingInstallStepInstall => '1. Install (once)';

  @override
  String get onboardingInstallStepStart => '2. Start the bridge';

  @override
  String get onboardingInstallRootNote =>
      'The folder where you start the bridge becomes its root. From your phone you\'ll see every folder and repo under it — so you only start the bridge once, not separately for each project.';

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
  String get qrCameraErrorTitle => 'Camera unavailable';

  @override
  String get qrCameraErrorBody =>
      'Couldn\'t start the camera to scan. You can pair with a code instead, or try again.';

  @override
  String get actionRetry => 'Try again';

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
  String get actionApply => 'Apply';

  @override
  String get threadsTitle => 'Threads';

  @override
  String get threadsFilterAll => 'All';

  @override
  String get threadsFilterByAgent => 'Agent';

  @override
  String get threadsFilterByProject => 'Project';

  @override
  String get threadsFilterScopeTooltip => 'Filter scope';

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
  String get threadActionFork => 'Fork conversation';

  @override
  String get threadForkFailed => 'Couldn\'t fork this conversation';

  @override
  String get conversationLoadEarlier => 'Show earlier messages';

  @override
  String get conversationScrollToBottom => 'Scroll to latest';

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
  String get threadActionSessionInfo => 'Session info';

  @override
  String get sessionInfoTitle => 'Session info';

  @override
  String get sessionInfoAgentSessionLabel => 'Agent session ID';

  @override
  String get sessionInfoUnavailable => 'Not available yet';

  @override
  String get sessionInfoResumeHint =>
      'Resume this conversation from the agent\'s CLI on your PC.';

  @override
  String get sessionInfoCopied => 'Copied to clipboard';

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
  String get composerAttachGallery => 'Photo library';

  @override
  String get composerAttachCamera => 'Take a photo';

  @override
  String get composerAttachFailed => 'Couldn\'t attach that image';

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
  String get composerTools => 'Turn options';

  @override
  String get composerMentionFilesTitle => 'Files & folders';

  @override
  String get composerMentionLoading => 'Listing…';

  @override
  String get composerMentionEmpty => 'No matching files';

  @override
  String get composerMentionMore => 'Keep typing to narrow results…';

  @override
  String get composerMentionNoWorkspace => 'No folder for this conversation';

  @override
  String get composerMentionError => 'Couldn\'t list this folder';

  @override
  String get composerCommandsTitle => 'Commands';

  @override
  String get composerCommandsEmpty => 'No matching command';

  @override
  String get composerCmdFilesLabel => 'Attach file or folder';

  @override
  String get composerCmdFilesDesc =>
      'Insert an @ reference to a file or folder';

  @override
  String get composerCmdExplainLabel => 'Explain';

  @override
  String get composerCmdExplainTemplate => 'Explain how this works: ';

  @override
  String get composerCmdReviewLabel => 'Review';

  @override
  String get composerCmdReviewTemplate =>
      'Review this for bugs and improvements: ';

  @override
  String get composerCmdFixLabel => 'Fix';

  @override
  String get composerCmdFixTemplate => 'Find and fix the bug in: ';

  @override
  String get composerCmdTestsLabel => 'Tests';

  @override
  String get composerCmdTestsTemplate => 'Write tests for: ';

  @override
  String get settingsPromptTemplatesTitle => 'Prompt templates';

  @override
  String get settingsPromptTemplatesSubtitle =>
      'Edit the / command palette snippets';

  @override
  String get promptTemplatesTitle => 'Prompt templates';

  @override
  String get promptTemplatesAdd => 'New template';

  @override
  String get promptTemplatesReset => 'Reset to defaults';

  @override
  String get promptTemplatesEmpty => 'No templates';

  @override
  String get promptTemplatesEmptyBody =>
      'Create snippets you can drop into a message from the composer\'s / palette.';

  @override
  String get promptTemplatesNewTitle => 'New template';

  @override
  String get promptTemplatesEditTitle => 'Edit template';

  @override
  String get promptTemplatesLabelField => 'Name';

  @override
  String get promptTemplatesLabelHint => 'e.g. Review';

  @override
  String get promptTemplatesBodyField => 'Text';

  @override
  String get promptTemplatesBodyHint => 'The text inserted into the message';

  @override
  String get promptTemplatesDeleteTitle => 'Delete template?';

  @override
  String promptTemplatesDeleteBody(String label) {
    return '\"$label\" will be removed.';
  }

  @override
  String get promptTemplatesDeleteConfirm => 'Delete';

  @override
  String get promptTemplatesResetTitle => 'Reset templates?';

  @override
  String get promptTemplatesResetBody =>
      'This restores the default templates and drops your edits.';

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
  String get newThreadAgentHint => 'Select an agent';

  @override
  String get newThreadModel => 'Model (optional)';

  @override
  String get newThreadModelHint => 'Default model';

  @override
  String get newThreadStart => 'Start conversation';

  @override
  String get agentPickerTitle => 'Select agent';

  @override
  String get agentPickerSearchHint => 'Search agents';

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
  String get modelPickerRefresh => 'Refresh models';

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
  String get newThreadCapAutonomous => 'Autonomous mode';

  @override
  String get newThreadCapabilities => 'Capabilities';

  @override
  String get newThreadWorktree => 'Run in a worktree';

  @override
  String get newThreadWorktreeDesc =>
      'Create an isolated branch checkout so this conversation can\'t touch your current working tree.';

  @override
  String get newThreadWorktreeBranchHint => 'Branch name';

  @override
  String get newThreadWorktreeManaged => 'Let the bridge pick the location';

  @override
  String get newThreadWorktreeFailed => 'Couldn\'t create the worktree';

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
  String get approvalNeedsApproval => 'Needs approval';

  @override
  String get approvalDecidedTitle => 'Decision recorded';

  @override
  String get approvalAnsweredAt => 'Answered';

  @override
  String get approvalActionFallback => 'Action awaiting approval';

  @override
  String get approvalApprove => 'Approve';

  @override
  String get approvalReject => 'Reject';

  @override
  String get approvalAllowSession => 'Always allow this session';

  @override
  String get approvalApproved => 'Approved';

  @override
  String get approvalRejected => 'Rejected';

  @override
  String get approvalAllowedSession => 'Allowed for this session';

  @override
  String get approvalFailed => 'Couldn\'t send your response — try again';

  @override
  String get approvalRiskLow => 'Low risk';

  @override
  String get approvalRiskMedium => 'Medium risk';

  @override
  String get approvalRiskHigh => 'High risk';

  @override
  String get approvalRiskUnknown => 'Risk unknown';

  @override
  String get questionNeedsAnswer => 'Needs your answer';

  @override
  String get questionAnswered => 'Answer recorded';

  @override
  String get questionAnsweredAt => 'Answered';

  @override
  String get questionHeaderFallback => 'Question';

  @override
  String get questionSubmit => 'Submit';

  @override
  String get questionSkip => 'Skip';

  @override
  String get questionSkipped => 'Skipped';

  @override
  String get questionFailed => 'Couldn\'t send your answer — try again';

  @override
  String get turnFailed => 'The agent turn failed';

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
  String get gitSelectAll => 'Select all';

  @override
  String get gitDeselectAll => 'Deselect all';

  @override
  String gitSelectedCount(int count, int total) {
    return '$count of $total selected';
  }

  @override
  String get gitExpandAll => 'Expand all';

  @override
  String get gitCollapseAll => 'Collapse all';

  @override
  String get gitDiffEmpty => 'No textual changes to show.';

  @override
  String get gitDiffError => 'Couldn\'t load this file\'s diff.';

  @override
  String get gitCommitMessageLabel => 'Commit title';

  @override
  String get gitCommitDescriptionLabel => 'Description (optional)';

  @override
  String get gitCommitDescriptionHint => 'Add more detail about these changes…';

  @override
  String get gitCommitTitleRequired => 'Enter a commit title';

  @override
  String get gitCommitScopeAll => 'Committing all changes';

  @override
  String gitCommitScopeSelected(int count) {
    return 'Committing $count selected file(s)';
  }

  @override
  String get gitCoAuthorAdd => 'Add Co-author';

  @override
  String get gitCoAuthorLabel => 'Co-author';

  @override
  String get gitCoAuthorHint => 'Name <email>';

  @override
  String get gitCoAuthorInvalid => 'Use the format: Name <email>';

  @override
  String get gitDiscard => 'Discard';

  @override
  String get gitDiscardSelected => 'Discard selected';

  @override
  String get gitDiscardAll => 'Discard all';

  @override
  String get gitDiscardConfirmTitle => 'Discard changes?';

  @override
  String gitDiscardConfirmBody(int count) {
    return '$count file(s) will be reverted to the last commit, and any new files will be deleted. This can\'t be undone.';
  }

  @override
  String get gitDiscardSuccess => 'Changes discarded';

  @override
  String get gitCreatePr => 'Create PR';

  @override
  String get gitPrDialogTitle => 'Open pull request';

  @override
  String get gitPrTitleLabel => 'Title';

  @override
  String get gitPrBodyLabel => 'Description (optional)';

  @override
  String get gitPrBaseLabel => 'Target branch (base)';

  @override
  String get gitPrHeadLabel => 'Source branch (head)';

  @override
  String get gitPrPushNote =>
      'The source branch is pushed to the remote before the PR is opened.';

  @override
  String get gitPrTitleRequired => 'Enter a PR title';

  @override
  String get gitPrCreate => 'Create';

  @override
  String get gitPrSuccess => 'Pull request opened';

  @override
  String get gitPrViewAction => 'View';

  @override
  String get gitCancel => 'Cancel';

  @override
  String get gitSelectFilesFirst => 'Select at least one file';

  @override
  String get gitNothingToCommit => 'No changes to commit';

  @override
  String get gitRefresh => 'Refresh';

  @override
  String get gitUndoCommit => 'Undo last commit';

  @override
  String get gitUndoCommitConfirmTitle => 'Undo last commit?';

  @override
  String get gitUndoCommitConfirmBody =>
      'The last commit is undone but its changes are kept, so you can adjust and commit again before pushing.';

  @override
  String get gitUndoCommitSuccess => 'Last commit undone';

  @override
  String get gitPushConfirmTitle => 'Push commits?';

  @override
  String get gitPushConfirmBody =>
      'This publishes your commits to the remote and can\'t be undone.';

  @override
  String get gitPrConfirmTitle => 'Open pull request?';

  @override
  String get gitPrConfirmBody =>
      'A pull request can\'t be deleted from the repository, but you can close it later from the GitHub app or website.';

  @override
  String get gitPrFailed => 'Couldn\'t open the pull request';

  @override
  String get gitSwitchBranch => 'Switch branch';

  @override
  String get gitPull => 'Pull';

  @override
  String get gitPullSuccess => 'Pulled from the remote';

  @override
  String get gitNewBranch => 'New branch';

  @override
  String get gitNewBranchHint => 'Branch name';

  @override
  String get gitNewBranchSuccess => 'Branch created and checked out';

  @override
  String get gitNewWorktree => 'New worktree';

  @override
  String get gitNewWorktreeSuccess => 'Worktree created';

  @override
  String get gitSwitchBranchTitle => 'Switch branch';

  @override
  String gitSwitchBranchCurrent(String branch) {
    return 'On $branch';
  }

  @override
  String get gitSwitchCarryTitle => 'Move your changes?';

  @override
  String gitSwitchCarryBody(String target, String current) {
    return 'You have uncommitted changes. Carry them to $target, or leave them on $current? Left changes are saved and restored when you switch back.';
  }

  @override
  String get gitSwitchCarry => 'Carry changes';

  @override
  String get gitSwitchLeave => 'Leave on current';

  @override
  String gitSwitchSuccess(String branch) {
    return 'Switched to $branch';
  }

  @override
  String get gitHistoryTitle => 'History';

  @override
  String get gitHistoryButton => 'View history';

  @override
  String get gitHistoryListView => 'List';

  @override
  String get gitHistoryGraphView => 'Graph';

  @override
  String get gitHistoryViewTooltip => 'Toggle view';

  @override
  String get gitHistoryCompact => 'Compact view';

  @override
  String get gitHistoryComfortable => 'Comfortable view';

  @override
  String get gitHistoryShowGraph => 'Show graph lines';

  @override
  String get gitHistoryHideGraph => 'Hide graph lines';

  @override
  String get gitHistoryBackToTop => 'Back to top';

  @override
  String get gitHistorySearch => 'Search commits';

  @override
  String get gitHistorySearchHint => 'Search by message, SHA or author';

  @override
  String get gitHistorySearchEmpty => 'No commits match';

  @override
  String get gitHistoryViewBranch => 'View branch or ref';

  @override
  String get gitHistoryPickBranchTitle => 'View history of…';

  @override
  String get gitHistoryHeadOption => 'Current branch (HEAD)';

  @override
  String get gitHistoryLocalSection => 'Local branches';

  @override
  String get gitHistoryRemoteSection => 'Remote branches';

  @override
  String gitHistoryViewingRef(String ref) {
    return 'Viewing $ref';
  }

  @override
  String get gitHistoryDiffSection => 'Diff';

  @override
  String get gitHistoryDiffTruncated =>
      'Diff truncated — too large to show in full.';

  @override
  String get gitHistoryNoFileChanges => 'No file changes in this commit.';

  @override
  String get gitHistoryNoTextDiff => 'No textual changes.';

  @override
  String get gitHistoryBinaryDiff => 'Binary file — no text diff.';

  @override
  String gitHistoryRenamedFrom(String oldPath) {
    return 'from $oldPath';
  }

  @override
  String get gitHistoryDetailLoadFailed => 'Couldn\'t load this commit';

  @override
  String get gitHistoryEmpty => 'No commits yet';

  @override
  String get gitHistoryEmptyBody =>
      'Once you commit changes they\'ll show up here.';

  @override
  String get gitHistoryLoadMore => 'Load older commits';

  @override
  String get gitHistoryLoadingMore => 'Loading…';

  @override
  String get gitHistoryErrorTitle => 'Couldn\'t load commit history';

  @override
  String get gitHistoryRetry => 'Retry';

  @override
  String get gitHistoryMergeBadge => 'Merge';

  @override
  String gitHistoryCommitBy(String name) {
    return 'by $name';
  }

  @override
  String get gitHistoryParentsLabel => 'Parents';

  @override
  String get gitHistoryDetailsTitle => 'Commit details';

  @override
  String get gitHistoryDetailsMessage => 'Full message';

  @override
  String get gitHistoryDetailsAuthor => 'Author';

  @override
  String get gitHistoryDetailsCommitter => 'Committer';

  @override
  String get gitHistoryDetailsDate => 'Date';

  @override
  String get gitHistoryDetailsStats => 'Changes';

  @override
  String gitHistoryDetailsFiles(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count files changed',
      one: '1 file changed',
    );
    return '$_temp0';
  }

  @override
  String gitHistoryDetailsParents(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count parents',
      one: '1 parent',
    );
    return '$_temp0';
  }

  @override
  String get gitHistoryCopySha => 'Copy SHA';

  @override
  String get gitHistoryCopiedSha => 'SHA copied';

  @override
  String get gitHistoryCopyMessage => 'Copy message';

  @override
  String get gitHistoryCopiedMessage => 'Message copied';

  @override
  String gitHistoryFilesTouched(int additions, int deletions, int files) {
    return '$additions additions, $deletions deletions, $files files';
  }

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

  @override
  String get settingsContextIndicatorTitle => 'Context indicator';

  @override
  String get settingsContextIndicatorSubtitle =>
      'Show the context-window percentage, the token count, or both.';

  @override
  String get settingsContextIndicatorPercentage => 'Percentage';

  @override
  String get settingsContextIndicatorTokens => 'Tokens';

  @override
  String get settingsContextIndicatorBoth => 'Both';

  @override
  String get settingsGitSection => 'Source control';

  @override
  String get settingsConfirmPushTitle => 'Confirm before push';

  @override
  String get settingsConfirmPushSubtitle =>
      'Ask before pushing — a push can\'t be undone.';

  @override
  String get settingsConfirmPrTitle => 'Confirm before pull request';

  @override
  String get settingsConfirmPrSubtitle => 'Ask before opening a pull request.';

  @override
  String get settingsModelsSection => 'Models';

  @override
  String get settingsClaudeLatestTitle => 'Show Claude Code “latest” models';

  @override
  String get settingsClaudeLatestSubtitle =>
      'List the Opus, Sonnet and Haiku “(latest)” aliases in the model picker.';

  @override
  String get settingsClaudeLatestHint =>
      'The “(latest)” aliases always route to the newest version of each tier your account can use, so you don\'t have to pick an exact one. Turn this off to hide them and choose only pinned, exact versions. Conversations already using an alias keep working.';

  @override
  String get settingsAutonomousBannerTitle => 'Autonomous-mode banner';

  @override
  String get settingsAutonomousBannerSubtitle =>
      'Show it each time you open a conversation with an autonomous agent.';

  @override
  String get settingsAutonomousBannerHint =>
      'When on, a close button dismisses the banner just for the current visit and it reappears next time you open the conversation. Turn it off to hide the banner permanently.';

  @override
  String get settingsAppearanceSection => 'Appearance';

  @override
  String get settingsPersonalizationTitle => 'Personalization';

  @override
  String get settingsPersonalizationSubtitle =>
      'Theme, custom themes and language';

  @override
  String get personalizationTitle => 'Personalization';

  @override
  String get personalizationThemeSection => 'Theme';

  @override
  String get themeSystem => 'System';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDark => 'Dark';

  @override
  String get themeCustom => 'Custom';

  @override
  String get personalizationCustomThemeSection => 'Custom theme';

  @override
  String get personalizationCustomThemeDescription =>
      'Design every Material 3 color role, export to JSON, or import a theme someone shared with you.';

  @override
  String get personalizationCustomThemeAuthor => 'New theme';

  @override
  String get personalizationCustomThemeAuthorSubtitle =>
      'Start from a seed color and fine-tune every role';

  @override
  String get personalizationCustomThemeEdit => 'Edit current theme';

  @override
  String get personalizationCustomThemeEditSubtitle =>
      'Tweak the light and dark color roles';

  @override
  String get personalizationCustomThemeReset => 'Use the default theme';

  @override
  String get personalizationCustomThemeResetSubtitle =>
      'Discard the custom theme and return to the brand baseline';

  @override
  String get customThemeEditorTitle => 'Custom theme';

  @override
  String get customThemeEditorLight => 'Light';

  @override
  String get customThemeEditorDark => 'Dark';

  @override
  String get customThemeEditorName => 'Name';

  @override
  String get customThemeEditorDescription => 'Description';

  @override
  String get customThemeEditorNameHint => 'e.g. Midnight Purple';

  @override
  String get customThemeEditorDescriptionHint => 'Optional';

  @override
  String get customThemeEditorDeriveFromSeed => 'Derive from seed';

  @override
  String get customThemeEditorSeedHint => 'Seed color';

  @override
  String get customThemeEditorRole => 'Role';

  @override
  String get customThemeEditorResetRole => 'Reset role';

  @override
  String get customThemeEditorResetBrightness => 'Reset brightness';

  @override
  String get customThemeEditorExport => 'Export';

  @override
  String get customThemeEditorImport => 'Import';

  @override
  String get customThemeEditorSave => 'Save';

  @override
  String get customThemeEditorExportDialogTitle => 'Theme JSON';

  @override
  String get customThemeEditorExportDialogBody =>
      'Share the JSON below — paste it into any device signed in to your account to recreate the theme.';

  @override
  String get customThemeEditorImportDialogTitle => 'Import theme';

  @override
  String get customThemeEditorImportDialogBody =>
      'Paste a theme JSON exported from another device.';

  @override
  String get customThemeEditorImportFieldHint => 'Paste theme JSON here';

  @override
  String get customThemeEditorCopied => 'Theme JSON copied to clipboard';

  @override
  String get customThemeEditorImported => 'Theme imported';

  @override
  String get customThemeEditorImportFailed =>
      'Could not import theme — check the JSON.';

  @override
  String get customThemeEditorResetConfirmTitle => 'Reset theme?';

  @override
  String get customThemeEditorResetConfirmBody =>
      'The current custom theme will be discarded and the app will return to the brand baseline.';

  @override
  String get customThemeEditorResetConfirmAction => 'Reset';

  @override
  String get customThemeEditorDeriveSeedTitle => 'Derive from seed';

  @override
  String get customThemeEditorDeriveSeedBody =>
      'Pick a single seed color; every role for the selected brightness will be regenerated from it via Material 3.';

  @override
  String get customThemeEditorPickColorTitle => 'Pick color';

  @override
  String get customThemeEditorResetRoleConfirm =>
      'Reset this role to its derived value?';

  @override
  String get customThemeEditorDefaultName => 'Custom theme';

  @override
  String get customThemeEditorSaved => 'Theme JSON saved';

  @override
  String get customThemeEditorSaveFailed => 'Couldn\'t save the theme JSON';

  @override
  String get customThemeEditorShareFile => 'Share file';

  @override
  String get personalizationLanguageSection => 'Language';

  @override
  String get personalizationUseCustomThemeLabel => 'Use a custom theme';

  @override
  String get personalizationUseCustomThemeSubtitle =>
      'Replace System/Light/Dark with one of your saved themes.';

  @override
  String get personalizationCustomThemesHeader => 'Custom themes';

  @override
  String get personalizationCustomThemeActiveBadge => 'Active';

  @override
  String get personalizationCustomThemeBuiltInBadge => 'Built-in';

  @override
  String get personalizationCustomThemeExport => 'Export JSON';

  @override
  String get personalizationCustomThemeExportCopy => 'Copy to clipboard';

  @override
  String get personalizationCustomThemeExportFile => 'Save to file';

  @override
  String get personalizationCustomThemeNewDialogTitle => 'New custom theme';

  @override
  String get personalizationCustomThemeNewDialogBody =>
      'Pick a seed color and the brightness the new theme should target.';

  @override
  String get personalizationCustomThemeDelete => 'Delete';

  @override
  String get personalizationCustomThemeDeleteConfirmTitle => 'Delete theme?';

  @override
  String get personalizationCustomThemeDeleteConfirmBody =>
      'This removes the theme from your library. This can\'t be undone.';

  @override
  String get personalizationCustomThemeDeleteConfirmAction => 'Delete';

  @override
  String get personalizationCustomThemeDeleteFailed =>
      'Built-in themes can\'t be deleted';

  @override
  String get personalizationCustomThemesImportAction => 'Import theme';

  @override
  String get personalizationCustomThemesImportActionSubtitle =>
      'Paste a single theme or a list of themes as JSON';

  @override
  String get personalizationCustomThemesExportAllAction => 'Export all themes';

  @override
  String get personalizationCustomThemesExportAllActionSubtitle =>
      'Copy the whole library as a single JSON document';

  @override
  String get personalizationCustomThemesResetAction => 'Reset library';

  @override
  String get personalizationCustomThemesResetActionSubtitle =>
      'Restore the built-in examples and discard authored themes';

  @override
  String get personalizationCustomThemesImportDialogTitle => 'Import theme';

  @override
  String get personalizationCustomThemesImportDialogBody =>
      'Paste a theme JSON exported from another device. You can paste a single theme or a JSON array of themes to import them all at once.';

  @override
  String get personalizationCustomThemesImportFieldHint =>
      'Paste theme JSON here';

  @override
  String get themeImportFromFile => 'From file';

  @override
  String get themeImportFromUrl => 'From URL';

  @override
  String get themeImportUrlTitle => 'Import from URL';

  @override
  String get themeImportUrlHint => 'https://…/theme.json';

  @override
  String get themeImportUrlFetch => 'Fetch';

  @override
  String get themeImportUrlInvalid => 'Enter a valid http(s):// URL.';

  @override
  String get themeImportUrlError => 'Couldn\'t fetch a theme from that URL.';

  @override
  String get themeImportFileError => 'Couldn\'t read that file.';

  @override
  String get personalizationCustomThemesImportSuccess => 'Theme imported';

  @override
  String get personalizationCustomThemesImportPartial =>
      'Some themes couldn\'t be imported';

  @override
  String get personalizationCustomThemesImportFailed =>
      'Could not import — check the JSON';

  @override
  String get personalizationCustomThemesCopied =>
      'Theme JSON copied to clipboard';

  @override
  String get personalizationCustomThemesCopiedAll =>
      'Library JSON copied to clipboard';

  @override
  String get personalizationCustomThemesSaved => 'Library JSON saved';

  @override
  String get personalizationCustomThemesSaveFailed =>
      'Couldn\'t save the library JSON';

  @override
  String get themeManagerTitle => 'Themes';

  @override
  String get themeManagerEmptyTitle => 'No themes yet';

  @override
  String get themeManagerEmptyBody =>
      'Create one from a seed color or import a theme JSON.';

  @override
  String get themeBrightnessDual => 'Light & dark';

  @override
  String get themeBrightnessLightOnly => 'Light only';

  @override
  String get themeBrightnessDarkOnly => 'Dark only';

  @override
  String themeManagerSelectedCount(int count) {
    return '$count selected';
  }

  @override
  String get themeManagerSelectAll => 'Select all';

  @override
  String get themeManagerExitSelection => 'Cancel selection';

  @override
  String get themeManagerDeleteSelectedTitle => 'Delete selected themes?';

  @override
  String themeManagerDeleteSelectedBody(int count) {
    return 'This removes $count theme(s) from your library. Built-in themes are kept and can\'t be deleted. This can\'t be undone.';
  }

  @override
  String get themeManagerBuiltInsSkipped =>
      'Built-in themes can\'t be deleted and were kept.';

  @override
  String get themeNewSheetBody =>
      'Pick a seed color. We\'ll generate a full Material 3 light and dark theme you can fine-tune.';

  @override
  String get themeNewSheetCreate => 'Create & edit';

  @override
  String get customThemeEditorAddDarkSide => 'Add a dark side';

  @override
  String get customThemeEditorAddLightSide => 'Add a light side';

  @override
  String customThemeEditorSingleNote(String brightness) {
    return 'Only the $brightness side is defined; the other is generated automatically.';
  }

  @override
  String personalizationManageThemesSubtitle(int count) {
    return '$count saved';
  }

  @override
  String get languageSystemDefault => 'System default';

  @override
  String get appVersionStage => 'ALPHA';

  @override
  String get actionEnterCode => 'Enter a code instead';

  @override
  String get manualCodeTitle => 'Pair with a code';

  @override
  String get manualCodeIntro =>
      'On your PC, the bridge shows a host and a short pairing code. Enter them here to pair without scanning a QR.';

  @override
  String get manualCodeHostLabel => 'Bridge host';

  @override
  String get manualCodeHostHint => '192.168.1.100:19850';

  @override
  String get manualCodeCodeLabel => 'Pairing code';

  @override
  String get manualCodeCodeHint => 'e.g. 7Q4K2F9P';

  @override
  String get manualCodeConnect => 'Pair';

  @override
  String get manualCodeConnecting => 'Resolving code…';

  @override
  String get manualCodeFormTitle => 'Bridge details';

  @override
  String get manualCodeBrowse => 'Browse nearby bridges';

  @override
  String get manualCodeBrowseHint =>
      'Find a bridge on your Wi-Fi automatically';

  @override
  String get bridgeDiscoveryTitle => 'Nearby bridges';

  @override
  String get bridgeDiscoverySearching => 'Searching your network…';

  @override
  String get bridgeDiscoveryEmpty =>
      'No bridges found yet. Make sure the bridge is running on the same Wi-Fi, or type the host below.';

  @override
  String get manualCodeErrorInvalidInput =>
      'Enter the bridge host and the pairing code.';

  @override
  String get manualCodeErrorNetwork =>
      'Couldn\'t reach the bridge. Check the host and that the bridge is running on the same network.';

  @override
  String get manualCodeErrorInvalidCode =>
      'That code is wrong or has expired. Generate a new one on your PC.';

  @override
  String get manualCodeErrorRateLimited =>
      'Too many attempts. Wait a moment and try again.';

  @override
  String get manualCodeErrorServer =>
      'The bridge couldn\'t complete pairing. Try again.';

  @override
  String get manualCodeErrorPayload =>
      'The bridge sent an invalid pairing response.';

  @override
  String get gitRevertLast => 'Revert last commit';

  @override
  String get gitRevertConfirmTitle => 'Revert the last commit?';

  @override
  String get gitRevertConfirmBody =>
      'Creates a new commit that undoes the last one. History is kept (unlike Undo commit). You can push it like any commit.';

  @override
  String get gitRevertSuccess => 'Last commit reverted';

  @override
  String get gitRemoveWorktree => 'Remove worktree';

  @override
  String get gitRemoveWorktreeConfirmTitle => 'Remove this worktree?';

  @override
  String get gitRemoveWorktreeConfirmBody =>
      'Deletes the worktree folder backing this conversation (the branch is kept). The conversation\'s workspace will no longer exist.';

  @override
  String get gitRemoveWorktreeForceTitle => 'Worktree has changes';

  @override
  String get gitRemoveWorktreeForceBody =>
      'The worktree has uncommitted or untracked changes. Force-remove and lose them?';

  @override
  String get gitForceRemove => 'Force remove';

  @override
  String get gitDeleteBranch => 'Delete branch';

  @override
  String get gitDeleteBranchConfirmTitle => 'Delete branch?';

  @override
  String gitDeleteBranchConfirmBody(String branch) {
    return 'Delete the local branch \"$branch\"?';
  }

  @override
  String get gitDeleteBranchForceTitle => 'Branch not merged';

  @override
  String gitDeleteBranchForceBody(String branch) {
    return '\"$branch\" isn\'t fully merged. Force-delete and lose its unmerged commits?';
  }

  @override
  String get gitForceDelete => 'Force delete';

  @override
  String get conversationCwdMissing =>
      'This conversation\'s folder no longer exists. Reconnect or remove it.';

  @override
  String get conversationAutonomousMode =>
      'This agent runs in autonomous mode — it acts and edits without asking for approval first.';

  @override
  String get conversationAutonomousModeDismiss => 'Dismiss';

  @override
  String get fileBrowserTitle => 'Files';

  @override
  String get fileBrowserSearch => 'Search files';

  @override
  String get fileBrowserSearchHint => 'Search files in this project';

  @override
  String get fileBrowserSearchEmpty => 'No matching files';

  @override
  String get fileBrowserSearchFailed => 'Couldn\'t search files';

  @override
  String get fileBrowserShowExtensions => 'Show file extensions';

  @override
  String get fileBrowserShowHidden => 'Show hidden files';

  @override
  String get fileBrowserShowDetails => 'Show file details';

  @override
  String get fileBrowserCompactRows => 'Compact rows';

  @override
  String get fileBrowserCollapseAll => 'Collapse all folders';

  @override
  String get fileBrowserCopyPath => 'Copy workspace path';

  @override
  String get fileBrowserPathCopied => 'Workspace path copied';

  @override
  String get fileBrowserEmpty => 'This folder is empty';

  @override
  String get fileBrowserEmptyTitle => 'Nothing here';

  @override
  String get fileBrowserLoadFailed => 'Couldn\'t load the workspace';

  @override
  String get fileBrowserOpenTooltip => 'Browse files';

  @override
  String get fileViewerViewSource => 'View source';

  @override
  String get fileViewerViewPreview => 'View preview';

  @override
  String get fileViewerShowDiff => 'Show diff';

  @override
  String get fileViewerHideDiff => 'Hide diff';

  @override
  String fileViewerLinkCopied(String href) {
    return 'Link copied: $href';
  }

  @override
  String get fileViewerBinaryTitle => 'Binary file';

  @override
  String get fileViewerBinaryBody =>
      'Binary files can\'t be previewed on the phone. Pull the file to your PC to inspect it.';

  @override
  String get fileViewerLoadFailed => 'Couldn\'t open this file';

  @override
  String get fileViewerModePreview => 'Preview';

  @override
  String get fileViewerModeSource => 'Source';

  @override
  String get fileViewerEdit => 'Edit file';

  @override
  String get fileViewerSave => 'Save';

  @override
  String get fileViewerSaved => 'File saved';

  @override
  String fileViewerSaveFailed(String error) {
    return 'Couldn\'t save this file: $error';
  }

  @override
  String get fileViewerDiscardTitle => 'Discard changes?';

  @override
  String get fileViewerDiscardBody =>
      'Your edits to this file haven\'t been saved. Discard them?';

  @override
  String get fileViewerDiscard => 'Discard';

  @override
  String get fileViewerKeepEditing => 'Keep editing';

  @override
  String get settingsUpdatesSection => 'Updates';

  @override
  String get updateCheckTitle => 'Check for updates';

  @override
  String get updateCheckSubtitle =>
      'See if a newer version of Uxnan is available.';

  @override
  String get updateCheckAction => 'Check now';

  @override
  String get updateStatusChecking => 'Checking for updates…';

  @override
  String get updateStatusUpToDate => 'You\'re on the latest version.';

  @override
  String get updateStatusUnsupported =>
      'In-app updates aren\'t available for this build.';

  @override
  String get updateStatusError =>
      'Couldn\'t check for updates. Try again later.';

  @override
  String get updateAvailableTitle => 'Update available';

  @override
  String get updateAvailableBody =>
      'A new version of Uxnan is ready to install.';

  @override
  String updateAvailableBodyVersion(String version) {
    return 'Uxnan $version is ready to install.';
  }

  @override
  String get updateAction => 'Update';

  @override
  String get updateActionStarting => 'Starting…';

  @override
  String get updateDismissAction => 'Not now';

  @override
  String get bridgeUpdateTitle => 'Bridge update available';

  @override
  String get bridgeUpdateBody =>
      'Your PC\'s Uxnan bridge is out of date. Update it on your computer for the latest features and fixes.';

  @override
  String bridgeUpdateBodyVersion(String version) {
    return 'A newer bridge ($version) is available. Update it on your computer for the latest features and fixes.';
  }

  @override
  String get bridgeUpdateDismiss => 'Dismiss';

  @override
  String get updateWhatsNewLabel => 'What\'s new';

  @override
  String get updateCurrentVersionTitle => 'Current version';

  @override
  String get updateDownloadAction => 'Download';

  @override
  String get updateInstallAction => 'Install now';

  @override
  String get updateStatusDownloading => 'Downloading update…';

  @override
  String updateStatusDownloadingPercent(int percent) {
    return 'Downloading update… $percent%';
  }

  @override
  String get updateStatusDownloaded => 'Update downloaded — ready to install.';

  @override
  String get updateStatusInstalling => 'Installing update…';

  @override
  String get updateIntervalSectionTitle => 'Check automatically';

  @override
  String get updateIntervalEveryLaunch => 'Every launch';

  @override
  String get updateIntervalEvery6h => 'Every 6 hours';

  @override
  String get updateIntervalEvery12h => 'Every 12 hours';

  @override
  String get updateIntervalEvery24h => 'Every day';

  @override
  String get updateIntervalEvery48h => 'Every 2 days';

  @override
  String get updateIntervalWeekly => 'Every week';

  @override
  String get updateIntervalMonthly => 'Every month';

  @override
  String get settingsNotificationsNavSubtitle => 'Replies, errors and delivery';

  @override
  String get settingsConversationNavSubtitle =>
      'Thinking, models, context and templates';

  @override
  String get settingsModelsNavSubtitle => 'Model picker options';

  @override
  String get settingsGitNavSubtitle => 'Push and pull-request confirmations';

  @override
  String get settingsUpdatesNavSubtitle =>
      'Version, check schedule and install';

  @override
  String get settingsAboutSection => 'About';

  @override
  String get settingsAboutTitle => 'About Uxnan';

  @override
  String get settingsAboutSubtitle => 'App info and developer';

  @override
  String get settingsLicensesTitle => 'Open-source licenses';

  @override
  String get settingsLicensesSubtitle => 'Third-party packages Uxnan uses';

  @override
  String get aboutDescription =>
      'Drive your PC coding agents from your phone — end-to-end encrypted.';

  @override
  String get aboutDeveloperSection => 'Developer';

  @override
  String get aboutSourceCodeTitle => 'Source code';

  @override
  String get aboutSourceCodeSubtitle => 'View the project on GitHub';

  @override
  String get aboutLegalSection => 'Legal';

  @override
  String aboutVersionLabel(String version) {
    return 'Version $version';
  }

  @override
  String get licensesEmpty => 'No licenses found.';

  @override
  String licenseCountLabel(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count licenses',
      one: '1 license',
    );
    return '$_temp0';
  }

  @override
  String get settingsGeneralSection => 'General';

  @override
  String get settingsWorkspaceSection => 'Workspace';

  @override
  String get settingsSystemSection => 'System';

  @override
  String get settingsConversationAgentsGroup => 'Agents';

  @override
  String get settingsConversationClaudeGroup => 'Claude';

  @override
  String get settingsConversationPiGroup => 'Pi Agent';

  @override
  String get settingsConversationChatGroup => 'Conversation';

  @override
  String get settingsNotificationsEventsGroup => 'Agent events';

  @override
  String get settingsGitConfirmationsGroup => 'Confirmations';

  @override
  String get settingsUpdatesVersionGroup => 'Version';

  @override
  String get licensesError => 'Couldn\'t load the licenses.';
}
