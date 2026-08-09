import 'package:hugeicons/hugeicons.dart';

/// A Hugeicons glyph: the package models an icon as SVG path data, not as an
/// [UxIconData] with a code point, so this is what an icon *is* in this app.
///
/// The alias exists so signatures stay readable — a field typed
/// `List<List<dynamic>>` tells a reader nothing.
typedef UxIconData = List<List<dynamic>>;

/// Every icon the app draws, named for what it MEANS rather than for the glyph
/// it happens to use.
///
/// One catalogue instead of `HugeIcons.strokeRoundedFolder01` scattered across
/// sixty files, for three reasons:
///
/// 1. **Reviewable.** Choosing a glyph is a design decision; here all of them
///    sit on one screen instead of buried in a diff.
/// 2. **Changeable.** Swapping the glyph the whole app uses for "agent" is one
///    line, not a search-and-replace.
/// 3. **Testable.** `find.byIcon` takes an `IconData` and so cannot see these
///    at all; tests match on these constants instead
///    (see `test/support/ux_icon.dart`).
///
/// The set is the free **stroke-rounded** Hugeicons — the same one
/// `uxnandesktop` and the website draw, so a concept looks the same in all
/// three. It has no filled variants, so Material distinctions that relied on
/// fill (outline vs filled check-circle) collapse to one glyph here.
class UxIcons {
  const UxIcons._();

  /// Agent state — the agent asked and is holding the turn on your answer.
  /// Replaces nothing: Material had no glyph for "it needs *you*".
  static const UxIconData agentWaiting =
      HugeIcons.strokeRoundedBubbleChatQuestion;

  /// Agent state — held by something that is not your attention (a sign-in, a
  /// paused queue).
  static const UxIconData agentBlocked = HugeIcons.strokeRoundedPauseCircle;

  /// Agent state — the turn finished and its reply is unread.
  static const UxIconData agentDone = HugeIcons.strokeRoundedCheckmarkCircle02;

  /// Replaces `UxIcons.accountBalanceWallet`.
  static const UxIconData accountBalanceWallet =
      HugeIcons.strokeRoundedWallet01;

  /// Replaces `UxIcons.accountTree`, `UxIcons.accountTree`.
  static const UxIconData accountTree = HugeIcons.strokeRoundedHierarchy;

  /// Replaces `UxIcons.add`.
  static const UxIconData add = HugeIcons.strokeRoundedAdd01;

  /// Replaces `UxIcons.addCircle`.
  static const UxIconData addCircle = HugeIcons.strokeRoundedAddCircle;

  /// Replaces `UxIcons.addComment`.
  static const UxIconData addComment = HugeIcons.strokeRoundedBubbleChatAdd;

  /// Replaces `UxIcons.addLink`.
  static const UxIconData addLink = HugeIcons.strokeRoundedLink05;

  /// Replaces `UxIcons.altRoute`.
  static const UxIconData altRoute = HugeIcons.strokeRoundedGitBranch;

  /// Replaces `UxIcons.alternateEmail`.
  static const UxIconData alternateEmail = HugeIcons.strokeRoundedAt;

  /// Replaces `UxIcons.archive`.
  static const UxIconData archive = HugeIcons.strokeRoundedArchive;

  /// Replaces `UxIcons.arrowBack`.
  static const UxIconData arrowBack = HugeIcons.strokeRoundedArrowLeft02;

  /// Replaces `UxIcons.arrowDownward`.
  static const UxIconData arrowDownward = HugeIcons.strokeRoundedArrowDown02;

  /// Replaces `UxIcons.arrowDropDown`.
  static const UxIconData arrowDropDown = HugeIcons.strokeRoundedArrowDown01;

  /// Replaces `UxIcons.arrowUpward`.
  static const UxIconData arrowUpward = HugeIcons.strokeRoundedArrowUp02;

  /// Replaces `UxIcons.audiotrack`.
  static const UxIconData audiotrack = HugeIcons.strokeRoundedMusicNote01;

  /// Replaces `UxIcons.autoAwesome`, `UxIcons.autoAwesome`.
  static const UxIconData autoAwesome = HugeIcons.strokeRoundedAiMagic;

  /// Replaces `UxIcons.autorenew`.
  static const UxIconData autorenew = HugeIcons.strokeRoundedRefresh01;

  /// Replaces `UxIcons.badge`.
  static const UxIconData badge = HugeIcons.strokeRoundedIdentityCard;

  /// Replaces `UxIcons.block`.
  static const UxIconData block = HugeIcons.strokeRoundedBlocked;

  /// Replaces `UxIcons.bolt`, `UxIcons.bolt`.
  static const UxIconData bolt = HugeIcons.strokeRoundedFlash;

  /// Replaces `UxIcons.brokenImage`.
  static const UxIconData brokenImage = HugeIcons.strokeRoundedImageNotFound01;

  /// Replaces `UxIcons.bugReport`, `UxIcons.bugReport`.
  static const UxIconData bugReport = HugeIcons.strokeRoundedBug01;

  /// Replaces `UxIcons.build`.
  static const UxIconData build = HugeIcons.strokeRoundedWrench01;

  /// Replaces `UxIcons.callSplit`.
  static const UxIconData callSplit = HugeIcons.strokeRoundedGitBranch;

  /// Replaces `UxIcons.campaign`.
  static const UxIconData campaign = HugeIcons.strokeRoundedMegaphone01;

  /// Replaces `UxIcons.cancel`.
  static const UxIconData cancel = HugeIcons.strokeRoundedCancelCircle;

  /// Replaces `UxIcons.chatBubble`.
  static const UxIconData chatBubble = HugeIcons.strokeRoundedBubbleChat;

  /// Replaces `UxIcons.check`.
  static const UxIconData check = HugeIcons.strokeRoundedTick02;

  /// Replaces `UxIcons.checkBox`.
  static const UxIconData checkBox = HugeIcons.strokeRoundedCheckmarkSquare01;

  /// Replaces `UxIcons.checkBoxOutlineBlank`.
  static const UxIconData checkBoxOutlineBlank = HugeIcons.strokeRoundedSquare;

  /// Replaces `UxIcons.checkCircle`,
  /// `UxIcons.checkCircle`, `UxIcons.checkCircle`.
  static const UxIconData checkCircle =
      HugeIcons.strokeRoundedCheckmarkCircle01;

  /// Replaces `UxIcons.checklist`.
  static const UxIconData checklist = HugeIcons.strokeRoundedCheckList;

  /// Replaces `UxIcons.checklistRtl`.
  static const UxIconData checklistRtl = HugeIcons.strokeRoundedCheckList;

  /// Replaces `UxIcons.chevronLeft`.
  static const UxIconData chevronLeft = HugeIcons.strokeRoundedArrowLeft01;

  /// Replaces `UxIcons.chevronRight`.
  static const UxIconData chevronRight = HugeIcons.strokeRoundedArrowRight01;

  /// Replaces `UxIcons.circle`.
  static const UxIconData circle = HugeIcons.strokeRoundedCircle;

  /// Replaces `UxIcons.close`.
  static const UxIconData close = HugeIcons.strokeRoundedCancel01;

  /// Replaces `UxIcons.cloud`.
  static const UxIconData cloud = HugeIcons.strokeRoundedCloud;

  /// Replaces `UxIcons.cloudOff`.
  static const UxIconData cloudOff = HugeIcons.strokeRoundedCloudOff;

  /// Replaces `UxIcons.code`.
  static const UxIconData code = HugeIcons.strokeRoundedCode;

  /// Replaces `UxIcons.collectionsBookmark`.
  static const UxIconData collectionsBookmark =
      HugeIcons.strokeRoundedAllBookmark;

  /// Replaces `UxIcons.commit`.
  static const UxIconData commit = HugeIcons.strokeRoundedGitCommit;

  /// Replaces `UxIcons.compress`.
  static const UxIconData compress = HugeIcons.strokeRoundedCollapse;

  /// Replaces `UxIcons.contentCopy`, `UxIcons.contentCopy`.
  static const UxIconData contentCopy = HugeIcons.strokeRoundedCopy01;

  /// Replaces `UxIcons.copy`.
  static const UxIconData copy = HugeIcons.strokeRoundedCopy01;

  /// Replaces `UxIcons.copyAll`.
  static const UxIconData copyAll = HugeIcons.strokeRoundedCopy02;

  /// Replaces `UxIcons.darkMode`.
  static const UxIconData darkMode = HugeIcons.strokeRoundedMoon02;

  /// Replaces `UxIcons.dataObject`.
  static const UxIconData dataObject = HugeIcons.strokeRoundedSourceCode;

  /// Replaces `UxIcons.dataUsage`.
  static const UxIconData dataUsage = HugeIcons.strokeRoundedPieChart;

  /// Replaces `UxIcons.delete`, `UxIcons.delete`.
  static const UxIconData delete = HugeIcons.strokeRoundedDelete02;

  /// Replaces `UxIcons.deleteSweep`.
  static const UxIconData deleteSweep = HugeIcons.strokeRoundedDelete03;

  /// Replaces `UxIcons.densityMedium`.
  static const UxIconData densityMedium = HugeIcons.strokeRoundedMenu01;

  /// Replaces `UxIcons.densitySmall`.
  static const UxIconData densitySmall = HugeIcons.strokeRoundedMenu02;

  /// Replaces `UxIcons.description`.
  static const UxIconData description = HugeIcons.strokeRoundedFile01;

  /// Replaces `UxIcons.devices`.
  static const UxIconData devices = HugeIcons.strokeRoundedSmartPhone01;

  /// Replaces `UxIcons.difference`, `UxIcons.difference`.
  static const UxIconData difference = HugeIcons.strokeRoundedGitCompare;

  /// Replaces `UxIcons.dns`, `UxIcons.dns`.
  static const UxIconData dns = HugeIcons.strokeRoundedDatabase;

  /// Replaces `UxIcons.donutLarge`.
  static const UxIconData donutLarge = HugeIcons.strokeRoundedPieChart;

  /// Replaces `UxIcons.download`.
  static const UxIconData download = HugeIcons.strokeRoundedDownload01;

  /// Replaces `UxIcons.driveFileMove`.
  static const UxIconData driveFileMove = HugeIcons.strokeRoundedFolderTransfer;

  /// Replaces `UxIcons.driveFileRename`.
  static const UxIconData driveFileRename = HugeIcons.strokeRoundedEdit02;

  /// Replaces `UxIcons.driveFolderUpload`.
  static const UxIconData driveFolderUpload =
      HugeIcons.strokeRoundedFolderUpload;

  /// Replaces `UxIcons.edit`.
  static const UxIconData edit = HugeIcons.strokeRoundedEdit02;

  /// Replaces `UxIcons.editNote`.
  static const UxIconData editNote = HugeIcons.strokeRoundedEdit02;

  /// Replaces `UxIcons.error`, `UxIcons.error`.
  static const UxIconData error = HugeIcons.strokeRoundedAlertCircle;

  /// Replaces `UxIcons.expandLess`.
  static const UxIconData expandLess = HugeIcons.strokeRoundedArrowUp01;

  /// Replaces `UxIcons.expandMore`.
  static const UxIconData expandMore = HugeIcons.strokeRoundedArrowDown01;

  /// Replaces `UxIcons.face`.
  static const UxIconData face = HugeIcons.strokeRoundedUserCircle;

  /// Replaces `UxIcons.fiberNew`.
  static const UxIconData fiberNew = HugeIcons.strokeRoundedSparkles;

  /// Replaces `UxIcons.fileDownload`.
  static const UxIconData fileDownload = HugeIcons.strokeRoundedDownload01;

  /// Replaces `UxIcons.flag`.
  static const UxIconData flag = HugeIcons.strokeRoundedFlag01;

  /// Replaces `UxIcons.folder`, `UxIcons.folder`.
  static const UxIconData folder = HugeIcons.strokeRoundedFolder01;

  /// Replaces `UxIcons.folderDelete`.
  static const UxIconData folderDelete = HugeIcons.strokeRoundedFolderRemove;

  /// Replaces `UxIcons.folderOff`.
  static const UxIconData folderOff = HugeIcons.strokeRoundedFolderBlock;

  /// Replaces `UxIcons.folderOpen`, `UxIcons.folderOpen`.
  static const UxIconData folderOpen = HugeIcons.strokeRoundedFolderOpen;

  /// Replaces `UxIcons.folderSpecial`.
  static const UxIconData folderSpecial =
      HugeIcons.strokeRoundedFolderFavourite;

  /// Replaces `UxIcons.folderZip`.
  static const UxIconData folderZip = HugeIcons.strokeRoundedFolderZip;

  /// A git repository heading its worktrees. Distinct from [folder] on
  /// purpose: the two sit on adjacent rows and mean different things.
  static const UxIconData repository = HugeIcons.strokeRoundedGitBranch;

  /// Replaces `UxIcons.fontDownload`.
  static const UxIconData fontDownload = HugeIcons.strokeRoundedTextFont;

  /// Replaces `UxIcons.forum`.
  static const UxIconData forum = HugeIcons.strokeRoundedBubbleChat;

  /// Replaces `UxIcons.gavel`.
  static const UxIconData gavel = HugeIcons.strokeRoundedLegalHammer;

  /// Replaces `UxIcons.gridView`.
  static const UxIconData gridView = HugeIcons.strokeRoundedGridView;

  /// Replaces `UxIcons.help`.
  static const UxIconData help = HugeIcons.strokeRoundedHelpCircle;

  /// Replaces `UxIcons.history`.
  static const UxIconData history = HugeIcons.strokeRoundedClock01;

  /// Replaces `UxIcons.historyToggleOff`.
  static const UxIconData historyToggleOff = HugeIcons.strokeRoundedClock02;

  /// Replaces `UxIcons.hub`.
  static const UxIconData hub = HugeIcons.strokeRoundedHierarchy;

  /// Replaces `UxIcons.image`.
  static const UxIconData image = HugeIcons.strokeRoundedImage01;

  /// Replaces `UxIcons.info`, `UxIcons.info`.
  static const UxIconData info = HugeIcons.strokeRoundedInformationCircle;

  /// Replaces `UxIcons.insertDriveFile`.
  static const UxIconData insertDriveFile = HugeIcons.strokeRoundedFile01;

  /// Replaces `UxIcons.inventory2`.
  static const UxIconData inventory2 = HugeIcons.strokeRoundedPackage;

  /// Replaces `UxIcons.iosShare`.
  static const UxIconData iosShare = HugeIcons.strokeRoundedShare01;

  /// Replaces `UxIcons.key`, `UxIcons.key`.
  static const UxIconData key = HugeIcons.strokeRoundedKey01;

  /// Replaces `UxIcons.keyboardArrowDown`.
  static const UxIconData keyboardArrowDown =
      HugeIcons.strokeRoundedArrowDown01;

  /// Replaces `UxIcons.keyboardArrowUp`.
  static const UxIconData keyboardArrowUp = HugeIcons.strokeRoundedArrowUp01;

  /// Replaces `UxIcons.laptopMac`.
  static const UxIconData laptopMac = HugeIcons.strokeRoundedLaptop;

  /// Replaces `UxIcons.lightMode`.
  static const UxIconData lightMode = HugeIcons.strokeRoundedSun01;

  /// Replaces `UxIcons.lightbulb`.
  static const UxIconData lightbulb = HugeIcons.strokeRoundedIdea01;

  /// Replaces `UxIcons.link`.
  static const UxIconData link = HugeIcons.strokeRoundedLink01;

  /// Replaces `UxIcons.lock`, `UxIcons.lock`.
  static const UxIconData lock = HugeIcons.strokeRoundedSquareLock01;

  /// Replaces `UxIcons.lockOpen`.
  static const UxIconData lockOpen = HugeIcons.strokeRoundedSquareUnlock01;

  /// Replaces `UxIcons.login`.
  static const UxIconData login = HugeIcons.strokeRoundedLogin01;

  /// Replaces `UxIcons.memory`.
  static const UxIconData memory = HugeIcons.strokeRoundedCpu;

  /// Replaces `UxIcons.menuBook`.
  static const UxIconData menuBook = HugeIcons.strokeRoundedBookOpen01;

  /// Replaces `UxIcons.merge`.
  static const UxIconData merge = HugeIcons.strokeRoundedGitMerge;

  /// Replaces `UxIcons.mic`.
  static const UxIconData mic = HugeIcons.strokeRoundedMic01;

  /// Replaces `UxIcons.micNone`.
  static const UxIconData micNone = HugeIcons.strokeRoundedMic01;

  /// Replaces `UxIcons.moreVert`.
  static const UxIconData moreVert = HugeIcons.strokeRoundedMoreVertical;

  /// Replaces `UxIcons.movie`.
  static const UxIconData movie = HugeIcons.strokeRoundedFilm01;

  /// Replaces `UxIcons.myLocation`.
  static const UxIconData myLocation = HugeIcons.strokeRoundedGps01;

  /// Replaces `UxIcons.noPhotography`.
  static const UxIconData noPhotography =
      HugeIcons.strokeRoundedImageNotFound01;

  /// Replaces `UxIcons.noteAdd`.
  static const UxIconData noteAdd = HugeIcons.strokeRoundedNoteAdd;

  /// Replaces `UxIcons.notes`.
  static const UxIconData notes = HugeIcons.strokeRoundedNote01;

  /// Replaces `UxIcons.notifications`.
  static const UxIconData notifications = HugeIcons.strokeRoundedNotification01;

  /// Replaces `UxIcons.openInNew`.
  static const UxIconData openInNew = HugeIcons.strokeRoundedLinkSquare01;

  /// Replaces `UxIcons.palette`.
  static const UxIconData palette = HugeIcons.strokeRoundedPaintBoard;

  /// Replaces `UxIcons.panTool`.
  static const UxIconData panTool = HugeIcons.strokeRoundedHold01;

  /// Replaces `UxIcons.pauseCircle`.
  static const UxIconData pauseCircle = HugeIcons.strokeRoundedPauseCircle;

  /// Replaces `UxIcons.pending`.
  static const UxIconData pending =
      HugeIcons.strokeRoundedMoreHorizontalCircle01;

  /// Replaces `UxIcons.person`, `UxIcons.person`.
  static const UxIconData person = HugeIcons.strokeRoundedUser;

  /// Replaces `UxIcons.pets`.
  static const UxIconData pets = HugeIcons.strokeRoundedBird;

  /// Replaces `UxIcons.photoCamera`, `UxIcons.photoCamera`.
  static const UxIconData photoCamera = HugeIcons.strokeRoundedCamera01;

  /// Replaces `UxIcons.photoLibrary`.
  static const UxIconData photoLibrary = HugeIcons.strokeRoundedAlbum01;

  /// Replaces `UxIcons.pictureAsPdf`.
  static const UxIconData pictureAsPdf = HugeIcons.strokeRoundedPdf01;

  /// Replaces `UxIcons.playlistAdd`.
  static const UxIconData playlistAdd = HugeIcons.strokeRoundedPlayListAdd;

  /// Replaces `UxIcons.podcasts`.
  static const UxIconData podcasts = HugeIcons.strokeRoundedPodcast;

  /// Replaces `UxIcons.psychology`.
  static const UxIconData psychology = HugeIcons.strokeRoundedBrain01;

  /// Replaces `UxIcons.psychologyAlt`.
  static const UxIconData psychologyAlt = HugeIcons.strokeRoundedBrain01;

  /// Replaces `UxIcons.public`.
  static const UxIconData public = HugeIcons.strokeRoundedGlobe;

  /// Replaces `UxIcons.qrCodeScanner`, `UxIcons.qrCodeScanner`.
  static const UxIconData qrCodeScanner = HugeIcons.strokeRoundedQrCode;

  /// Replaces `UxIcons.quiz`.
  static const UxIconData quiz = HugeIcons.strokeRoundedHelpCircle;

  /// Replaces `UxIcons.radioButtonChecked`.
  static const UxIconData radioButtonChecked =
      HugeIcons.strokeRoundedRadioButton;

  /// Replaces `UxIcons.radioButtonUnchecked`,
  /// `UxIcons.radioButtonUnchecked`.
  static const UxIconData radioButtonUnchecked = HugeIcons.strokeRoundedCircle;

  /// Replaces `UxIcons.refresh`.
  static const UxIconData refresh = HugeIcons.strokeRoundedRefresh01;

  /// Replaces `UxIcons.remove`.
  static const UxIconData remove = HugeIcons.strokeRoundedRemove01;

  /// Replaces `UxIcons.removeCircle`.
  static const UxIconData removeCircle = HugeIcons.strokeRoundedRemoveCircle;

  /// Replaces `UxIcons.report`.
  static const UxIconData report = HugeIcons.strokeRoundedAlert01;

  /// Replaces `UxIcons.restartAlt`.
  static const UxIconData restartAlt = HugeIcons.strokeRoundedRefresh01;

  /// Replaces `UxIcons.rocketLaunch`.
  static const UxIconData rocketLaunch = HugeIcons.strokeRoundedRocket01;

  /// Replaces `UxIcons.router`.
  static const UxIconData router = HugeIcons.strokeRoundedRouter;

  /// Replaces `UxIcons.saveAlt`.
  static const UxIconData saveAlt = HugeIcons.strokeRoundedDownload01;

  /// Replaces `UxIcons.schedule`.
  static const UxIconData schedule = HugeIcons.strokeRoundedClock01;

  /// Replaces `UxIcons.search`.
  static const UxIconData search = HugeIcons.strokeRoundedSearch01;

  /// Replaces `UxIcons.selectAll`.
  static const UxIconData selectAll =
      HugeIcons.strokeRoundedCursorMagicSelection04;

  /// Replaces `UxIcons.sell`.
  static const UxIconData sell = HugeIcons.strokeRoundedTag01;

  /// Replaces `UxIcons.settings`.
  static const UxIconData settings = HugeIcons.strokeRoundedSettings01;

  /// Replaces `UxIcons.shield`, `UxIcons.shield`.
  static const UxIconData shield = HugeIcons.strokeRoundedShield01;

  /// Replaces `UxIcons.smartToy`, `UxIcons.smartToy`.
  static const UxIconData smartToy = HugeIcons.strokeRoundedRobot01;

  /// Replaces `UxIcons.smartphone`.
  static const UxIconData smartphone = HugeIcons.strokeRoundedSmartPhone01;

  /// Replaces `UxIcons.sort`.
  static const UxIconData sort = HugeIcons.strokeRoundedSortByDown02;

  /// Replaces `UxIcons.source`.
  static const UxIconData source = HugeIcons.strokeRoundedSourceCode;

  /// Replaces `UxIcons.star`.
  static const UxIconData star = HugeIcons.strokeRoundedStar;

  /// Replaces `UxIcons.stop`.
  static const UxIconData stop = HugeIcons.strokeRoundedStopCircle;

  /// Replaces `UxIcons.swapHoriz`.
  static const UxIconData swapHoriz =
      HugeIcons.strokeRoundedArrowDataTransferHorizontal;

  /// Replaces `UxIcons.systemUpdate`, `UxIcons.systemUpdate`.
  static const UxIconData systemUpdate = HugeIcons.strokeRoundedSystemUpdate01;

  /// Replaces `UxIcons.tableChart`.
  static const UxIconData tableChart = HugeIcons.strokeRoundedTable;

  /// Replaces `UxIcons.terminal`.
  static const UxIconData terminal = HugeIcons.strokeRoundedComputerTerminal01;

  /// Replaces `UxIcons.textFields`.
  static const UxIconData textFields = HugeIcons.strokeRoundedTextFont;

  /// Replaces `UxIcons.toggleOff`.
  static const UxIconData toggleOff = HugeIcons.strokeRoundedToggleOff;

  /// Replaces `UxIcons.toggleOn`.
  static const UxIconData toggleOn = HugeIcons.strokeRoundedToggleOn;

  /// Replaces `UxIcons.toll`.
  static const UxIconData toll = HugeIcons.strokeRoundedCoins01;

  /// Replaces `UxIcons.unarchive`.
  static const UxIconData unarchive = HugeIcons.strokeRoundedUnarchive03;

  /// Replaces `UxIcons.undo`.
  static const UxIconData undo = HugeIcons.strokeRoundedArrowTurnBackward;

  /// Replaces `UxIcons.unfoldLess`.
  static const UxIconData unfoldLess = HugeIcons.strokeRoundedCollapse;

  /// Replaces `UxIcons.unfoldMore`.
  static const UxIconData unfoldMore = HugeIcons.strokeRoundedArrowExpand;

  /// Replaces `UxIcons.upload`.
  static const UxIconData upload = HugeIcons.strokeRoundedUpload01;

  /// Replaces `UxIcons.uploadFile`.
  static const UxIconData uploadFile = HugeIcons.strokeRoundedFileUpload;

  /// Replaces `UxIcons.verifiedUser`.
  static const UxIconData verifiedUser = HugeIcons.strokeRoundedShieldUser;

  /// Replaces `UxIcons.verticalAlignBottom`.
  static const UxIconData verticalAlignBottom =
      HugeIcons.strokeRoundedArrowDown05;

  /// Replaces `UxIcons.visibility`, `UxIcons.visibility`.
  static const UxIconData visibility = HugeIcons.strokeRoundedView;

  /// Replaces `UxIcons.visibilityOff`.
  static const UxIconData visibilityOff = HugeIcons.strokeRoundedViewOff;

  /// Replaces `UxIcons.vpnKey`.
  static const UxIconData vpnKey = HugeIcons.strokeRoundedKey01;

  /// Replaces `UxIcons.warningAmber`.
  static const UxIconData warningAmber = HugeIcons.strokeRoundedAlert02;

  /// Replaces `UxIcons.widgets`.
  static const UxIconData widgets = HugeIcons.strokeRoundedDashboardSquare01;

  /// Replaces `UxIcons.wifiFind`.
  static const UxIconData wifiFind = HugeIcons.strokeRoundedWifiSync;

  /// Replaces `UxIcons.wifiTethering`.
  static const UxIconData wifiTethering =
      HugeIcons.strokeRoundedWifiConnected01;
}
