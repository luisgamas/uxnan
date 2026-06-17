import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// The file browser manager (lazy `workspace/list` walks, git-aware tree
/// state, in-memory cache per cwd).
///
/// Mirrors the [gitActionManagerProvider] pattern: a single shared manager
/// that the UI watches through per-cwd family providers.
final fileBrowserManagerProvider = Provider<FileBrowserManager>((ref) {
  final coordinator = ref.watch(sessionCoordinatorProvider);
  final manager = FileBrowserManager(
    sendRequest: coordinator.sendRequest,
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
