import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// The file browser manager (lazy `workspace/list` walks, git-aware tree
/// state, in-memory cache per cwd).
///
/// Mirrors the [gitActionManagerProvider] pattern: a single shared manager
/// that the UI watches through per-cwd family providers. Subscribes to the
/// shared `gitStatusBusProvider` so a `git/status` refresh from anywhere in
/// the app (a commit through the git screen, an external CLI commit on the
/// same PC, the file browser's own first paint) repaints the tree without a
/// manual reload.
final fileBrowserManagerProvider = Provider<FileBrowserManager>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  final manager = FileBrowserManager(
    sendRequest: coordinator.sendRequest,
    statusBus: ref.watch(gitStatusBusProvider),
  );
  ref.onDispose(manager.dispose);
  return manager;
});

/// Whether the file browser should hide file extensions on names. Persisted
/// per-device (resets on restart — kept in memory for now, like the threads
/// view's sort/density toggles).
class ShowFileExtensions extends Notifier<bool> {
  @override
  bool build() => true;

  /// Toggles the visibility of file extensions in the browser.
  void set({required bool value}) {
    if (state == value) return;
    state = value;
  }
}

/// Whether file extensions are shown in the file browser.
final showFileExtensionsProvider =
    NotifierProvider<ShowFileExtensions, bool>(ShowFileExtensions.new);

/// Whether hidden files (names starting with `.`) are shown in the file
/// browser. Defaults to `true` — the browser is meant to give full visibility.
class ShowHiddenFiles extends Notifier<bool> {
  @override
  bool build() => true;

  /// Toggles the visibility of dotfiles in the browser.
  void set({required bool value}) {
    if (state == value) return;
    state = value;
  }
}

/// Whether hidden files are shown in the file browser.
final showHiddenFilesProvider =
    NotifierProvider<ShowHiddenFiles, bool>(ShowHiddenFiles.new);

/// Whether each file row shows a details line (size + last-modified) under its
/// name. Defaults to `true` — the second line is useful metadata rather than a
/// redundant repeat of the name. Files only; directories never show details.
class ShowFileDetails extends Notifier<bool> {
  @override
  bool build() => true;

  /// Toggles the per-file details line in the browser.
  void set({required bool value}) {
    if (state == value) return;
    state = value;
  }
}

/// Whether file rows show the size + modified details line.
final showFileDetailsProvider =
    NotifierProvider<ShowFileDetails, bool>(ShowFileDetails.new);

/// Whether the file browser uses compact (denser, shorter) rows. Defaults to
/// `false` — rows are comfortable by default so names + details breathe; the
/// compact mode restores the tighter, single-line-height spacing.
class CompactFileRows extends Notifier<bool> {
  @override
  bool build() => false;

  /// Toggles compact row density in the browser.
  void set({required bool value}) {
    if (state == value) return;
    state = value;
  }
}

/// Whether the file browser renders compact (denser) rows.
final compactFileRowsProvider =
    NotifierProvider<CompactFileRows, bool>(CompactFileRows.new);

/// Whether the file viewer should render markdown as a styled preview. When
/// `false`, the raw markdown source is shown (preserving indent / escape
/// sequences) — useful for verifying what the agent actually wrote.
class ShowMarkdownPreview extends Notifier<bool> {
  @override
  bool build() => true;

  /// Toggles the markdown preview vs raw view.
  void set({required bool value}) {
    if (state == value) return;
    state = value;
  }
}

/// Whether markdown files render as a styled preview in the file viewer.
final showMarkdownPreviewProvider =
    NotifierProvider<ShowMarkdownPreview, bool>(ShowMarkdownPreview.new);

/// Whether the file viewer should show the git diff for files with changes.
/// When `true`, files with a non-null git status render their `git/diff`
/// output; when `false`, the viewer falls back to the raw file content.
class ShowFileDiff extends Notifier<bool> {
  @override
  bool build() => true;

  /// Toggles the git diff overlay in the file viewer.
  void set({required bool value}) {
    if (state == value) return;
    state = value;
  }
}

/// Whether the file viewer renders the git diff for changed files.
final showFileDiffProvider =
    NotifierProvider<ShowFileDiff, bool>(ShowFileDiff.new);
