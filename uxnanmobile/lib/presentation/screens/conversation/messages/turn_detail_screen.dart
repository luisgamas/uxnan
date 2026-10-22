import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/core/errors/rpc_exception.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/services/work_runs.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// What a [TurnDetailScreen] shows: something a reply carries only in part
/// in the conversation, read whole from the bridge.
sealed class TurnDetailRequest {
  const TurnDetailRequest({required this.threadId, required this.turnId});

  /// The conversation.
  final String threadId;

  /// The turn whose reply holds it.
  final String turnId;
}

/// One step — a command, a tool call or a thought — whole (`turn/step`).
class StepDetailRequest extends TurnDetailRequest {
  /// Creates a [StepDetailRequest] for [step], the preview the reply holds.
  const StepDetailRequest({
    required super.threadId,
    required super.turnId,
    required this.step,
  });

  /// The step as the conversation holds it: a [CommandExecutionContent], a
  /// [ToolUseContent] or a [ThinkingContent], whole or a preview with its
  /// stored index.
  final MessageContent step;
}

/// Every edit a turn made to one file, with their bodies.
class FileDiffDetailRequest extends TurnDetailRequest {
  /// Creates a [FileDiffDetailRequest].
  const FileDiffDetailRequest({
    required super.threadId,
    required super.turnId,
    required this.file,
  });

  /// The file, as the turn's changed-files list holds it.
  final TurnChangedFile file;
}

/// A full-screen reader for what the conversation shows only in part: a
/// command's whole output, a file's diff, a whole thought.
///
/// The conversation never lays out more than a preview of these — a long
/// output or diff there was one widget per line in one non-lazy column, built
/// on every rebuild. Here the text is split into lines (long ones into
/// chunks) and laid out lazily: only what is on screen is built, however
/// large it is. Selection spans the whole text, and the top bar copies all of
/// it.
///
/// What is already whole on the phone (a short command, an edit stored with
/// its body, a thought that streamed here) is shown without asking the
/// bridge; the rest is read when the screen opens — or, offline, as soon as
/// the computer is connected again.
class TurnDetailScreen extends ConsumerStatefulWidget {
  /// Creates a [TurnDetailScreen].
  const TurnDetailScreen({required this.request, super.key});

  /// What to show.
  final TurnDetailRequest request;

  /// Opens the screen for [request] above the conversation.
  static Future<void> open(BuildContext context, TurnDetailRequest request) =>
      Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => TurnDetailScreen(request: request),
        ),
      );

  @override
  ConsumerState<TurnDetailScreen> createState() => _TurnDetailScreenState();
}

class _TurnDetailScreenState extends ConsumerState<TurnDetailScreen> {
  /// The content, once it is here.
  _DetailContent? _content;

  /// Why it is not, when reading it failed.
  Object? _error;

  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _content = _localContent(widget.request);
    if (_content == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_load());
      });
    }
  }

  bool get _connected =>
      ref.read(connectionPhaseProvider).value == ConnectionPhase.connected;

  Future<void> _load() async {
    if (_loading || _content != null || !_connected) {
      if (mounted) setState(() {});
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final content = await _fetch(widget.request);
      if (!mounted) return;
      setState(() {
        _content = content;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<_DetailContent> _fetch(TurnDetailRequest request) async {
    final repository = ref.read(turnDetailRepositoryProvider);
    switch (request) {
      case StepDetailRequest(:final threadId, :final turnId, :final step):
        final index = stepIndexOf(step);
        if (index == null) return _DetailContent.ofStep(step);
        return _DetailContent.ofStep(
          await repository.readStep(threadId, turnId, index),
        );
      case FileDiffDetailRequest(:final threadId, :final turnId, :final file):
        final edits = await ref
            .read(fileEditsLoaderProvider)
            .load(threadId, turnId, file);
        return _DetailContent.ofEdits(file, edits);
    }
  }

  /// The content when the phone already holds all of it, else null.
  static _DetailContent? _localContent(TurnDetailRequest request) {
    switch (request) {
      case StepDetailRequest(:final step):
        final whole = switch (step) {
          final CommandExecutionContent c => !c.isCut,
          final ToolUseContent c => !c.isCut,
          final ThinkingContent c => !c.isCut,
          _ => false,
        };
        return whole ? _DetailContent.ofStep(step) : null;
      case FileDiffDetailRequest(:final file):
        final whole =
            file.runs.isEmpty && file.edits.every((edit) => edit.hasBody);
        return whole ? _DetailContent.ofEdits(file, file.edits) : null;
    }
  }

  String _title(AppLocalizations l10n) => switch (widget.request) {
        StepDetailRequest(:final step) => switch (step) {
            final ToolUseContent tool => tool.toolName.isEmpty
                ? l10n.turnDetailCommandTitle
                : tool.toolName,
            ThinkingContent() => l10n.conversationThought,
            _ => l10n.turnDetailCommandTitle,
          },
        FileDiffDetailRequest(:final file) => file.filename.split('/').last,
      };

  Future<void> _copyAll() async {
    final content = _content;
    if (content == null) return;
    await Clipboard.setData(ClipboardData(text: content.copyText));
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text(AppLocalizations.of(context).turnDetailCopied)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final topInset = NeTopBar.preferredHeight(context);
    // Offline, the screen waits for the computer: the moment it is connected
    // again, what it needs is read.
    ref.listen(connectionPhaseProvider, (previous, next) {
      if (next.value == ConnectionPhase.connected &&
          _content == null &&
          !_loading) {
        unawaited(_load());
      }
    });
    final connected =
        ref.watch(connectionPhaseProvider).value == ConnectionPhase.connected;
    final content = _content;
    final error = _error;

    final Widget body;
    if (content != null) {
      body = _DetailLines(
        content: content,
        topInset: topInset,
        l10n: l10n,
      );
    } else if (_loading) {
      body = const Center(child: PolygonLoader(size: 32));
    } else if (error != null) {
      final tooLarge =
          error is RpcException && error.code == RpcException.responseTooLarge;
      body = _DetailNotice(
        icon: UxIcons.error,
        text: tooLarge ? l10n.turnDetailTooLarge : l10n.turnDetailFailed,
        action: connected
            ? TextButton(onPressed: _load, child: Text(l10n.actionRetry))
            : null,
      );
    } else if (!connected) {
      body =
          _DetailNotice(icon: UxIcons.cloudOff, text: l10n.turnDetailOffline);
    } else {
      body = const Center(child: PolygonLoader(size: 32));
    }

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          body,
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: NeTopBar(
              leading: IconSurface(
                icon: UxIcons.arrowBack,
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                onPressed: () => unawaited(context.closePane()),
              ),
              title: Text(
                _title(l10n),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: textTheme.titleLarge?.copyWith(
                  fontSize: 20,
                  color: colors.onSurface,
                ),
              ),
              actions: [
                if (content != null && content.copyText.isNotEmpty)
                  IconSurface(
                    icon: UxIcons.contentCopy,
                    tooltip: l10n.actionCopy,
                    onPressed: _copyAll,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A centered state of the screen: offline, failed.
class _DetailNotice extends StatelessWidget {
  const _DetailNotice({required this.icon, required this.text, this.action});

  final UxIconData icon;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            UxIcon(icon, size: 32, color: colors.onSurfaceVariant),
            const SizedBox(height: UxnanSpacing.md),
            Text(
              text,
              textAlign: TextAlign.center,
              style: textTheme.bodyMedium?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
            if (action != null) ...[
              const SizedBox(height: UxnanSpacing.sm),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// How a line of the screen reads.
enum _LineKind {
  /// A section heading ("Output", "Edit 2 of 3").
  header,

  /// Monospaced text: a command, its output, a tool call.
  code,

  /// A diff line that adds.
  added,

  /// A diff line that removes.
  removed,

  /// A diff hunk marker (`@@ … @@`).
  hunk,

  /// Prose: a thought.
  prose,
}

/// One built row of the screen.
class _DetailLine {
  const _DetailLine(this.kind, this.text, {this.counts});

  final _LineKind kind;
  final String text;

  /// A header's `+additions −deletions`, when it heads an edit.
  final ({int additions, int deletions})? counts;
}

/// A section of the content before it is cut into rows.
sealed class _Section {
  const _Section();
}

class _HeaderSection extends _Section {
  const _HeaderSection(this.label, {this.counts});
  final String Function(AppLocalizations l10n) label;
  final ({int additions, int deletions})? counts;
}

class _TextSection extends _Section {
  const _TextSection(this.kind, this.text);
  final _LineKind kind;
  final String text;
}

class _DiffSection extends _Section {
  const _DiffSection(this.diff);
  final String diff;
}

/// What the screen shows, as sections, and the text "copy" puts on the
/// clipboard.
class _DetailContent {
  const _DetailContent(this.sections, this.copyText);

  factory _DetailContent.ofStep(MessageContent step) {
    switch (step) {
      case final CommandExecutionContent command:
        final output = command.output ?? '';
        return _DetailContent(
          [
            _TextSection(_LineKind.code, command.command),
            if (output.isNotEmpty || command.exitCode != null)
              _HeaderSection(
                (l10n) => command.exitCode == null
                    ? l10n.turnDetailOutputHeader
                    : '${l10n.turnDetailOutputHeader} · '
                        '${l10n.turnDetailExitCode(command.exitCode!)}',
              ),
            if (output.isNotEmpty) _TextSection(_LineKind.code, output),
          ],
          output.isEmpty ? command.command : '${command.command}\n\n$output',
        );
      case final ToolUseContent tool:
        final input = tool.input.isEmpty
            ? ''
            : const JsonEncoder.withIndent('  ').convert(tool.input);
        final output = switch (tool.output) {
          null => '',
          final String text => text,
          final Object value => _encodeOrString(value),
        };
        return _DetailContent(
          [
            if (input.isNotEmpty) ...[
              _HeaderSection((l10n) => l10n.turnDetailInputHeader),
              _TextSection(_LineKind.code, input),
            ],
            if (output.isNotEmpty) ...[
              _HeaderSection((l10n) => l10n.turnDetailResultHeader),
              _TextSection(_LineKind.code, output),
            ],
          ],
          [input, output].where((part) => part.isNotEmpty).join('\n\n'),
        );
      case final ThinkingContent thought:
        return _DetailContent(
          [_TextSection(_LineKind.prose, thought.text)],
          thought.text,
        );
      default:
        return const _DetailContent([], '');
    }
  }

  factory _DetailContent.ofEdits(
    TurnChangedFile file,
    List<DiffContent> edits,
  ) {
    final total = edits.length;
    return _DetailContent(
      [
        for (var i = 0; i < total; i++) ...[
          _HeaderSection(
            (l10n) => total == 1
                ? file.filename
                : l10n.turnDetailEditHeader(i + 1, total),
            counts: (
              additions: edits[i].additions,
              deletions: edits[i].deletions,
            ),
          ),
          _DiffSection(edits[i].diff),
        ],
      ],
      edits.map((edit) => edit.diff).join('\n'),
    );
  }

  final List<_Section> sections;
  final String copyText;

  /// The rows of the screen, built once per screen: every line of every
  /// section, a long one cut into [_chunk]-character pieces so no row lays
  /// out an unbounded paragraph.
  List<_DetailLine> lines(AppLocalizations l10n) {
    final out = <_DetailLine>[];
    for (final section in sections) {
      switch (section) {
        case _HeaderSection(:final label, :final counts):
          out.add(_DetailLine(_LineKind.header, label(l10n), counts: counts));
        case _TextSection(:final kind, :final text):
          for (final line in _trimmed(text.split('\n'))) {
            for (final piece in _pieces(line)) {
              out.add(_DetailLine(kind, piece));
            }
          }
        case _DiffSection(:final diff):
          for (final line in _trimmed(diff.split('\n'))) {
            if (_isDiffHeader(line)) continue;
            final kind = line.startsWith('@@')
                ? _LineKind.hunk
                : line.startsWith('+')
                    ? _LineKind.added
                    : line.startsWith('-')
                        ? _LineKind.removed
                        : _LineKind.code;
            for (final piece in _pieces(line)) {
              out.add(_DetailLine(kind, piece));
            }
          }
      }
    }
    return out;
  }

  static const int _chunk = 1000;

  static Iterable<String> _pieces(String line) sync* {
    if (line.length <= _chunk) {
      yield line;
      return;
    }
    for (var at = 0; at < line.length; at += _chunk) {
      yield line.substring(
        at,
        at + _chunk > line.length ? line.length : at + _chunk,
      );
    }
  }

  /// [lines] without the blank ones a text ends with.
  static List<String> _trimmed(List<String> lines) {
    var end = lines.length;
    while (end > 0 && lines[end - 1].trim().isEmpty) {
      end -= 1;
    }
    return lines.sublist(0, end);
  }

  /// Git's file-level header lines, which repeat what the heading says.
  static bool _isDiffHeader(String line) =>
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ');

  static String _encodeOrString(Object value) {
    try {
      return const JsonEncoder.withIndent('  ').convert(value);
    } on Object {
      return value.toString();
    }
  }
}

/// The content, laid out lazily: one row per line, built only on screen.
class _DetailLines extends StatefulWidget {
  const _DetailLines({
    required this.content,
    required this.topInset,
    required this.l10n,
  });

  final _DetailContent content;
  final double topInset;
  final AppLocalizations l10n;

  @override
  State<_DetailLines> createState() => _DetailLinesState();
}

class _DetailLinesState extends State<_DetailLines> {
  late List<_DetailLine> _lines = widget.content.lines(widget.l10n);

  @override
  void didUpdateWidget(covariant _DetailLines oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.content, widget.content) ||
        oldWidget.l10n != widget.l10n) {
      _lines = widget.content.lines(widget.l10n);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final lines = _lines;
    if (lines.isEmpty) {
      return _DetailNotice(
        icon: UxIcons.info,
        text: widget.l10n.turnDetailEmpty,
      );
    }
    final code = UxnanTypography.codeSmall.copyWith(color: colors.onSurface);
    return SelectionArea(
      child: ListView.builder(
        padding: EdgeInsets.fromLTRB(
          UxnanSpacing.lg,
          widget.topInset + UxnanSpacing.sm,
          UxnanSpacing.lg,
          UxnanSpacing.xl + MediaQuery.paddingOf(context).bottom,
        ),
        itemCount: lines.length,
        itemBuilder: (context, index) {
          final line = lines[index];
          switch (line.kind) {
            case _LineKind.header:
              final counts = line.counts;
              return Padding(
                padding: EdgeInsets.only(
                  top: index == 0 ? 0 : UxnanSpacing.lg,
                  bottom: UxnanSpacing.sm,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        line.text,
                        style: textTheme.labelLarge?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ),
                    if (counts != null) ...[
                      Text(
                        '+${counts.additions}',
                        style: UxnanTypography.codeSmall
                            .copyWith(color: UxnanColors.gitAdded),
                      ),
                      const SizedBox(width: UxnanSpacing.xs),
                      Text(
                        '−${counts.deletions}',
                        style: UxnanTypography.codeSmall
                            .copyWith(color: UxnanColors.gitDeleted),
                      ),
                    ],
                  ],
                ),
              );
            case _LineKind.prose:
              return Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  line.text,
                  style: textTheme.bodyMedium?.copyWith(
                    color: colors.onSurfaceVariant,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              );
            case _LineKind.code ||
                  _LineKind.added ||
                  _LineKind.removed ||
                  _LineKind.hunk:
              return ColoredBox(
                color: switch (line.kind) {
                  _LineKind.added =>
                    UxnanColors.gitAdded.withValues(alpha: 0.12),
                  _LineKind.removed =>
                    UxnanColors.gitDeleted.withValues(alpha: 0.12),
                  _LineKind.hunk =>
                    UxnanColors.gitUntracked.withValues(alpha: 0.10),
                  _ => Colors.transparent,
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: UxnanSpacing.xs,
                    vertical: 1,
                  ),
                  child: Text(line.text.isEmpty ? ' ' : line.text, style: code),
                ),
              );
          }
        },
      ),
    );
  }
}
