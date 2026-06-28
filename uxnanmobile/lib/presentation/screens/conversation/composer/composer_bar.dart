import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/core/extensions/string_ext.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/value_objects/prompt_template.dart';
import 'package:uxnan/infrastructure/speech/speech_to_text_service.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/file_browser_providers.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_commands.dart';
import 'package:uxnan/presentation/screens/conversation/composer/mention_suggestion.dart';
import 'package:uxnan/presentation/screens/conversation/composer/mention_text_controller.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The message composer — a Neural Expressive **floating pill** (guide §4.3):
/// a `surfaceContainerHighest` rounded surface holding just the essentials —
/// a "+" that opens the turn-tools sheet (attach + run options + approval), an
/// expandable text field, and a trailing mic/send/stop. The model picker and
/// context meter moved up to the app bar; the run-option/approval controls moved
/// into the "+" sheet, so the composer stays uncluttered.
///
/// Two inline affordances float **above** the pill while typing:
///   - **`@` file mentions** — listing the thread's `cwd` (via `workspace/list`)
///     so a file/folder can be referenced by path; selecting a folder drills in,
///     a file finalizes the mention.
///   - **`/` command palette** — uxnan's own client-side commands (prompt
///     templates + the file-mention hand-off), only when the message
///     starts with `/`.
class ComposerBar extends ConsumerStatefulWidget {
  /// Creates a [ComposerBar].
  const ComposerBar({
    required this.onSend,
    this.enabled = true,
    this.running = false,
    this.hasAttachments = false,
    this.cwd,
    this.onStop,
    this.onPlus,
    super.key,
  });

  /// Called with the trimmed message when the user sends.
  final ValueChanged<String> onSend;

  /// Whether sending is currently allowed (e.g. connected).
  final bool enabled;

  /// Whether the composer has pending attachments — lets the user send with an
  /// empty text field (image-only message) and shows Send instead of the mic.
  final bool hasAttachments;

  /// Whether the agent is currently producing a turn — Send becomes Stop.
  final bool running;

  /// The thread's working directory, used to back the `@` file-mention picker.
  /// When null the `@` picker reports "no folder" (the `/` palette still works).
  final String? cwd;

  /// Cancels the in-flight turn. Required when [running] is true.
  final VoidCallback? onStop;

  /// Opens the unified turn-tools sheet (attach + run options + approval). When
  /// null the "+" is hidden (the agent advertises no tools).
  final VoidCallback? onPlus;

  @override
  ConsumerState<ComposerBar> createState() => _ComposerBarState();
}

class _ComposerBarState extends ConsumerState<ComposerBar> {
  // Renders completed `@` mentions as inline code-style badges (visual only —
  // the underlying text stays plain, so the sent prompt is unchanged).
  final MentionTextController _controller = MentionTextController();
  bool _hasText = false;

  /// Whether a voice-dictation session is currently active.
  bool _listening = false;

  /// The composer text captured when dictation started; recognized words are
  /// appended to it so dictation never clobbers what the user already typed.
  String _dictationBase = '';

  // ── Inline @-mention / -command state ───────────────────────────────────
  /// The active mention/command context at the caret, or null when none.
  ComposerTriggerContext? _trigger;

  /// The directory (workspace-relative) whose listing is cached in
  /// [_dirEntries]; lets a query that only changes the basename filter locally
  /// without a fresh `workspace/list`. Null = nothing listed yet.
  String? _listedDir;

  /// Raw entries of [_listedDir] (directories first, then files).
  List<FileEntry> _dirEntries = const [];

  /// Whether a directory listing is currently in flight.
  bool _listing = false;

  /// True when the last listing failed (shown as a soft error row).
  bool _listError = false;

  /// Monotonic token so a slow `workspace/list` can't clobber a newer one.
  int _listReq = 0;

  /// Whether the `@` picker is in repo-wide fuzzy-search mode (a basename
  /// fragment was typed) rather than directory-browse mode.
  bool _searchMode = false;

  /// The latest `workspace/searchFiles` matches (fuzzy mode).
  List<FileSearchMatch> _searchMatches = const [];

  /// Whether the last search was capped (more candidates matched).
  bool _searchTruncated = false;

  /// Whether a search is currently in flight.
  bool _searching = false;

  /// True when the last search failed.
  bool _searchError = false;

  /// Monotonic token so a slow search can't clobber a newer one.
  int _searchReq = 0;

  /// Whether the connected bridge supports `workspace/searchFiles`. Flipped to
  /// false the first time the method is rejected as unknown (an older bridge),
  /// after which `@name` degrades to browsing + filtering the current folder.
  bool _searchSupported = true;

  /// Debounce so each keystroke doesn't fire a `workspace/searchFiles`.
  Timer? _searchDebounce;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onChanged);
  }

  @override
  void didUpdateWidget(ComposerBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A different conversation (cwd) invalidates the cached listing + search.
    if (oldWidget.cwd != widget.cwd) {
      _listedDir = null;
      _dirEntries = const [];
      _searchMatches = const [];
      _searchMode = false;
    }
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    // Best-effort: stop any active dictation when the composer goes away.
    if (_listening) ref.read(speechToTextServiceProvider).cancel();
    _controller
      ..removeListener(_onChanged)
      ..dispose();
    super.dispose();
  }

  void _onChanged() {
    final hasText = _controller.text.isNotBlank;
    if (hasText != _hasText) setState(() => _hasText = hasText);
    _refreshTrigger();
  }

  /// Recomputes the active `@`/`/` context from the current text + caret and
  /// drives the file picker: an empty basename fragment (`@`, `@lib/`) browses
  /// that directory; a typed fragment fuzzy-searches the whole repo.
  void _refreshTrigger() {
    final sel = _controller.selection;
    final text = _controller.text;
    // Only a collapsed caret drives the affordance (a range selection doesn't).
    final next = sel.isValid && sel.isCollapsed
        ? detectComposerTrigger(text, sel.baseOffset)
        : null;
    if (next != _trigger) setState(() => _trigger = next);
    if (next != null && next.trigger == ComposerTrigger.file) {
      // Browse the directory when there's no basename fragment yet (`@`,
      // `@lib/`) — or when the bridge lacks repo-wide search (then `@name`
      // filters the current directory's listing locally). Otherwise fuzzy-
      // search the whole repo.
      if (splitFileQuery(next.query).name.isEmpty || !_searchSupported) {
        _searchDebounce?.cancel();
        if (_searchMode) setState(() => _searchMode = false);
        _ensureListing(next.query);
      } else {
        _scheduleSearch(next.query);
      }
    } else {
      _searchDebounce?.cancel();
    }
  }

  /// Ensures [_dirEntries] holds the listing for the directory implied by
  /// [query] (only re-fetching when the directory part changes).
  void _ensureListing(String query) {
    final cwd = widget.cwd;
    if (cwd == null) return;
    final dir = splitFileQuery(query).dir;
    if (dir == _listedDir && !_listError) return;
    final reqId = ++_listReq;
    setState(() {
      _listing = true;
      _listError = false;
    });
    ref
        .read(fileBrowserManagerProvider)
        .listDirectory(cwd, dir)
        .then((listing) {
      if (!mounted || reqId != _listReq) return;
      setState(() {
        _listedDir = dir;
        _dirEntries = listing.entries;
        _listing = false;
        _listError = false;
      });
    }).catchError((Object _) {
      if (!mounted || reqId != _listReq) return;
      setState(() {
        _listedDir = null;
        _dirEntries = const [];
        _listing = false;
        _listError = true;
      });
    });
  }

  /// Debounces a repo-wide fuzzy search for [query] so each keystroke doesn't
  /// fire a `workspace/searchFiles`.
  void _scheduleSearch(String query) {
    if (widget.cwd == null) return;
    if (!_searchMode) setState(() => _searchMode = true);
    _searchDebounce?.cancel();
    _searchDebounce =
        Timer(const Duration(milliseconds: 180), () => _runSearch(query));
  }

  void _runSearch(String query) {
    final cwd = widget.cwd;
    if (cwd == null) return;
    final reqId = ++_searchReq;
    setState(() {
      _searching = true;
      _searchError = false;
    });
    ref
        .read(fileBrowserManagerProvider)
        .searchFiles(cwd, query, limit: 40)
        .then((result) {
      if (!mounted || reqId != _searchReq) return;
      setState(() {
        _searchMatches = result.matches;
        _searchTruncated = result.truncated;
        _searching = false;
        _searchError = false;
      });
    }).catchError((Object error) {
      if (!mounted || reqId != _searchReq) return;
      // Degrade to browsing the dir part + local filter so `@name` still
      // surfaces matches in the current folder. An "unknown method" (older
      // bridge) disables repo-wide search for the rest of the session.
      final unsupported = error is WorkspaceMethodUnsupported;
      setState(() {
        _searchMatches = const [];
        _searchTruncated = false;
        _searching = false;
        _searchError = false;
        _searchMode = false;
        if (unsupported) _searchSupported = false;
      });
      _ensureListing(query);
    });
  }

  /// The file entries to show for the active file mention: [_dirEntries] of the
  /// listed directory filtered by the basename fragment (case-insensitive),
  /// capped so the panel never grows unbounded.
  List<FileEntry> get _fileMatches {
    final trigger = _trigger;
    if (trigger == null || trigger.trigger != ComposerTrigger.file) {
      return const [];
    }
    final name = splitFileQuery(trigger.query).name.toLowerCase();
    final matches = name.isEmpty
        ? _dirEntries
        : _dirEntries
            .where((e) => e.name.toLowerCase().contains(name))
            .toList();
    return matches.length > 50 ? matches.sublist(0, 50) : matches;
  }

  /// Applies a picked file/dir to the field: a folder drills in (keeps the
  /// picker open), a file finalizes the mention.
  void _pickEntry(FileEntry entry) {
    final trigger = _trigger;
    if (trigger == null) return;
    final dir = splitFileQuery(trigger.query).dir;
    final relativePath = dir.isEmpty ? entry.name : '$dir/${entry.name}';
    final edit = applyFileMention(
      _controller.text,
      trigger,
      relativePath: relativePath,
      isDir: entry.type == FileEntryType.dir,
    );
    _applyEdit(edit);
  }

  /// Applies a picked fuzzy-search match (its path is already repo-relative).
  void _pickMatch(FileSearchMatch match) {
    final trigger = _trigger;
    if (trigger == null) return;
    _applyEdit(
      applyFileMention(
        _controller.text,
        trigger,
        relativePath: match.path,
        isDir: match.type == FileEntryType.dir,
      ),
    );
  }

  /// Applies a picked `/` command: drops in its template or hands off to `@`.
  void _pickCommand(ComposerCommand command) {
    final trigger = _trigger;
    if (trigger == null) return;
    final replacement = switch (command.kind) {
      ComposerCommandKind.startFileMention => '@',
      ComposerCommandKind.insertTemplate => command.template ?? '',
    };
    _applyEdit(
      applyCommand(_controller.text, trigger, replacement: replacement),
    );
  }

  void _applyEdit(ComposerEdit edit) {
    _controller.value = TextEditingValue(
      text: edit.text,
      selection: TextSelection.collapsed(offset: edit.cursor),
    );
    // The controller listener re-detects the (possibly still-open) context.
  }

  void _send() {
    final text = _controller.text.trim();
    if (!widget.enabled) return;
    if (text.isEmpty && !widget.hasAttachments) return;
    widget.onSend(text);
    _controller.clear();
  }

  /// Starts or stops voice dictation. Recognized words stream into the field
  /// live; tapping again (or a final result) stops the session.
  Future<void> _toggleDictation() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final service = ref.read(speechToTextServiceProvider);

    if (_listening) {
      await service.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }

    final available = await service.initialize();
    if (!available) {
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.composerVoiceUnavailable)));
      return;
    }

    _dictationBase = _controller.text;
    await service.start(onResult: _onSpeechResult);
    if (mounted) setState(() => _listening = true);
  }

  void _onSpeechResult(SpeechResult result) {
    final base = _dictationBase;
    final joiner = base.isEmpty || base.endsWith(' ') ? '' : ' ';
    final text = '$base$joiner${result.text}';
    _controller
      ..text = text
      ..selection = TextSelection.collapsed(offset: text.length);
    // The session ends on a final result; reflect that in the mic state.
    if (result.isFinal) {
      _dictationBase = text;
      if (mounted) setState(() => _listening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final showSend = _hasText || widget.hasAttachments;
    final canSend = showSend && widget.enabled;
    // The `/` palette is the built-in file hand-off + the user's templates.
    final templates = ref.watch(promptTemplatesLibraryProvider);

    return SafeArea(
      top: false,
      child: Center(
        child: ConstrainedBox(
          constraints:
              const BoxConstraints(maxWidth: UxnanSpacing.maxContentWidth),
          child: Padding(
            // Floating pill: gutter all around, lifted off the screen edge.
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.lg,
              UxnanSpacing.sm,
              UxnanSpacing.lg,
              UxnanSpacing.md,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Inline suggestion panel floats above the pill while a mention
                // or command is active.
                if (_trigger != null)
                  _SuggestionPanel(
                    trigger: _trigger!,
                    templates: templates,
                    files: _fileMatches,
                    listing: _listing,
                    listError: _listError,
                    searchMode: _searchMode,
                    searchMatches: _searchMatches,
                    searchTruncated: _searchTruncated,
                    searching: _searching,
                    searchError: _searchError,
                    hasWorkspace: widget.cwd != null,
                    onPickEntry: _pickEntry,
                    onPickMatch: _pickMatch,
                    onPickCommand: _pickCommand,
                  ),
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: colors.surfaceContainerHighest,
                    // Fully rounded (pill) to match the other NE surfaces;
                    // grows into a capsule when multi-line.
                    borderRadius: const BorderRadius.all(UxnanRadius.full),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: UxnanSpacing.xs,
                      vertical: UxnanSpacing.xs,
                    ),
                    child: Row(
                      // crossAxisAlignment defaults to center, so the "+", the
                      // text field and the mic/send button share one baseline
                      // (different intrinsic heights); the field grows upward
                      // when multi-line.
                      children: [
                        // "+" opens the unified turn-tools sheet; hidden when
                        // the agent advertises no attach/run-options/approval.
                        if (widget.onPlus != null)
                          IconButton(
                            tooltip: l10n.composerTools,
                            visualDensity: VisualDensity.compact,
                            icon: Icon(
                              Icons.add_rounded,
                              size: 22,
                              color: colors.onSurfaceVariant,
                            ),
                            onPressed: widget.onPlus,
                          )
                        else
                          const SizedBox(width: UxnanSpacing.sm),
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              vertical: UxnanSpacing.sm,
                            ),
                            child: TextField(
                              controller: _controller,
                              // Autofocus so the keyboard opens as soon as the
                              // conversation is opened — users almost always
                              // want to start typing right away. The tap-
                              // outside-to-unfocus behavior (FocusScope.unfocus
                              // in ConversationScreen) still works: tapping the
                              // timeline dismisses the keyboard.
                              autofocus: true,
                              // Always editable so a message can be drafted
                              // while offline; only *sending* is gated by
                              // [enabled].
                              minLines: 1,
                              maxLines: 6,
                              style: textTheme.bodyMedium,
                              textInputAction: TextInputAction.newline,
                              decoration: InputDecoration(
                                isCollapsed: true,
                                border: InputBorder.none,
                                hintText: l10n.composerHint,
                                hintStyle:
                                    TextStyle(color: colors.onSurfaceVariant),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: UxnanSpacing.xs),
                        _TrailingAction(
                          hasText: showSend,
                          enabled: widget.enabled,
                          running: widget.running,
                          listening: _listening,
                          onSend: canSend ? _send : null,
                          onStop: widget.onStop,
                          onVoice: widget.enabled ? _toggleDictation : null,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The floating suggestion card above the pill: an `@` file/folder list or the
/// `/` command palette, depending on the active [trigger].
class _SuggestionPanel extends StatelessWidget {
  const _SuggestionPanel({
    required this.trigger,
    required this.templates,
    required this.files,
    required this.listing,
    required this.listError,
    required this.searchMode,
    required this.searchMatches,
    required this.searchTruncated,
    required this.searching,
    required this.searchError,
    required this.hasWorkspace,
    required this.onPickEntry,
    required this.onPickMatch,
    required this.onPickCommand,
  });

  final ComposerTriggerContext trigger;
  final List<PromptTemplate> templates;
  final List<FileEntry> files;
  final bool listing;
  final bool listError;
  final bool searchMode;
  final List<FileSearchMatch> searchMatches;
  final bool searchTruncated;
  final bool searching;
  final bool searchError;
  final bool hasWorkspace;
  final ValueChanged<FileEntry> onPickEntry;
  final ValueChanged<FileSearchMatch> onPickMatch;
  final ValueChanged<ComposerCommand> onPickCommand;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final isCommand = trigger.trigger == ComposerTrigger.command;
    final commands = isCommand
        ? matchComposerCommands(
            composerCommands(l10n, templates),
            trigger.query,
          )
        : const <ComposerCommand>[];

    final title =
        isCommand ? l10n.composerCommandsTitle : l10n.composerMentionFilesTitle;

    final Widget body;
    if (isCommand) {
      body = commands.isEmpty
          ? _EmptyRow(label: l10n.composerCommandsEmpty)
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final command in commands)
                  _CommandRow(
                    command: command,
                    onTap: () => onPickCommand(command),
                  ),
              ],
            );
    } else if (!hasWorkspace) {
      body = _EmptyRow(label: l10n.composerMentionNoWorkspace);
    } else if (searchMode) {
      // Repo-wide fuzzy search.
      if (searchError) {
        body = _EmptyRow(label: l10n.composerMentionError);
      } else if (searching && searchMatches.isEmpty) {
        body = _EmptyRow(label: l10n.composerMentionLoading);
      } else if (searchMatches.isEmpty) {
        body = _EmptyRow(label: l10n.composerMentionEmpty);
      } else {
        body = Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final match in searchMatches)
              _MatchRow(match: match, onTap: () => onPickMatch(match)),
            if (searchTruncated) _EmptyRow(label: l10n.composerMentionMore),
          ],
        );
      }
    } else if (listError) {
      body = _EmptyRow(label: l10n.composerMentionError);
    } else if (listing && files.isEmpty) {
      body = _EmptyRow(label: l10n.composerMentionLoading);
    } else if (files.isEmpty) {
      body = _EmptyRow(label: l10n.composerMentionEmpty);
    } else {
      body = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final entry in files)
            _FileRow(entry: entry, onTap: () => onPickEntry(entry)),
        ],
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
      child: Material(
        color: colors.surfaceContainerHigh,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 260),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  UxnanSpacing.md,
                  UxnanSpacing.sm,
                  UxnanSpacing.md,
                  UxnanSpacing.xs,
                ),
                child: Text(
                  title,
                  style: textTheme.labelSmall?.copyWith(
                    color: colors.onSurfaceVariant,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Flexible(
                child: SingleChildScrollView(
                  child: body,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A single file/folder suggestion row.
class _FileRow extends StatelessWidget {
  const _FileRow({required this.entry, required this.onTap});

  final FileEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final isDir = entry.type == FileEntryType.dir;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.md,
          vertical: UxnanSpacing.sm,
        ),
        child: Row(
          children: [
            Icon(
              isDir ? Icons.folder_rounded : Icons.insert_drive_file_outlined,
              size: 18,
              color: entry.ignored
                  ? colors.onSurfaceVariant.withValues(alpha: 0.6)
                  : (isDir ? colors.primary : colors.onSurfaceVariant),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Text(
                isDir ? '${entry.name}/' : entry.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: textTheme.bodyMedium?.copyWith(
                  fontStyle: entry.ignored ? FontStyle.italic : null,
                  color: entry.ignored
                      ? colors.onSurfaceVariant
                      : colors.onSurface,
                ),
              ),
            ),
            if (isDir)
              Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: colors.onSurfaceVariant,
              ),
          ],
        ),
      ),
    );
  }
}

/// A single fuzzy-search result row: the full repo-relative path with the
/// basename emphasized and the parent directory muted (so deep matches read
/// clearly), plus a file/folder icon.
class _MatchRow extends StatelessWidget {
  const _MatchRow({required this.match, required this.onTap});

  final FileSearchMatch match;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final isDir = match.type == FileEntryType.dir;
    final slash = match.path.lastIndexOf('/');
    final dir = slash < 0 ? '' : match.path.substring(0, slash + 1);
    final name = slash < 0 ? match.path : match.path.substring(slash + 1);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.md,
          vertical: UxnanSpacing.sm,
        ),
        child: Row(
          children: [
            Icon(
              isDir ? Icons.folder_rounded : Icons.insert_drive_file_outlined,
              size: 18,
              color: isDir ? colors.primary : colors.onSurfaceVariant,
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Text.rich(
                TextSpan(
                  children: [
                    if (dir.isNotEmpty)
                      TextSpan(
                        text: dir,
                        style: textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    TextSpan(
                      text: isDir ? '$name/' : name,
                      style: textTheme.bodyMedium?.copyWith(
                        color: colors.onSurface,
                      ),
                    ),
                  ],
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (isDir)
              Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: colors.onSurfaceVariant,
              ),
          ],
        ),
      ),
    );
  }
}

/// A single `/` command palette row.
class _CommandRow extends StatelessWidget {
  const _CommandRow({required this.command, required this.onTap});

  final ComposerCommand command;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.md,
          vertical: UxnanSpacing.sm,
        ),
        child: Row(
          children: [
            Icon(command.icon, size: 18, color: colors.primary),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    command.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  Text(
                    command.description,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A muted single-line state row (loading / empty / error) inside the panel.
class _EmptyRow extends StatelessWidget {
  const _EmptyRow({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.md,
        vertical: UxnanSpacing.md,
      ),
      child: Text(
        label,
        style: textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
      ),
    );
  }
}

/// The pill's trailing button: Stop while running, Send when there's text,
/// otherwise the mic (which toggles voice dictation).
class _TrailingAction extends StatelessWidget {
  const _TrailingAction({
    required this.hasText,
    required this.enabled,
    required this.running,
    required this.listening,
    required this.onSend,
    required this.onStop,
    required this.onVoice,
  });

  final bool hasText;
  final bool enabled;
  final bool running;
  final bool listening;
  final VoidCallback? onSend;
  final VoidCallback? onStop;
  final VoidCallback? onVoice;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context);

    final Widget child;
    if (running) {
      child = IconButton.filled(
        key: const ValueKey('stop'),
        tooltip: l10n.composerStop,
        onPressed: onStop,
        style: IconButton.styleFrom(
          backgroundColor: colors.error,
          foregroundColor: colors.onError,
        ),
        icon: const Icon(Icons.stop_rounded),
      );
    } else if (hasText) {
      child = IconButton.filled(
        key: const ValueKey('send'),
        tooltip: l10n.composerSend,
        onPressed: onSend,
        icon: const Icon(Icons.arrow_upward_rounded),
      );
    } else {
      child = IconButton(
        key: const ValueKey('mic'),
        tooltip: listening ? l10n.composerVoiceStop : l10n.composerVoice,
        isSelected: listening,
        style: listening
            ? IconButton.styleFrom(
                backgroundColor: colors.errorContainer,
                foregroundColor: colors.onErrorContainer,
              )
            : null,
        icon: Icon(
          listening ? Icons.mic_rounded : Icons.mic_none_rounded,
          color: listening ? colors.onErrorContainer : colors.onSurfaceVariant,
        ),
        onPressed: onVoice,
      );
    }

    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 180),
      transitionBuilder: (child, animation) =>
          ScaleTransition(scale: animation, child: child),
      child: child,
    );
  }
}
