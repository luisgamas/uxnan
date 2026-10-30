import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_highlight/themes/atom-one-light.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:uxnan/core/errors/rpc_exception.dart';
import 'package:uxnan/core/utils/elapsed_format.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/domain/enums/approval_risk.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/enums/context_compaction_reason.dart';
import 'package:uxnan/domain/enums/plan_step_status.dart';
import 'package:uxnan/domain/enums/subagent_action_kind.dart';
import 'package:uxnan/domain/enums/system_content_kind.dart';
import 'package:uxnan/domain/services/work_runs.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/approval_providers.dart';
import 'package:uxnan/presentation/providers/question_providers.dart';
import 'package:uxnan/presentation/screens/conversation/messages/streaming_markdown_split.dart';
import 'package:uxnan/presentation/screens/conversation/messages/turn_detail_screen.dart';
import 'package:uxnan/presentation/screens/conversation/messages/view_block.dart';
import 'package:uxnan/presentation/screens/conversation/messages/workspace_path_links.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/markdown.dart';
import 'package:uxnan/presentation/theme/motion.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/attachment_chip.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_filled_field.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Renders a single [MessageContent] block. The enclosing bubble provides the
/// background; this widget renders the block's body.
class MessageContentView extends StatelessWidget {
  /// Creates a [MessageContentView].
  const MessageContentView({
    required this.content,
    this.selectableText = true,
    this.threadId,
    this.onTapLink,
    super.key,
  });

  /// The content block to render.
  final MessageContent content;

  /// Whether text/markdown is selectable. Disabled for the user's own bubble so
  /// a tap on it toggles its copy affordance instead of placing a text cursor.
  final bool selectableText;

  /// Owning thread, needed to respond to an [ApprovalContent] / [QuestionContent];
  /// null elsewhere (e.g. the user's own bubble) leaves those cards read-only.
  final String? threadId;

  /// Handles Markdown and detected local-path links in assistant prose.
  final ValueChanged<String>? onTapLink;

  @override
  Widget build(BuildContext context) {
    return switch (content) {
      final TextContent c => _TextBlock(
          content: c,
          selectable: selectableText,
          onTapLink: onTapLink,
        ),
      // A thought is normally a row of its turn's work log
      // (AssistantTurnView); on its own it reads the same way.
      final ThinkingContent c => _ThoughtRow(thought: c),
      final CompactionContent c => _CompactionMarker(content: c),
      AssistantResponseBoundaryContent() => const SizedBox.shrink(),
      final CodeContent c => _CodeBlock(content: c),
      final CommandExecutionContent c => _CommandCard(content: c),
      final SystemContent c => _SystemBanner(content: c),
      final DiffContent c => _DiffBlock(content: c),
      final ImageContent c => _ImageBlock(content: c),
      final ViewContent c => ViewBlock(content: c, threadId: threadId),
      final AttachedFileContent c => AttachmentChip(attachment: c),
      final ToolUseContent c =>
        _Placeholder(icon: UxIcons.build, label: 'Tool · ${c.toolName}'),
      final MermaidContent _ =>
        const _Placeholder(icon: UxIcons.accountTree, label: 'Diagram'),
      final ApprovalContent c => _ApprovalCard(content: c, threadId: threadId),
      final QuestionContent c => _QuestionCard(content: c, threadId: threadId),
      final PlanContent c => _PlanCard(content: c),
      final SubagentContent c => _SubagentCard(content: c),
      final WorkRunContent c => _Placeholder(
          icon: UxIcons.terminal,
          label: _workRunCounts(AppLocalizations.of(context), c),
        ),
      final UnknownContent c =>
        _Placeholder(icon: UxIcons.widgets, label: c.type),
    };
  }
}

/// A quiet milestone in the conversation timeline showing where the agent
/// summarized earlier context to make room for more work: one muted line
/// between two hairlines, like a section divider. Tapping it unfolds why it
/// happened and how far the context shrank, in a muted line beneath; the
/// semantics label always carries all of it.
class _CompactionMarker extends StatefulWidget {
  const _CompactionMarker({required this.content});

  final CompactionContent content;

  @override
  State<_CompactionMarker> createState() => _CompactionMarkerState();
}

class _CompactionMarkerState extends State<_CompactionMarker> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final duration = UxnanMotion.revealIn(context);
    final content = widget.content;
    final reason = switch (content.reason) {
      ContextCompactionReason.manual => l10n.conversationCompactionManual,
      ContextCompactionReason.threshold => l10n.conversationCompactionThreshold,
      ContextCompactionReason.overflow => l10n.conversationCompactionOverflow,
      ContextCompactionReason.automatic => l10n.conversationCompactionAutomatic,
      ContextCompactionReason.unknown => l10n.conversationCompactionUnknown,
    };
    // In the app's language, as the desktop writes them (182 mil, not 182K).
    final count = NumberFormat.compact(
      locale: Localizations.localeOf(context).toLanguageTag(),
    );
    final tokens = content.tokensBefore != null && content.tokensAfter != null
        ? l10n.conversationCompactionTokens(
            count.format(content.tokensBefore),
            count.format(content.tokensAfter),
          )
        : null;
    // Both details are whole sentences, so they read on as one line of prose.
    final detail = [reason, if (tokens != null) tokens].join(' ');
    final muted = colors.onSurfaceVariant;
    void toggle() => setState(() => _open = !_open);

    return Semantics(
      key: const ValueKey('compaction-marker'),
      container: true,
      button: true,
      expanded: _open,
      label: [
        l10n.conversationCompactionTitle,
        reason,
        if (tokens != null) tokens,
      ].join('. '),
      excludeSemantics: true,
      onTap: toggle,
      child: InkWell(
        onTap: toggle,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Divider(color: colors.outlineVariant)),
                  const SizedBox(width: UxnanSpacing.sm),
                  Text(
                    l10n.conversationCompactionTitle,
                    style: textTheme.labelMedium?.copyWith(color: muted),
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  AnimatedRotation(
                    turns: _open ? 0.5 : 0,
                    duration: duration,
                    child: UxIcon(UxIcons.expandMore, size: 16, color: muted),
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(child: Divider(color: colors.outlineVariant)),
                ],
              ),
              AnimatedSize(
                duration: duration,
                curve: UxnanMotion.revealCurve,
                alignment: Alignment.topCenter,
                child: _open
                    ? Padding(
                        padding: const EdgeInsets.fromLTRB(
                          UxnanSpacing.lg,
                          UxnanSpacing.xs,
                          UxnanSpacing.lg,
                          0,
                        ),
                        child: Text(
                          detail,
                          textAlign: TextAlign.center,
                          style: textTheme.bodySmall?.copyWith(color: muted),
                        ),
                      )
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Renders an [ApprovalContent]: the requested action, its risk, and the
/// interactive Approve / Reject / "always allow this session" controls. The
/// card morphs (spring `AnimatedSize`) from the actions into a settled status
/// row once the user responds, shows an inline spinner while the response is in
/// flight, and re-enables on failure. Read-only when [threadId] is null or the
/// request has no id.
///
/// Once the user answers, the decision is persisted on-device (see
/// `ApprovalResponseStore`) so the card stays in its resolved state across
/// scrolls and app restarts — the action buttons never reappear.
///
/// Live end-to-end: the bridge emits `approval` blocks (Claude/Codex hooks,
/// OpenCode via `opencode serve`) and accepts `turn/send { approvalResponse }`.
class _ApprovalCard extends ConsumerWidget {
  const _ApprovalCard({required this.content, this.threadId});
  final ApprovalContent content;
  final String? threadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final request = content.request;
    final riskColor = _riskColor(request.risk);

    final canRespond = threadId != null && request.approvalId.isNotEmpty;
    final response = canRespond
        ? ref.watch(
            approvalResponsesProvider.select((m) => m[request.approvalId]),
          )
        : null;
    final phase = response?.phase ?? ApprovalResponsePhase.idle;
    final resolved = phase == ApprovalResponsePhase.resolved;
    final sending = phase == ApprovalResponsePhase.sending;

    void respond(ApprovalDecision decision) {
      if (!canRespond || sending || resolved) return;
      ref
          .read(approvalResponsesProvider.notifier)
          .respond(threadId!, request.approvalId, decision);
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        // Resolved cards drop the outline and pick up a soft tonal fill so the
        // "already answered" state reads as a settled status row, not a
        // pending prompt that the user might tap again.
        color: resolved
            ? riskColor.withValues(alpha: 0.08)
            : colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(
          color: resolved
              ? riskColor.withValues(alpha: 0.32)
              : colors.outlineVariant,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                UxIcon(
                  resolved
                      ? (response!.decision == ApprovalDecision.reject
                          ? UxIcons.cancel
                          : UxIcons.verifiedUser)
                      : UxIcons.shield,
                  size: 16,
                  color: riskColor,
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Text(
                  resolved
                      ? l10n.approvalDecidedTitle
                      : l10n.approvalNeedsApproval,
                  style: textTheme.labelMedium,
                ),
                const Spacer(),
                _RiskBadge(risk: request.risk),
              ],
            ),
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              request.action.isEmpty
                  ? l10n.approvalActionFallback
                  : request.action,
              style: textTheme.bodyMedium?.copyWith(
                color: resolved ? colors.onSurfaceVariant : colors.onSurface,
              ),
            ),
            if (request.detail != null && request.detail!.isNotEmpty) ...[
              const SizedBox(height: UxnanSpacing.xs),
              Text(request.detail!, style: UxnanTypography.codeSmall),
            ],
            const SizedBox(height: UxnanSpacing.sm),
            AnimatedSize(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              alignment: Alignment.topLeft,
              child: resolved
                  ? _ApprovalResolved(
                      decision: response!.decision!,
                      decidedAtMs: response.decidedAtMs,
                    )
                  : _ApprovalActions(
                      sending: sending,
                      failed: phase == ApprovalResponsePhase.failed,
                      enabled: canRespond,
                      pending: response?.decision,
                      onRespond: respond,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The action row of an [_ApprovalCard]: Reject + Approve, with a subtle
/// "always allow this session" affordance beneath, plus an inline failure note.
class _ApprovalActions extends StatelessWidget {
  const _ApprovalActions({
    required this.sending,
    required this.failed,
    required this.enabled,
    required this.pending,
    required this.onRespond,
  });

  final bool sending;
  final bool failed;
  final bool enabled;
  final ApprovalDecision? pending;
  final ValueChanged<ApprovalDecision> onRespond;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final acting = enabled && !sending;

    Widget label(ApprovalDecision decision, String text) {
      if (sending && pending == decision) {
        return const PolygonLoader(size: 16);
      }
      return Text(text);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (failed) ...[
          Row(
            children: [
              UxIcon(UxIcons.error, size: 14, color: colors.error),
              const SizedBox(width: UxnanSpacing.xs),
              Expanded(
                child: Text(
                  l10n.approvalFailed,
                  style: textTheme.bodySmall?.copyWith(color: colors.error),
                ),
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.sm),
        ],
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed:
                    acting ? () => onRespond(ApprovalDecision.reject) : null,
                child: label(ApprovalDecision.reject, l10n.approvalReject),
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: FilledButton(
                onPressed:
                    acting ? () => onRespond(ApprovalDecision.approve) : null,
                child: label(ApprovalDecision.approve, l10n.approvalApprove),
              ),
            ),
          ],
        ),
        Align(
          child: TextButton(
            onPressed: acting
                ? () => onRespond(ApprovalDecision.approveSession)
                : null,
            child: label(
              ApprovalDecision.approveSession,
              l10n.approvalAllowSession,
            ),
          ),
        ),
      ],
    );
  }
}

/// The settled status row shown once an approval has been answered.
///
/// Shows the decision + a relative timestamp ("Answered · 14:32") so the user
/// can tell, at a glance, that the card is no longer actionable — even after
/// a scroll, an app restart, or a thread re-open.
class _ApprovalResolved extends StatelessWidget {
  const _ApprovalResolved({required this.decision, this.decidedAtMs});

  final ApprovalDecision decision;
  final int? decidedAtMs;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final approved = decision != ApprovalDecision.reject;
    final color = approved ? UxnanColors.success : UxnanColors.error;
    final label = switch (decision) {
      ApprovalDecision.approve => l10n.approvalApproved,
      ApprovalDecision.reject => l10n.approvalRejected,
      ApprovalDecision.approveSession => l10n.approvalAllowedSession,
    };
    return Row(
      children: [
        UxIcon(
          approved ? UxIcons.checkCircle : UxIcons.cancel,
          size: 18,
          color: color,
        ),
        const SizedBox(width: UxnanSpacing.sm),
        Expanded(
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: UxnanSpacing.sm,
            runSpacing: 2,
            children: [
              Text(
                label,
                style: textTheme.labelLarge?.copyWith(color: color),
              ),
              if (decidedAtMs != null)
                Text(
                  _formatTimestamp(decidedAtMs!, l10n),
                  style: textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  /// Renders a compact "HH:MM" (today) or "MMM d · HH:MM" (older) timestamp,
  /// prefixed by the localized "answered" label.
  static String _formatTimestamp(int epochMs, AppLocalizations l10n) {
    final when = DateTime.fromMillisecondsSinceEpoch(epochMs).toLocal();
    final now = DateTime.now();
    final sameDay =
        when.year == now.year && when.month == now.month && when.day == now.day;
    final hh = when.hour.toString().padLeft(2, '0');
    final mm = when.minute.toString().padLeft(2, '0');
    if (sameDay) return '${l10n.approvalAnsweredAt} · $hh:$mm';
    // Older: include the short month + day. Locale-aware month names come
    // from the resolved locale; this is a best-effort fallback.
    final months = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ];
    final m = months[(when.month - 1).clamp(0, 11)];
    return '${l10n.approvalAnsweredAt} · $m ${when.day} · $hh:$mm';
  }
}

/// Renders a [QuestionContent]: one or more multiple-choice questions the
/// agent asks before continuing. Each question shows its header badge + text,
/// then its options as selectable rows — radio-style (single) or checkbox-style
/// (`multiple`) — with each option's optional description as a subtitle. A
/// primary "Submit" (disabled until every question with options has a
/// selection) sends the chosen labels; a secondary "Skip" sends empty answers.
///
/// Once answered, the card morphs (spring `AnimatedSize`) into a settled state
/// showing the chosen labels per question + a relative time, and stays resolved
/// across scrolls and app restarts — the answers are persisted on-device (see
/// `QuestionResponseStore`). Read-only when [threadId] is null or the request
/// has no id.
class _QuestionCard extends ConsumerStatefulWidget {
  const _QuestionCard({required this.content, this.threadId});
  final QuestionContent content;
  final String? threadId;

  @override
  ConsumerState<_QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends ConsumerState<_QuestionCard> {
  /// The user's in-progress selections, one label-set per question (by index).
  /// A `LinkedHashSet` preserves the tap order so multi-select answers keep the
  /// order the user chose.
  late List<Set<String>> _selected;

  /// What the user typed per question, on a question that takes it (`custom`).
  late List<TextEditingController> _typed;

  /// The question on screen: several are asked one at a time.
  int _step = 0;

  List<QuestionItem> get _questions => widget.content.request.questions;

  @override
  void initState() {
    super.initState();
    _selected = List.generate(_questions.length, (_) => <String>{});
    _typed = List.generate(_questions.length, (_) => TextEditingController());
  }

  @override
  void didUpdateWidget(covariant _QuestionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Re-sync the selection buffer if the question set is swapped under us.
    if (_questions.length != _selected.length) {
      _selected = List.generate(_questions.length, (_) => <String>{});
      for (final controller in _typed) {
        controller.dispose();
      }
      _typed = List.generate(_questions.length, (_) => TextEditingController());
      _step = 0;
    }
  }

  @override
  void dispose() {
    for (final controller in _typed) {
      controller.dispose();
    }
    super.dispose();
  }

  /// The answer sent for question [i]: the picks, with the typed text
  /// replacing a single choice or joining a multiple one.
  List<String> _answer(int i) {
    final question = _questions[i];
    final own = question.custom ? _typed[i].text.trim() : '';
    final chosen = _selected[i].toList();
    if (own.isEmpty) return chosen;
    return question.multiple ? [...chosen, own] : [own];
  }

  /// A question is satisfied once it has an answer — or trivially when there
  /// is nothing to pick or type (a degenerate payload).
  bool _satisfied(int i) =>
      (_questions[i].options.isEmpty && !_questions[i].custom) ||
      _answer(i).isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final request = widget.content.request;
    final questions = _questions;

    final canRespond = widget.threadId != null && request.questionId.isNotEmpty;
    final response = canRespond
        ? ref.watch(
            questionResponsesProvider.select((m) => m[request.questionId]),
          )
        : null;
    final phase = response?.phase ?? QuestionResponsePhase.idle;
    final resolved = phase == QuestionResponsePhase.resolved;
    final sending = phase == QuestionResponsePhase.sending;
    final interactive = canRespond && !resolved && !sending;

    // The accent tints the card outline/fill: neutral primary while pending,
    // a settled green once answered (mirrors the approval card).
    final accent = resolved ? UxnanColors.success : colors.primary;

    final canSubmit = interactive &&
        questions.isNotEmpty &&
        List.generate(questions.length, _satisfied).every((v) => v);

    List<String> chosenFor(int i) {
      final answers = response?.answers;
      if (answers == null || i >= answers.length) return const [];
      return answers[i];
    }

    // Several questions are asked one at a time while they can be answered;
    // once settled, every answer shows at once.
    final stepping = interactive && questions.length > 1;
    final step = _step.clamp(0, questions.isEmpty ? 0 : questions.length - 1);
    final onLast = !stepping || step == questions.length - 1;

    void toggle(int qIndex, String label) {
      if (!interactive) return;
      final single = !questions[qIndex].multiple;
      setState(() {
        final selection = _selected[qIndex];
        if (questions[qIndex].multiple) {
          selection.contains(label)
              ? selection.remove(label)
              : selection.add(label);
        } else {
          selection
            ..clear()
            ..add(label);
          // A picked option replaces what was typed for it.
          _typed[qIndex].clear();
        }
      });
      // A single choice answers its question: on to the next one, after a
      // beat so the pick is seen.
      if (stepping && single && qIndex == step && !onLast) {
        Future<void>.delayed(const Duration(milliseconds: 260), () {
          if (mounted && _step == qIndex) setState(() => _step = qIndex + 1);
        });
      }
    }

    void typed(int qIndex) {
      if (!interactive) return;
      setState(() {
        // A typed single answer replaces a picked option.
        if (!questions[qIndex].multiple &&
            _typed[qIndex].text.trim().isNotEmpty) {
          _selected[qIndex].clear();
        }
      });
    }

    void submit() {
      if (!canSubmit) return;
      final answers = [
        for (var i = 0; i < questions.length; i++) _answer(i),
      ];
      ref
          .read(questionResponsesProvider.notifier)
          .respond(widget.threadId!, request.questionId, answers);
    }

    void skip() {
      if (!interactive) return;
      final answers = List.generate(questions.length, (_) => <String>[]);
      ref
          .read(questionResponsesProvider.notifier)
          .respond(widget.threadId!, request.questionId, answers);
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        color: resolved
            ? accent.withValues(alpha: 0.08)
            : colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(
          color:
              resolved ? accent.withValues(alpha: 0.32) : colors.outlineVariant,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                UxIcon(
                  resolved ? UxIcons.checkCircle : UxIcons.quiz,
                  size: 16,
                  color: accent,
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Text(
                  resolved ? l10n.questionAnswered : l10n.questionNeedsAnswer,
                  style: textTheme.labelMedium,
                ),
                const Spacer(),
                if (stepping)
                  Text(
                    l10n.questionStep(step + 1, questions.length),
                    style: textTheme.labelMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  )
                else if (questions.length > 1)
                  _CountBadge(count: questions.length),
              ],
            ),
            for (var i = 0; i < questions.length; i++)
              if (!stepping || i == step) ...[
                const SizedBox(height: UxnanSpacing.md),
                _QuestionBlock(
                  question: questions[i],
                  selected: _selected[i],
                  resolved: resolved,
                  chosen: chosenFor(i),
                  enabled: interactive,
                  onToggle: (label) => toggle(i, label),
                  typed: _typed[i],
                  onTyped: () => typed(i),
                  onTypedDone: () {
                    if (!_satisfied(i)) return;
                    if (stepping && i < questions.length - 1) {
                      setState(() => _step = i + 1);
                    } else {
                      submit();
                    }
                  },
                ),
              ],
            const SizedBox(height: UxnanSpacing.sm),
            AnimatedSize(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              alignment: Alignment.topLeft,
              child: resolved
                  ? _QuestionResolved(answeredAtMs: response!.answeredAtMs)
                  : _QuestionActions(
                      canSubmit: canSubmit,
                      sending: sending,
                      failed: phase == QuestionResponsePhase.failed,
                      enabled: canRespond,
                      onSubmit: submit,
                      onSkip: skip,
                      onNext: onLast
                          ? null
                          : () => setState(() => _step = step + 1),
                      canNext: questions.isNotEmpty && _satisfied(step),
                      onBack: stepping && step > 0
                          ? () => setState(() => _step = step - 1)
                          : null,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One question inside a [_QuestionCard]: its header badge + text, then either
/// the selectable option rows (while actionable) or a summary of the chosen
/// labels (once resolved).
class _QuestionBlock extends StatelessWidget {
  const _QuestionBlock({
    required this.question,
    required this.selected,
    required this.resolved,
    required this.chosen,
    required this.enabled,
    required this.onToggle,
    required this.typed,
    required this.onTyped,
    required this.onTypedDone,
  });

  final QuestionItem question;
  final Set<String> selected;
  final bool resolved;
  final List<String> chosen;
  final bool enabled;
  final ValueChanged<String> onToggle;

  /// The user's own answer, on a question that takes one.
  final TextEditingController typed;

  /// Called on every edit of [typed].
  final VoidCallback onTyped;

  /// Called when the keyboard's action button is pressed in [typed].
  final VoidCallback onTypedDone;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final header = (question.header?.isNotEmpty ?? false)
        ? question.header!
        : l10n.questionHeaderFallback;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.sm,
            vertical: 2,
          ),
          decoration: BoxDecoration(
            color: colors.primary.withValues(alpha: 0.12),
            borderRadius: const BorderRadius.all(UxnanRadius.sm),
          ),
          child: Text(
            header,
            style: textTheme.labelSmall?.copyWith(color: colors.primary),
          ),
        ),
        const SizedBox(height: UxnanSpacing.xs),
        Text(
          question.question,
          style: textTheme.bodyMedium?.copyWith(
            color: resolved ? colors.onSurfaceVariant : colors.onSurface,
          ),
        ),
        const SizedBox(height: UxnanSpacing.sm),
        if (resolved)
          _QuestionChosenSummary(labels: chosen)
        else
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < question.options.length; i++) ...[
                if (i > 0) const SizedBox(height: 4),
                _QuestionOptionRow(
                  option: question.options[i],
                  selected: selected.contains(question.options[i].label),
                  multiple: question.multiple,
                  enabled: enabled,
                  onTap: () => onToggle(question.options[i].label),
                ),
              ],
              if (question.custom) ...[
                if (question.options.isNotEmpty) const SizedBox(height: 8),
                NeFilledField(
                  controller: typed,
                  icon: UxIcons.edit,
                  label: question.options.isEmpty
                      ? l10n.questionTypeAnswer
                      : l10n.questionTypeOther,
                  enabled: enabled,
                  textCapitalization: TextCapitalization.sentences,
                  textInputAction: TextInputAction.done,
                  onChanged: (_) => onTyped(),
                  onSubmitted: (_) => onTypedDone(),
                ),
              ],
            ],
          ),
      ],
    );
  }
}

/// A single selectable option row: a radio (single-select) or checkbox
/// (`multiple`) glyph, the option label, and its optional description subtitle.
/// The whole row is tappable; a selected row picks up a tonal fill + accent
/// border so the choice reads at a glance.
class _QuestionOptionRow extends StatelessWidget {
  const _QuestionOptionRow({
    required this.option,
    required this.selected,
    required this.multiple,
    required this.enabled,
    required this.onTap,
  });

  final QuestionOption option;
  final bool selected;
  final bool multiple;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final accent = colors.primary;
    final icon = multiple
        ? (selected ? UxIcons.checkBox : UxIcons.checkBoxOutlineBlank)
        : (selected
            ? UxIcons.radioButtonChecked
            : UxIcons.radioButtonUnchecked);
    final hasDescription =
        option.description != null && option.description!.isNotEmpty;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: selected
            ? accent.withValues(alpha: 0.10)
            : colors.surfaceContainerHigh.withValues(alpha: 0.5),
        borderRadius: const BorderRadius.all(UxnanRadius.md),
        border: Border.all(
          color: selected ? accent.withValues(alpha: 0.5) : Colors.transparent,
        ),
      ),
      child: InkWell(
        borderRadius: const BorderRadius.all(UxnanRadius.md),
        onTap: enabled ? onTap : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.sm,
            vertical: UxnanSpacing.sm,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 1),
                child: UxIcon(
                  icon,
                  size: 18,
                  color: selected ? accent : colors.onSurfaceVariant,
                ),
              ),
              const SizedBox(width: UxnanSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      option.label,
                      style: textTheme.bodyMedium?.copyWith(
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w400,
                      ),
                    ),
                    if (hasDescription) ...[
                      const SizedBox(height: 2),
                      Text(
                        option.description!,
                        style: textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The chosen answers for one question, shown once the card is resolved: a
/// wrap of small check-marked pills, or a muted "Skipped" note when the user
/// answered with no selection.
class _QuestionChosenSummary extends StatelessWidget {
  const _QuestionChosenSummary({required this.labels});
  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    if (labels.isEmpty) {
      return Text(
        l10n.questionSkipped,
        style: textTheme.bodySmall?.copyWith(
          color: colors.onSurfaceVariant,
          fontStyle: FontStyle.italic,
        ),
      );
    }
    return Wrap(
      spacing: UxnanSpacing.xs,
      runSpacing: UxnanSpacing.xs,
      children: [
        for (final label in labels)
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: UxnanSpacing.sm,
              vertical: 2,
            ),
            decoration: BoxDecoration(
              color: UxnanColors.success.withValues(alpha: 0.12),
              borderRadius: const BorderRadius.all(UxnanRadius.sm),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const UxIcon(
                  UxIcons.check,
                  size: 13,
                  color: UxnanColors.success,
                ),
                const SizedBox(width: 4),
                Text(
                  label,
                  style: textTheme.labelSmall
                      ?.copyWith(color: UxnanColors.success),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// The action row of a [_QuestionCard]: Skip + Submit, with an inline spinner
/// on Submit while the answer is in flight and a failure note above.
class _QuestionActions extends StatelessWidget {
  const _QuestionActions({
    required this.canSubmit,
    required this.sending,
    required this.failed,
    required this.enabled,
    required this.onSubmit,
    required this.onSkip,
    this.onNext,
    this.canNext = false,
    this.onBack,
  });

  /// Moves to the next question; null on the last one (Submit shows instead).
  final VoidCallback? onNext;

  /// Whether the question on screen is answered enough to move on.
  final bool canNext;

  /// Moves to the previous question; null on the first one.
  final VoidCallback? onBack;

  final bool canSubmit;
  final bool sending;
  final bool failed;
  final bool enabled;
  final VoidCallback onSubmit;
  final VoidCallback onSkip;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final acting = enabled && !sending;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (failed) ...[
          Row(
            children: [
              UxIcon(UxIcons.error, size: 14, color: colors.error),
              const SizedBox(width: UxnanSpacing.xs),
              Expanded(
                child: Text(
                  l10n.questionFailed,
                  style: textTheme.bodySmall?.copyWith(color: colors.error),
                ),
              ),
            ],
          ),
          const SizedBox(height: UxnanSpacing.sm),
        ],
        Row(
          children: [
            if (onBack != null) ...[
              IconButton(
                tooltip: l10n.questionBack,
                onPressed: acting ? onBack : null,
                icon: const UxIcon(UxIcons.chevronLeft),
              ),
              const SizedBox(width: UxnanSpacing.xs),
            ],
            Expanded(
              child: OutlinedButton(
                onPressed: acting ? onSkip : null,
                child: Text(l10n.questionSkip),
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: onNext != null
                  ? FilledButton.tonal(
                      onPressed: acting && canNext ? onNext : null,
                      child: Text(l10n.questionNext),
                    )
                  : FilledButton(
                      onPressed: acting && canSubmit ? onSubmit : null,
                      child: sending
                          ? const PolygonLoader(size: 16)
                          : Text(l10n.questionSubmit),
                    ),
            ),
          ],
        ),
      ],
    );
  }
}

/// The settled footer shown once a question card has been answered: a small
/// check + a relative "Answered · 14:32" timestamp (the chosen labels live in
/// each [_QuestionBlock]'s summary above).
class _QuestionResolved extends StatelessWidget {
  const _QuestionResolved({this.answeredAtMs});
  final int? answeredAtMs;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    if (answeredAtMs == null) return const SizedBox.shrink();
    return Row(
      children: [
        const UxIcon(
          UxIcons.checkCircle,
          size: 16,
          color: UxnanColors.success,
        ),
        const SizedBox(width: UxnanSpacing.sm),
        Text(
          _formatAnsweredTimestamp(answeredAtMs!, l10n.questionAnsweredAt),
          style: textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
        ),
      ],
    );
  }
}

/// Renders a compact "HH:MM" (today) or "MMM d · HH:MM" (older) timestamp,
/// prefixed by the localized [prefix] (e.g. "Answered · 14:32").
String _formatAnsweredTimestamp(int epochMs, String prefix) {
  final when = DateTime.fromMillisecondsSinceEpoch(epochMs).toLocal();
  final now = DateTime.now();
  final sameDay =
      when.year == now.year && when.month == now.month && when.day == now.day;
  final hh = when.hour.toString().padLeft(2, '0');
  final mm = when.minute.toString().padLeft(2, '0');
  if (sameDay) return '$prefix · $hh:$mm';
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ];
  final m = months[(when.month - 1).clamp(0, 11)];
  return '$prefix · $m ${when.day} · $hh:$mm';
}

/// Renders an [ImageContent]: an inline-base64 image as a bounded thumbnail, or
/// a path/placeholder when only a workspace path is known (no bytes inline).
class _ImageBlock extends StatelessWidget {
  const _ImageBlock({required this.content});
  final ImageContent content;

  @override
  Widget build(BuildContext context) {
    final data = content.base64Data;
    if (data == null) {
      return _Placeholder(
        icon: UxIcons.image,
        label: content.path ?? 'Image',
      );
    }
    return ClipRRect(
      borderRadius: const BorderRadius.all(UxnanRadius.md),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 280, maxWidth: 280),
        child: Image.memory(
          base64Decode(data),
          fit: BoxFit.contain,
          gaplessPlayback: true,
          errorBuilder: (context, _, __) => _Placeholder(
            icon: UxIcons.brokenImage,
            label: content.mimeType,
          ),
        ),
      ),
    );
  }
}

class _RiskBadge extends StatelessWidget {
  const _RiskBadge({required this.risk});
  final ApprovalRisk risk;

  @override
  Widget build(BuildContext context) {
    final color = _riskColor(risk);
    final l10n = AppLocalizations.of(context);
    final label = switch (risk) {
      ApprovalRisk.low => l10n.approvalRiskLow,
      ApprovalRisk.medium => l10n.approvalRiskMedium,
      ApprovalRisk.high => l10n.approvalRiskHigh,
      ApprovalRisk.unknown => l10n.approvalRiskUnknown,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UxnanSpacing.sm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: const BorderRadius.all(UxnanRadius.sm),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color),
      ),
    );
  }
}

Color _riskColor(ApprovalRisk risk) => switch (risk) {
      ApprovalRisk.low => UxnanColors.success,
      ApprovalRisk.medium => UxnanColors.warning,
      ApprovalRisk.high => UxnanColors.error,
      ApprovalRisk.unknown => UxnanColors.connecting,
    };

/// Renders a [PlanContent]: an optional title and the plan steps with status.
/// Collapsed by default — shows the header (icon + title + count badge +
/// expand chevron) and a preview of the first 2 steps. Expanding reveals all
/// steps grouped with dynamic corner radii (Neural Expressive §4.6).
class _PlanCard extends StatefulWidget {
  const _PlanCard({required this.content});
  final PlanContent content;

  @override
  State<_PlanCard> createState() => _PlanCardState();
}

class _PlanCardState extends State<_PlanCard> {
  bool _expanded = false;
  static const int _preview = 2;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final state = widget.content.state;
    final steps = state.steps;
    final shown = _expanded ? steps : steps.take(_preview).toList();
    final extra = steps.length - shown.length;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.all(UxnanSpacing.md),
              child: Row(
                children: [
                  UxIcon(
                    UxIcons.checklist,
                    size: 16,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Text(
                    state.title?.isNotEmpty ?? false ? state.title! : 'Plan',
                    style: textTheme.labelMedium,
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  _CountBadge(count: steps.length),
                  const Spacer(),
                  if (!_expanded && extra > 0) ...[
                    Text(
                      '+$extra',
                      style: textTheme.labelSmall
                          ?.copyWith(color: colors.onSurfaceVariant),
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                  ],
                  UxIcon(
                    _expanded ? UxIcons.expandLess : UxIcons.expandMore,
                    size: 18,
                    color: colors.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: shown.isNotEmpty
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(
                      UxnanSpacing.md,
                      0,
                      UxnanSpacing.md,
                      UxnanSpacing.md,
                    ),
                    child: _PlanStepGroup(
                      steps: shown,
                      totalSteps: steps.length,
                      isExpanded: _expanded,
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

/// The step list inside a [_PlanCard], rendered as a grouped column with
/// dynamic corner radii per Neural Expressive §4.6: the first item has
/// larger top corners, the last has larger bottom corners, and middle
/// items use a tight radius — creating a cohesive visual cluster.
class _PlanStepGroup extends StatelessWidget {
  const _PlanStepGroup({
    required this.steps,
    required this.totalSteps,
    required this.isExpanded,
  });
  final List<PlanStep> steps;
  final int totalSteps;
  final bool isExpanded;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final count = steps.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < count; i++) ...[
          if (i > 0) const SizedBox(height: 3),
          _buildStepRow(context, steps[i], i, count, colors, textTheme),
        ],
      ],
    );
  }

  Widget _buildStepRow(
    BuildContext context,
    PlanStep step,
    int index,
    int count,
    ColorScheme colors,
    TextTheme textTheme,
  ) {
    final isFirst = index == 0;
    final isSingle = count == 1;
    final isLast = index == count - 1;

    final radius = isSingle
        ? const BorderRadius.all(UxnanRadius.md)
        : isFirst
            ? const BorderRadius.only(
                topLeft: UxnanRadius.md,
                topRight: UxnanRadius.md,
                bottomLeft: UxnanRadius.sm,
                bottomRight: UxnanRadius.sm,
              )
            : isLast
                ? const BorderRadius.only(
                    topLeft: UxnanRadius.sm,
                    topRight: UxnanRadius.sm,
                    bottomLeft: UxnanRadius.md,
                    bottomRight: UxnanRadius.md,
                  )
                : const BorderRadius.all(UxnanRadius.sm);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh.withValues(alpha: 0.5),
        borderRadius: radius,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.sm,
          vertical: UxnanSpacing.sm,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _PlanStepIcon(status: step.status),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Text(
                step.description,
                style: step.status == PlanStepStatus.completed
                    ? textTheme.bodyMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                        decoration: TextDecoration.lineThrough,
                      )
                    : textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlanStepIcon extends StatelessWidget {
  const _PlanStepIcon({required this.status});
  final PlanStepStatus status;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = switch (status) {
      PlanStepStatus.pending => (
          UxIcons.radioButtonUnchecked,
          Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      PlanStepStatus.inProgress => (
          UxIcons.autorenew,
          UxnanColors.connecting,
        ),
      PlanStepStatus.completed => (
          UxIcons.checkCircle,
          UxnanColors.success,
        ),
    };
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: UxIcon(icon, size: 16, color: color),
    );
  }
}

/// Renders a [SubagentContent]: the subagent name/status and its actions.
/// Collapsed by default — shows the header (name + status + action count +
/// chevron). Tap to expand and see all actions the subagent performed.
class _SubagentCard extends StatefulWidget {
  const _SubagentCard({required this.content});
  final SubagentContent content;

  @override
  State<_SubagentCard> createState() => _SubagentCardState();
}

class _SubagentCardState extends State<_SubagentCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final state = widget.content.state;
    final actions = state.actions;
    final report = state.output;
    final hasReport = report != null && report.isNotEmpty;
    final hasActions = actions.isNotEmpty;
    final expandable = hasActions || hasReport;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.all(UxnanSpacing.md),
              child: Row(
                children: [
                  UxIcon(
                    UxIcons.accountTree,
                    size: 16,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(
                    child: Text(
                      state.name.isEmpty ? 'Subagent' : state.name,
                      style: textTheme.labelMedium,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (state.status != null && state.status!.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.only(right: 4),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: colors.tertiaryContainer,
                        borderRadius: const BorderRadius.all(UxnanRadius.full),
                      ),
                      child: Text(
                        state.status!,
                        style: textTheme.labelSmall?.copyWith(
                          color: colors.onTertiaryContainer,
                          fontSize: 10,
                        ),
                      ),
                    ),
                  if (hasActions) _CountBadge(count: actions.length),
                  const SizedBox(width: 2),
                  UxIcon(
                    _expanded ? UxIcons.expandLess : UxIcons.expandMore,
                    size: 18,
                    color: colors.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: expandable && _expanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(
                      UxnanSpacing.md,
                      0,
                      UxnanSpacing.md,
                      UxnanSpacing.md,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        for (final action in actions)
                          _SubagentActionRow(action: action),
                        if (hasReport)
                          Text(
                            report,
                            style: textTheme.bodySmall?.copyWith(
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                      ],
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

/// A single action row inside a collapsed/expanded [_SubagentCard].
class _SubagentActionRow extends StatelessWidget {
  const _SubagentActionRow({required this.action});
  final SubagentAction action;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: UxIcon(
              _subagentActionIcon(action.kind),
              size: 15,
              color: colors.onSurfaceVariant,
            ),
          ),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(
            child: Text(action.label, style: textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}

UxIconData _subagentActionIcon(SubagentActionKind kind) => switch (kind) {
      SubagentActionKind.tool => UxIcons.build,
      SubagentActionKind.edit => UxIcons.edit,
      SubagentActionKind.command => UxIcons.terminal,
      SubagentActionKind.message => UxIcons.chatBubble,
      SubagentActionKind.unknown => UxIcons.bolt,
    };

class _TextBlock extends StatelessWidget {
  const _TextBlock({
    required this.content,
    this.selectable = true,
    this.onTapLink,
  });
  final TextContent content;
  final bool selectable;
  final ValueChanged<String>? onTapLink;

  @override
  Widget build(BuildContext context) {
    final body = MarkdownBody(
      data: content.text.isEmpty ? '…' : content.text,
      // Never per-paragraph: a selectable MarkdownBody makes every paragraph,
      // list item and heading its own `SelectableText` — a full text editor
      // each. Opening a conversation built over a hundred of them in one frame
      // (measured ~80 ms on a mid-range phone). One selection area over plain
      // paragraphs selects the same text, across paragraphs too.
      styleSheet: uxnanMarkdownStyleSheet(context),
      inlineSyntaxes: onTapLink == null
          ? null
          : [WorkspaceCodePathSyntax(), WorkspacePathSyntax()],
      onTapLink: (_, href, __) {
        if (href != null && href.isNotEmpty) onTapLink?.call(href);
      },
    );
    return selectable ? SelectionArea(child: body) : body;
  }
}

class _CodeBlock extends StatelessWidget {
  const _CodeBlock({required this.content});
  final CodeContent content;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final label = content.filename ?? content.language ?? 'code';

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              UxnanSpacing.md,
              UxnanSpacing.xs,
              UxnanSpacing.xs,
              UxnanSpacing.xs,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(label, style: UxnanTypography.codeSmall),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  tooltip: 'Copy',
                  icon: const UxIcon(UxIcons.copy, size: 16),
                  onPressed: () =>
                      Clipboard.setData(ClipboardData(text: content.code)),
                ),
              ],
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: HighlightView(
              content.code,
              language: content.language ?? 'plaintext',
              theme: isDark ? atomOneDarkTheme : atomOneLightTheme,
              padding: const EdgeInsets.all(UxnanSpacing.md),
              textStyle: UxnanTypography.codeBody,
            ),
          ),
        ],
      ),
    );
  }
}

class _CommandCard extends StatelessWidget {
  const _CommandCard({required this.content});
  final CommandExecutionContent content;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final (icon, color) = switch (content.status) {
      CommandStatus.running => (
          UxIcons.autorenew,
          UxnanColors.connecting,
        ),
      CommandStatus.completed => (
          UxIcons.checkCircle,
          UxnanColors.success,
        ),
      CommandStatus.error => (UxIcons.error, UxnanColors.error),
    };

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                UxIcon(icon, size: 16, color: color),
                const SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: Text(
                    content.command,
                    style: UxnanTypography.codeBody,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            if (content.output != null && content.output!.isNotEmpty) ...[
              const SizedBox(height: UxnanSpacing.sm),
              // Its last lines only: the card is a glance, never the whole
              // output (that is the work log's, and the detail screen's).
              Text(
                _lastLines(content.output!, _cardOutputLines),
                style: UxnanTypography.codeSmall,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SystemBanner extends StatelessWidget {
  const _SystemBanner({required this.content});
  final SystemContent content;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final (icon, color) = switch (content.kind) {
      SystemContentKind.info => (UxIcons.info, UxnanColors.gitUntracked),
      SystemContentKind.warning => (UxIcons.warningAmber, UxnanColors.warning),
      SystemContentKind.error => (UxIcons.error, UxnanColors.error),
      SystemContentKind.debug => (UxIcons.bugReport, colors.onSurfaceVariant),
    };
    // A failed turn may carry no error text from the bridge; show a localized
    // fallback so the banner is never blank.
    final text = content.text.isNotEmpty
        ? content.text
        : (content.kind == SystemContentKind.error
            ? AppLocalizations.of(context).turnFailed
            : content.text);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        UxIcon(icon, size: 16, color: color),
        const SizedBox(width: UxnanSpacing.sm),
        Expanded(
          child: Text(
            text,
            style: textTheme.bodySmall?.copyWith(color: color),
          ),
        ),
      ],
    );
  }
}

/// How many lines of output a standalone command card shows.
const int _cardOutputLines = 12;

/// How many lines of a diff a standalone diff card shows.
const int _cardDiffLines = 12;

/// The last [count] lines of [text].
String _lastLines(String text, int count) {
  final lines = text.split('\n');
  return lines.length <= count
      ? text
      : lines.sublist(lines.length - count).join('\n');
}

/// A diff outside an assistant turn's changed-files list: its file, its
/// counts and the first lines of its body — never the whole of it.
class _DiffBlock extends StatelessWidget {
  const _DiffBlock({required this.content});
  final DiffContent content;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(UxnanSpacing.sm),
            child: Row(
              children: [
                const UxIcon(UxIcons.difference, size: 16),
                const SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: Text(
                    content.filename,
                    style: UxnanTypography.codeSmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                _DiffCounts(
                  additions: content.additions,
                  deletions: content.deletions,
                ),
              ],
            ),
          ),
          if (content.hasBody) _DiffLines(diff: content.diff),
        ],
      ),
    );
  }
}

/// The first [_cardDiffLines] colored lines of a unified diff, and how many
/// more there are.
class _DiffLines extends StatelessWidget {
  const _DiffLines({required this.diff});
  final String diff;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final lines = diff.split('\n');
    final shown = lines.take(_cardDiffLines).toList();
    final more = lines.length - shown.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final line in shown)
          ColoredBox(
            color: _diffLineColor(line),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: UxnanSpacing.sm,
                vertical: 1,
              ),
              child: Text(
                line,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: UxnanTypography.codeSmall,
              ),
            ),
          ),
        if (more > 0)
          Padding(
            padding: const EdgeInsets.all(UxnanSpacing.sm),
            child: Text(
              AppLocalizations.of(context).conversationDiffMoreLines(more),
              style: UxnanTypography.codeSmall.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
      ],
    );
  }
}

/// A compact `+a −d` counter, additions in green and deletions in red.
class _DiffCounts extends StatelessWidget {
  const _DiffCounts({required this.additions, required this.deletions});
  final int additions;
  final int deletions;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '+$additions',
          style: UxnanTypography.codeSmall.copyWith(
            color: UxnanColors.gitAdded,
          ),
        ),
        const SizedBox(width: UxnanSpacing.xs),
        Text(
          '−$deletions',
          style:
              UxnanTypography.codeSmall.copyWith(color: UxnanColors.gitDeleted),
        ),
      ],
    );
  }
}

Color _diffLineColor(String line) {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return UxnanColors.gitAdded.withValues(alpha: 0.12);
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return UxnanColors.gitDeleted.withValues(alpha: 0.12);
  }
  return Colors.transparent;
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({required this.icon, required this.label});
  final UxIconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.md),
        child: Row(
          children: [
            UxIcon(icon, size: 18, color: colors.onSurfaceVariant),
            const SizedBox(width: UxnanSpacing.sm),
            Flexible(
              child: Text(
                label,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Renders a full assistant turn **without a bubble** (full-width), the way the
/// agent's narration reads in the design references: a collapsible **Work log**
/// of the commands/tools it ran, the prose answer (consecutive text merged into
/// one selectable block, other blocks as their own cards), a collapsible
/// **Changed files** summary at the end, and a "Copy response" action. Only
/// user messages get a bubble.
class AssistantTurnView extends ConsumerStatefulWidget {
  /// Creates an [AssistantTurnView] for an assistant [message].
  const AssistantTurnView({
    required this.message,
    this.running = false,
    this.onTapLink,
    super.key,
  });

  /// The assistant message to render.
  final Message message;

  /// Whether its turn is the one running now (see [MessageBubble.running]).
  final bool running;

  /// Handles links in every visible response group, including streaming text.
  final ValueChanged<String>? onTapLink;

  @override
  ConsumerState<AssistantTurnView> createState() => _AssistantTurnViewState();
}

class _AssistantTurnViewState extends ConsumerState<AssistantTurnView> {
  String? _expandedProcess;
  bool _previousResponsesExpanded = false;

  void _toggleProcess(String id) {
    setState(() => _expandedProcess = _expandedProcess == id ? null : id);
  }

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final showThinking = ref.watch(showAgentThinkingProvider);
    // What the turn changed: its edits and the summarized runs with any.
    final changes = <MessageContent>[];
    final prose = StringBuffer();
    final contents = <MessageContent>[];

    // The answer in the order the agent produced it. Reasoning and diffs are
    // lifted to their own sections; blank text runs disappear, and the
    // zero-text boundaries between the agent's own responses only tell
    // [splitAnswer] where its last response began. An agent resends its whole
    // to-do list on every change: each earlier plan is a past state of the
    // latest one, which alone is shown.
    final lastPlan = message.contents.whereType<PlanContent>().lastOrNull;
    for (final content in message.contents) {
      switch (content) {
        case final PlanContent plan when !identical(plan, lastPlan):
          continue;
        // A thought is a step of the work log, where it happened — unless the
        // reader chose not to see the agent's reasoning.
        case ThinkingContent() when !showThinking:
          continue;
        case final DiffContent diff:
          changes.add(diff);
        // A run's edits are listed with the changed files; a run that only
        // edited has nothing for the work log, and leaves the prose around it
        // as one, the way an edit always has.
        case final WorkRunContent run:
          if (run.files.isNotEmpty) changes.add(run);
          final listed = run.logSteps - (showThinking ? 0 : run.thoughts);
          if (listed > 0) contents.add(run);
        case final AssistantResponseBoundaryContent boundary:
          contents.add(boundary);
        case final TextContent text:
          // A streaming run stays even while still empty: it is where the
          // answer appears.
          if (text.text.trim().isEmpty && !text.isStreaming) continue;
          contents.add(text);
          if (text.text.isNotEmpty) {
            if (prose.isNotEmpty) prose.write('\n\n');
            prose.write(text.text);
          }
        default:
          contents.add(content);
      }
    }
    // While the turn runs everything is in view. Once it settles, the work
    // that led to the answer folds behind one line ("Worked for 5m 52s") and
    // the closing answer stays open, with the views the agent showed — the
    // desktop's `splitAnswer`, the same rule on both clients. A reply a later
    // message cut ([Message.continuedIn]) is not settled in that sense: it is
    // the answer so far and stays as it streamed.
    final settled =
        !widget.running && !message.isStreaming && message.continuedIn == null;
    final split = settled
        ? splitAnswer(contents)
        : (
            work: const <MessageContent>[],
            answer: [
              for (final c in contents)
                if (c is! AssistantResponseBoundaryContent) c,
            ],
          );
    final visibleContents = split.answer;
    // The folded work and the visible answer are laid out by the same builder
    // ([_responseSegments]), so the work opens exactly as it read while the
    // turn ran: prose, and collapsed work-log groups that each open alone.
    final segments = <Widget>[
      if (split.work.isNotEmpty)
        _PreviousResponsesSection(
          label: _foldLabel(
            AppLocalizations.of(context),
            message.turnDuration,
          ),
          expanded: _previousResponsesExpanded,
          onToggle: () => setState(
            () => _previousResponsesExpanded = !_previousResponsesExpanded,
          ),
          body: _previousResponsesExpanded
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: _responseSegments(
                    contents: split.work,
                    threadId: message.threadId,
                    turnId: message.turnId,
                    onTapLink: widget.onTapLink,
                    processPrefix: 'previous-',
                    expandedProcess: _expandedProcess,
                    onToggleProcess: _toggleProcess,
                  ),
                )
              : null,
        ),
    ];
    final answer = _responseSegments(
      contents: visibleContents,
      threadId: message.threadId,
      turnId: message.turnId,
      onTapLink: widget.onTapLink,
      processPrefix: '',
      expandedProcess: _expandedProcess,
      onToggleProcess: _toggleProcess,
    );
    if (segments.isNotEmpty && answer.isNotEmpty) {
      segments.add(const SizedBox(height: UxnanSpacing.sm));
    }
    segments.addAll(answer);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (message.isStreaming && prose.isEmpty) ...[
            _AgentRespondingStatus(
              label: AppLocalizations.of(context).conversationAgentResponding,
            ),
            const SizedBox(height: UxnanSpacing.sm),
          ],
          ...segments,
          if (changes.isNotEmpty) ...[
            const SizedBox(height: UxnanSpacing.sm),
            _ChangedFilesSection(
              files: changedFilesOf(changes),
              threadId: message.threadId,
              turnId: message.turnId,
            ),
          ],
          if (prose.isNotEmpty && !message.isStreaming) ...[
            const SizedBox(height: UxnanSpacing.xs),
            _ResponseActions(text: prose.toString()),
          ],
        ],
      ),
    );
  }
}

/// The fold's label: how long the turn worked ("Worked for 5m 52s") when the
/// bridge reported when it ended ([Message.turnDuration]), else "Show the
/// work" — the desktop's labels.
String _foldLabel(AppLocalizations l10n, Duration? worked) => worked == null
    ? l10n.conversationShowWork
    : l10n.conversationWorkedFor(formatElapsed(worked));

/// Splits a settled turn's [items] into the work that led to the answer and
/// the answer itself: the text after the last block — or of the agent's last
/// response, when it answered in several (Codex's commentary, then its final
/// answer; [AssistantResponseBoundaryContent] closes each) — with any notices
/// that follow it. A turn with no blocks, in one response, is all answer;
/// notices alone are not an answer, so they stay after the work. Boundaries
/// are metadata: neither half carries them.
///
/// A view the agent showed is part of the answer, never of the work: it is
/// what the person asked to see, and folded behind "Worked for…" only someone
/// who knew it was there would find it. Views leave the work, in the order the
/// agent showed them, and open the answer.
///
/// The same rule as the desktop's `splitAnswer` (`uxnandesktop/src/lib/bridge/
/// timeline.ts`); a change to one is a change to both.
@visibleForTesting
({List<MessageContent> work, List<MessageContent> answer}) splitAnswer(
  List<MessageContent> items,
) {
  bool boundary(MessageContent c) => c is AssistantResponseBoundaryContent;
  bool closing(MessageContent c) =>
      c is TextContent || c is SystemContent || boundary(c);
  var cut = items.length;
  while (cut > 0 && closing(items[cut - 1])) {
    cut -= 1;
    // The last response began after this boundary: what came before it is
    // the work toward it — unless no text of that response followed yet.
    if (boundary(items[cut]) &&
        items.skip(cut + 1).any((c) => c is TextContent)) {
      cut += 1;
      break;
    }
  }
  if (!items.skip(cut).any((c) => c is TextContent)) cut = items.length;
  final work = items.take(cut);
  return (
    work: [
      for (final c in work)
        if (c is! ViewContent && !boundary(c)) c,
    ],
    answer: [
      ...work.whereType<ViewContent>(),
      for (final c in items.skip(cut))
        if (!boundary(c)) c,
    ],
  );
}

/// Lays out one run of response content the way the reader sees an answer:
/// work-log groups and prose/other blocks IN THE ORDER the agent produced
/// them, so a work log sits just above the response it precedes and
/// interleaved responses don't collapse into one block. Consecutive commands,
/// tool calls and summarized runs ([WorkRunContent]) become one collapsed
/// [_WorkLogSection] — so a run a re-sync summarized mid-turn and the steps
/// that streamed after it read as one log; consecutive text merges into one
/// selectable block.
///
/// The one builder for both the visible answer and the earlier responses the
/// fold holds. Thoughts are work-log steps like commands; diffs never reach
/// it: the turn lifts them to its changed-files summary first.
///
/// Every work-log group is addressed by [processPrefix] + its index, so each
/// opens and closes on its own through the turn's [expandedProcess].
List<Widget> _responseSegments({
  required Iterable<MessageContent> contents,
  required String threadId,
  required String turnId,
  required ValueChanged<String>? onTapLink,
  required String processPrefix,
  required String? expandedProcess,
  required ValueChanged<String> onToggleProcess,
}) {
  final segments = <Widget>[];
  final pendingCommands = <MessageContent>[];
  final pendingText = StringBuffer();
  var pendingTextIsStreaming = false;
  var workLogIndex = 0;

  void gap() {
    if (segments.isNotEmpty) {
      segments.add(const SizedBox(height: UxnanSpacing.sm));
    }
  }

  void flushText() {
    if (pendingText.isEmpty) return;
    final text = pendingText.toString();
    pendingText.clear();
    gap();
    segments.add(
      pendingTextIsStreaming
          ? _StreamingProse(text: text, onTapLink: onTapLink)
          : MessageContentView(
              content: TextContent(text),
              onTapLink: onTapLink,
            ),
    );
    pendingTextIsStreaming = false;
  }

  void flushCommands() {
    if (pendingCommands.isEmpty) return;
    final items = List<MessageContent>.of(pendingCommands);
    pendingCommands.clear();
    final processId = '${processPrefix}work-${workLogIndex++}';
    gap();
    segments.add(
      _WorkLogSection(
        items: items,
        threadId: threadId,
        turnId: turnId,
        expanded: expandedProcess == processId,
        onToggle: () => onToggleProcess(processId),
      ),
    );
  }

  for (final content in contents) {
    switch (content) {
      case CommandExecutionContent() ||
            ToolUseContent() ||
            ThinkingContent() ||
            WorkRunContent():
        flushText();
        pendingCommands.add(content);
      case final TextContent text:
        flushCommands();
        if (text.text.isNotEmpty) {
          if (pendingText.isNotEmpty) pendingText.write('\n\n');
          pendingText.write(text.text);
        }
        pendingTextIsStreaming = text.isStreaming;
      default:
        flushCommands();
        flushText();
        gap();
        segments.add(
          MessageContentView(
            content: content,
            threadId: threadId,
            onTapLink: onTapLink,
          ),
        );
    }
  }
  flushCommands();
  flushText();
  return segments;
}

/// Folds the work that preceded the final answer of a settled turn behind one
/// quiet line ("Worked for 5m 52s"). Nothing is summarized or discarded:
/// [body] lays the work out the way it read while the turn ran, against a
/// hairline rule on the left.
class _PreviousResponsesSection extends StatelessWidget {
  const _PreviousResponsesSection({
    required this.label,
    required this.expanded,
    required this.onToggle,
    required this.body,
  });

  final String label;
  final bool expanded;
  final VoidCallback onToggle;

  /// The folded work; built only while [expanded].
  final Widget? body;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final duration = UxnanMotion.revealIn(context);
    final body = this.body;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          container: true,
          button: true,
          expanded: expanded,
          label: label,
          child: InkWell(
            key: const ValueKey('previous-responses-toggle'),
            onTap: onToggle,
            borderRadius: const BorderRadius.all(UxnanRadius.full),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
              child: Row(
                children: [
                  Expanded(child: Divider(color: colors.outlineVariant)),
                  const SizedBox(width: UxnanSpacing.sm),
                  ExcludeSemantics(
                    child: Text(
                      label,
                      style: textTheme.labelMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: UxnanSpacing.xs),
                  AnimatedRotation(
                    turns: expanded ? 0.5 : 0,
                    duration: duration,
                    child: UxIcon(
                      UxIcons.expandMore,
                      size: 18,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Expanded(child: Divider(color: colors.outlineVariant)),
                ],
              ),
            ),
          ),
        ),
        AnimatedSize(
          duration: duration,
          curve: UxnanMotion.revealCurve,
          alignment: Alignment.topCenter,
          child: expanded && body != null
              ? Padding(
                  padding: const EdgeInsets.only(top: UxnanSpacing.sm),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      border: Border(
                        left: BorderSide(color: colors.outlineVariant),
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.only(left: UxnanSpacing.md),
                      child: body,
                    ),
                  ),
                )
              : const SizedBox.shrink(),
        ),
      ],
    );
  }
}

/// A quiet in-flow activity cue at the beginning of the live assistant turn.
/// It stays with the response instead of competing with composer context and
/// token meters in the fixed bottom chrome.
class _AgentRespondingStatus extends StatelessWidget {
  const _AgentRespondingStatus({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        PolygonLoader(size: 14, color: colors.onSurfaceVariant),
        const SizedBox(width: UxnanSpacing.sm),
        _SkeletonText(
          label,
          key: const ValueKey('agent-responding-status'),
          style: textTheme.labelMedium?.copyWith(
            color: colors.onSurfaceVariant,
            fontStyle: FontStyle.italic,
          ),
        ),
      ],
    );
  }
}

/// Renders partial prose through the same Markdown path as the settled answer.
///
/// Keeping one renderer for both states prevents completed Markdown syntax from
/// flashing as source text until the turn finishes. The loader remains beside
/// the live block without becoming part of the selectable response.
///
/// **Only the part still being written is rebuilt.** Rendering the whole
/// accumulated reply on every delta made a turn cost time quadratic in its own
/// length: measured on a real device in a profile build, a reply under 4 500
/// characters cost 5.4 ms per frame at p95 and dropped 4 janky frames out of
/// 2 761, while past that it cost 28.1 ms and dropped 97 out of 1 381 — one
/// frame in fourteen, which is what reads as the answer stalling. So the prose
/// is cut at boundaries that can never move again (see
/// [splitStreamingMarkdown]) and each finished chunk keeps its widget instance;
/// Flutter skips an identical widget without rebuilding or re-laying it out.
class _StreamingProse extends StatefulWidget {
  const _StreamingProse({required this.text, required this.onTapLink});

  final String text;
  final ValueChanged<String>? onTapLink;

  @override
  State<_StreamingProse> createState() => _StreamingProseState();
}

class _StreamingProseState extends State<_StreamingProse> {
  /// The chunk text behind each cached widget, so an unchanged chunk is
  /// recognized without rebuilding it.
  List<String> _chunks = const <String>[];
  final List<Widget> _rendered = <Widget>[];

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(_StreamingProse oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.text != widget.text ||
        oldWidget.onTapLink != widget.onTapLink) {
      _sync();
    }
  }

  /// Rebuilds only the chunks whose text actually changed — in practice the
  /// last one, since a settled chunk is by construction final.
  void _sync() {
    final next = splitStreamingMarkdown(widget.text);
    for (var i = 0; i < next.length; i += 1) {
      final unchanged =
          i < _chunks.length && i < _rendered.length && _chunks[i] == next[i];
      if (unchanged) continue;
      final block = _TextBlock(
        content: TextContent(next[i]),
        onTapLink: widget.onTapLink,
      );
      if (i < _rendered.length) {
        _rendered[i] = block;
      } else {
        _rendered.add(block);
      }
    }
    if (_rendered.length > next.length) {
      _rendered.removeRange(next.length, _rendered.length);
    }
    _chunks = next;
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Flexible(
          // One Markdown body per chunk. Separate bodies have no gap between
          // them, so the renderer's own block spacing is put back here —
          // without it the answer visibly tightens as it is cut (32 px over
          // three paragraphs, caught by the pixel comparison in
          // `streaming_markdown_fidelity_test.dart`).
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              for (var i = 0; i < _rendered.length; i += 1) ...[
                if (i > 0) SizedBox(height: uxnanMarkdownBlockSpacing(context)),
                _rendered[i],
              ],
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(
            left: UxnanSpacing.xs,
          ),
          child: PolygonLoader(
            size: 14,
            color: colors.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// A quiet shimmer across the waiting label before the first response token.
class _SkeletonText extends StatefulWidget {
  const _SkeletonText(this.text, {required this.style, super.key});

  final String text;
  final TextStyle? style;

  @override
  State<_SkeletonText> createState() => _SkeletonTextState();
}

class _SkeletonTextState extends State<_SkeletonText>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    final text = Text(widget.text, style: widget.style);
    if (reduceMotion) return text;

    return RepaintBoundary(
      child: AnimatedBuilder(
        animation: _controller,
        child: text,
        builder: (context, child) => ShaderMask(
          blendMode: BlendMode.srcIn,
          shaderCallback: (bounds) => LinearGradient(
            begin: Alignment(-2 + (_controller.value * 4), 0),
            end: Alignment(-1 + (_controller.value * 4), 0),
            colors: [
              colors.onSurfaceVariant.withValues(alpha: 0.42),
              colors.onSurfaceVariant,
              colors.onSurfaceVariant.withValues(alpha: 0.42),
            ],
          ).createShader(bounds),
          child: child,
        ),
      ),
    );
  }
}

/// A left-aligned "Copy response" action under an assistant turn.
class _ResponseActions extends StatelessWidget {
  const _ResponseActions({required this.text});

  /// The prose to copy (the agent's textual answer).
  final String text;

  void _copy(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    unawaited(Clipboard.setData(ClipboardData(text: text)));
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(l10n.conversationResponseCopied)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: TextButton.icon(
        onPressed: () => _copy(context),
        icon: const UxIcon(UxIcons.copy, size: 16),
        label: Text(l10n.conversationCopyResponse),
        style: TextButton.styleFrom(
          foregroundColor: colors.onSurfaceVariant,
          visualDensity: VisualDensity.compact,
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.sm,
            vertical: UxnanSpacing.xs,
          ),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
      ),
    );
  }
}

/// A quiet text action that opens something whole on its own screen.
class _DetailLink extends StatelessWidget {
  const _DetailLink({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: TextButton.icon(
        onPressed: onTap,
        icon: const UxIcon(UxIcons.openInNew, size: 16),
        label: Text(label),
        style: TextButton.styleFrom(
          visualDensity: VisualDensity.compact,
          padding: const EdgeInsets.symmetric(horizontal: UxnanSpacing.sm),
        ),
      ),
    );
  }
}

/// A compact work-log disclosure. Collapsed state keeps only the count and the
/// latest activity summary visible; expansion reveals every command/tool and
/// its available output.
///
/// Its [items] are the steps the reply holds one by one (a live turn's
/// previews, or steps stored before the bridge summarized them) and the
/// summarized runs ([WorkRunContent]) whose steps are read from the bridge
/// when the log opens — never before.
class _WorkLogSection extends ConsumerWidget {
  const _WorkLogSection({
    required this.items,
    required this.threadId,
    required this.turnId,
    required this.expanded,
    required this.onToggle,
  });

  /// The [CommandExecutionContent] / [ToolUseContent] / [WorkRunContent]
  /// entries of one group.
  final List<MessageContent> items;
  final String threadId;
  final String turnId;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final showThinking = ref.watch(showAgentThinkingProvider);
    var count = 0;
    for (final item in items) {
      count += item is WorkRunContent
          ? item.logSteps - (showThinking ? 0 : item.thoughts)
          : 1;
    }
    return _AgentProcessDisclosure(
      icon: UxIcons.terminal,
      title: l10n.conversationWorkLog,
      count: count,
      collapsedSummary: _workLogSummary(l10n, items.last),
      expanded: expanded,
      onToggle: onToggle,
      // Built only while open: a closed log asks the bridge for nothing.
      child: expanded
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final item in items)
                  if (item is WorkRunContent)
                    _WorkRunSteps(run: item, threadId: threadId, turnId: turnId)
                  else
                    _WorkLogRow(item: item, threadId: threadId, turnId: turnId),
              ],
            )
          : const SizedBox.shrink(),
    );
  }
}

/// The one line a collapsed work log shows for its latest entry: the command
/// or the tool call — or, when a summarized run ended on an edit, the file it
/// edited.
String _workLogSummary(AppLocalizations l10n, MessageContent item) =>
    switch (item) {
      final CommandExecutionContent command => '\$ ${command.command}',
      final ToolUseContent tool => _toolLabel(l10n, tool),
      final DiffContent diff =>
        l10n.conversationEditedFile(diff.filename.split('/').last),
      final ThinkingContent thought => thought.isStreaming
          ? '${l10n.conversationThinking}…'
          : collapsePreviewText(thought.text),
      WorkRunContent(:final last?) => _workLogSummary(l10n, last),
      final WorkRunContent run => _workRunCounts(l10n, run),
      _ => '',
    };

/// What a summarized run amounts to: "12 commands · 3 tool calls · 2
/// thoughts · 1 failed".
String _workRunCounts(AppLocalizations l10n, WorkRunContent run) => [
      if (run.commands > 0) l10n.conversationWorkCommands(run.commands),
      if (run.tools > 0) l10n.conversationWorkTools(run.tools),
      if (run.thoughts > 0) l10n.conversationWorkThoughts(run.thoughts),
      if (run.failed > 0) l10n.conversationWorkFailed(run.failed),
    ].join(' · ');

/// What a tool call did, the same way for every agent: "Read notes.txt",
/// "Searched alpha"; an unclassified tool by its own name.
String _toolLabel(AppLocalizations l10n, ToolUseContent tool) {
  final verb = switch (tool.kind) {
    ToolKind.read => l10n.conversationToolRead,
    ToolKind.search => l10n.conversationToolSearched,
    ToolKind.list => l10n.conversationToolListed,
    ToolKind.fetch => l10n.conversationToolFetched,
    ToolKind.webSearch => l10n.conversationToolSearchedWeb,
    ToolKind.mcp || ToolKind.other => tool.toolName.isEmpty
        ? 'tool'
        : tool.toolName
            .replaceFirst(RegExp('^mcp__'), '')
            .replaceAll('__', ' · '),
  };
  final target = tool.target;
  return target == null || target.isEmpty ? verb : '$verb $target';
}

/// Shared low-emphasis Neural Expressive disclosure for secondary agent
/// process information. It morphs from a compact pill into a rounded tonal
/// panel, has no outline, and respects the platform's reduced-motion setting.
class _AgentProcessDisclosure extends StatelessWidget {
  const _AgentProcessDisclosure({
    required this.icon,
    required this.title,
    required this.expanded,
    required this.onToggle,
    required this.child,
    this.count,
    this.collapsedSummary,
  });

  final UxIconData icon;
  final String title;
  final int? count;
  final String? collapsedSummary;
  final bool expanded;
  final VoidCallback onToggle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final duration =
        reduceMotion ? Duration.zero : const Duration(milliseconds: 220);
    final summary = collapsedSummary;

    return Material(
      color: colors.surfaceContainerLow,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(
          expanded ? UxnanRadius.lg : UxnanRadius.full,
        ),
      ),
      animationDuration: duration,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: onToggle,
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minHeight: UxnanSpacing.xxxl,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.md,
                  vertical: UxnanSpacing.sm,
                ),
                child: Row(
                  children: [
                    UxIcon(icon, size: 16, color: colors.onSurfaceVariant),
                    const SizedBox(width: UxnanSpacing.sm),
                    Text(
                      title,
                      style: textTheme.labelMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    if (count != null) ...[
                      const SizedBox(width: UxnanSpacing.xs),
                      _CountBadge(count: count!),
                    ],
                    if (!expanded && summary != null && summary.isNotEmpty) ...[
                      const SizedBox(width: UxnanSpacing.sm),
                      Expanded(
                        child: Text(
                          summary,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: UxnanTypography.codeSmall.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ] else
                      const Spacer(),
                    const SizedBox(width: UxnanSpacing.xs),
                    UxIcon(
                      expanded ? UxIcons.expandLess : UxIcons.expandMore,
                      size: 18,
                      color: colors.onSurfaceVariant,
                    ),
                  ],
                ),
              ),
            ),
          ),
          AnimatedSize(
            duration: duration,
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: expanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(
                      UxnanSpacing.md,
                      0,
                      UxnanSpacing.md,
                      UxnanSpacing.md,
                    ),
                    child: child,
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}

/// The steps of one summarized run, read from the bridge (`turn/steps`) when
/// its work log opens, a page at a time — the first page right away, the
/// rest on request. Edits are skipped: they are listed with the changed
/// files. Offline, the run says what it amounts to and that its steps load
/// once the computer is connected — which they then do on their own.
class _WorkRunSteps extends ConsumerStatefulWidget {
  const _WorkRunSteps({
    required this.run,
    required this.threadId,
    required this.turnId,
  });

  final WorkRunContent run;
  final String threadId;
  final String turnId;

  @override
  ConsumerState<_WorkRunSteps> createState() => _WorkRunStepsState();
}

class _WorkRunStepsState extends ConsumerState<_WorkRunSteps> {
  final List<MessageContent> _steps = [];

  /// Where the next page starts; null once the run is read to its end.
  int? _next;
  bool _loaded = false;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_loadMore());
    });
  }

  @override
  void didUpdateWidget(covariant _WorkRunSteps oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A run still running changes as its steps settle: read it again. A
    // thought growing at its end changes only its preview, not its steps.
    if (!_sameSteps(oldWidget.run, widget.run)) {
      _steps.clear();
      _next = null;
      _loaded = false;
      _error = null;
      unawaited(_loadMore());
    }
  }

  bool get _connected =>
      ref.read(connectionPhaseProvider).value == ConnectionPhase.connected;

  static bool _sameSteps(WorkRunContent a, WorkRunContent b) =>
      a.from == b.from &&
      a.to == b.to &&
      a.commands == b.commands &&
      a.edits == b.edits &&
      a.tools == b.tools &&
      a.thoughts == b.thoughts &&
      a.failed == b.failed &&
      a.running == b.running;

  Future<void> _loadMore() async {
    if (_loading || (_loaded && _next == null) || !_connected) return;
    final run = widget.run;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(turnDetailRepositoryProvider).readSteps(
            widget.threadId,
            widget.turnId,
            from: _next ?? run.from,
            to: run.to,
            fresh: run.running > 0,
          );
      if (!mounted || !_sameSteps(run, widget.run)) return;
      setState(() {
        _steps.addAll(page.steps);
        _next = page.next;
        _loaded = true;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted || !_sameSteps(run, widget.run)) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    ref.listen(connectionPhaseProvider, (previous, next) {
      if (next.value == ConnectionPhase.connected && !_loaded) {
        unawaited(_loadMore());
      }
    });
    final connected =
        ref.watch(connectionPhaseProvider).value == ConnectionPhase.connected;
    final error = _error;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final step in _steps)
          if (step is! DiffContent &&
              (step is! ThinkingContent ||
                  ref.watch(showAgentThinkingProvider)))
            _WorkLogRow(
              item: step,
              threadId: widget.threadId,
              turnId: widget.turnId,
            ),
        if (_loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
            child: Center(child: PolygonLoader(size: 20)),
          )
        else if (error != null)
          _WorkLogNotice(
            icon: UxIcons.error,
            text: error is RpcException &&
                    error.code == RpcException.responseTooLarge
                ? l10n.turnDetailTooLarge
                : l10n.conversationWorkLogLoadFailed,
            action: connected
                ? TextButton(
                    onPressed: _loadMore,
                    child: Text(l10n.actionRetry),
                  )
                : null,
          )
        else if (!_loaded && !connected) ...[
          _WorkLogNotice(
            icon: UxIcons.terminal,
            text: _workRunCounts(l10n, widget.run),
          ),
          _WorkLogNotice(
            icon: UxIcons.cloudOff,
            text: l10n.conversationWorkLogOffline,
          ),
        ] else if (_next != null)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton(
              onPressed: connected ? _loadMore : null,
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
              ),
              child: Text(l10n.conversationWorkLogMore),
            ),
          ),
      ],
    );
  }
}

/// One quiet line inside an open work log: what it holds while its steps are
/// out of reach, or why they did not load.
class _WorkLogNotice extends StatelessWidget {
  const _WorkLogNotice({required this.icon, required this.text, this.action});

  final UxIconData icon;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
      child: Row(
        children: [
          UxIcon(icon, size: 14, color: colors.onSurfaceVariant),
          const SizedBox(width: UxnanSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
            ),
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}

/// One work-log entry, one line: a command or tool call. A command that
/// printed something opens on a tap to show its output — the same way a
/// *Changed files* row opens its diff — so finding one command never means
/// reading every other one's output. The collapsed disclosure uses
/// [_workLogSummary] instead.
///
/// What opens is a preview, bounded however large the output was: the end of
/// it, which is where a result lands. When the command or its output was cut
/// the whole of it opens on its own screen.
class _WorkLogRow extends StatefulWidget {
  const _WorkLogRow({
    required this.item,
    required this.threadId,
    required this.turnId,
  });
  final MessageContent item;
  final String threadId;
  final String turnId;

  @override
  State<_WorkLogRow> createState() => _WorkLogRowState();
}

class _WorkLogRowState extends State<_WorkLogRow> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final duration = UxnanMotion.revealIn(context);
    switch (widget.item) {
      case final CommandExecutionContent command:
        final (icon, color) = switch (command.status) {
          CommandStatus.running => (
              UxIcons.autorenew,
              UxnanColors.connecting,
            ),
          CommandStatus.completed => (
              UxIcons.checkCircle,
              UxnanColors.success,
            ),
          CommandStatus.error => (UxIcons.error, UxnanColors.error),
        };
        final output = command.output;
        final hasOutput = output != null && output.isNotEmpty;
        final opens = hasOutput || command.isCut;
        final outputChars = command.outputChars;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _WorkLogLine(
              icon: icon,
              iconColor: color,
              label: command.commandChars == null
                  ? '\$ ${command.command}'
                  : '\$ ${command.command}…',
              open: opens ? _open : null,
              onTap: opens ? () => setState(() => _open = !_open) : null,
            ),
            AnimatedSize(
              duration: duration,
              curve: UxnanMotion.revealCurve,
              alignment: Alignment.topCenter,
              child: _open && opens
                  ? Padding(
                      padding: const EdgeInsets.only(
                        left: UxnanSpacing.lg,
                        bottom: UxnanSpacing.xs,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (hasOutput && outputChars != null)
                            Padding(
                              padding: const EdgeInsets.only(
                                bottom: UxnanSpacing.xs,
                              ),
                              child: Text(
                                l10n.conversationStepOutputTail(
                                  output.length,
                                  outputChars,
                                ),
                                style: textTheme.labelSmall?.copyWith(
                                  color: colors.onSurfaceVariant,
                                ),
                              ),
                            ),
                          if (hasOutput)
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(UxnanSpacing.sm),
                              decoration: BoxDecoration(
                                color: colors.surfaceContainer,
                                borderRadius:
                                    const BorderRadius.all(UxnanRadius.md),
                              ),
                              child: SelectableText(
                                output,
                                style: UxnanTypography.codeSmall.copyWith(
                                  color: colors.onSurfaceVariant,
                                ),
                              ),
                            ),
                          if (command.isCut && command.index != null)
                            _DetailLink(
                              label: l10n.conversationStepFullOutput,
                              onTap: () => TurnDetailScreen.open(
                                context,
                                StepDetailRequest(
                                  threadId: widget.threadId,
                                  turnId: widget.turnId,
                                  step: command,
                                ),
                              ),
                            ),
                        ],
                      ),
                    )
                  : const SizedBox(width: double.infinity),
            ),
          ],
        );
      case final ThinkingContent thought:
        return _ThoughtRow(
          thought: thought,
          threadId: widget.threadId,
          turnId: widget.turnId,
        );
      case final ToolUseContent tool:
        return _WorkLogLine(
          icon: tool.running
              ? UxIcons.autorenew
              : tool.isError
                  ? UxIcons.error
                  : UxIcons.build,
          iconColor: tool.running
              ? UxnanColors.connecting
              : tool.isError
                  ? UxnanColors.error
                  : colors.onSurfaceVariant,
          label: _toolLabel(l10n, tool),
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

/// How tall an opened thought gets before it scrolls inside itself.
const double _thoughtMaxHeight = 240;

/// A stretch of the agent's reasoning as a work-log row, where it happened
/// among the commands. Collapsed it is one line: **Thinking** (shimmering)
/// while the agent is still writing it, else **Thought** and its own text
/// flattened to a line. Opened, its text is Markdown in a box that scrolls
/// past [_thoughtMaxHeight] — following the newest text while it streams,
/// until the reader scrolls up — and a thought the page cut opens whole on
/// its own screen (`turn/step`).
class _ThoughtRow extends StatefulWidget {
  const _ThoughtRow({required this.thought, this.threadId, this.turnId});

  final ThinkingContent thought;

  /// Where the whole thought is read from; null leaves it at what is here.
  final String? threadId;
  final String? turnId;

  @override
  State<_ThoughtRow> createState() => _ThoughtRowState();
}

class _ThoughtRowState extends State<_ThoughtRow> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    final thought = widget.thought;
    final live = thought.isStreaming;
    final threadId = widget.threadId;
    final turnId = widget.turnId;
    final labelStyle = textTheme.labelMedium?.copyWith(
      color: colors.onSurfaceVariant,
      fontStyle: FontStyle.italic,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _WorkLogLine(
          icon: UxIcons.psychology,
          iconColor: colors.onSurfaceVariant,
          leading: live
              ? PolygonLoader(size: 14, color: colors.onSurfaceVariant)
              : null,
          label: '',
          labelWidget: live
              ? _SkeletonText(l10n.conversationThinking, style: labelStyle)
              : Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: l10n.conversationThought,
                        style: labelStyle,
                      ),
                      const TextSpan(text: '  '),
                      TextSpan(
                        text: collapsePreviewText(thought.text),
                        style: textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
          open: thought.text.isEmpty ? null : _open,
          onTap: thought.text.isEmpty
              ? null
              : () => setState(() => _open = !_open),
        ),
        AnimatedSize(
          duration: UxnanMotion.revealIn(context),
          curve: UxnanMotion.revealCurve,
          alignment: Alignment.topCenter,
          child: _open
              ? Padding(
                  padding: const EdgeInsets.only(
                    left: UxnanSpacing.lg,
                    bottom: UxnanSpacing.xs,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _ThoughtBody(text: thought.text, live: live),
                      if (thought.isCut &&
                          thought.index != null &&
                          threadId != null &&
                          turnId != null)
                        _DetailLink(
                          label: l10n.conversationThoughtFull,
                          onTap: () => TurnDetailScreen.open(
                            context,
                            StepDetailRequest(
                              threadId: threadId,
                              turnId: turnId,
                              step: thought,
                            ),
                          ),
                        ),
                    ],
                  ),
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}

/// An opened thought: Markdown in a tonal box at most [_thoughtMaxHeight]
/// tall. While the thought streams ([live]) the box stays pinned to its
/// newest text — unless the reader scrolled up, which stops the following
/// until they scroll back to the end.
class _ThoughtBody extends StatefulWidget {
  const _ThoughtBody({required this.text, required this.live});

  final String text;
  final bool live;

  @override
  State<_ThoughtBody> createState() => _ThoughtBodyState();
}

class _ThoughtBodyState extends State<_ThoughtBody> {
  final ScrollController _scroll = ScrollController();

  /// Whether the box follows the newest text.
  bool _follow = true;

  @override
  void initState() {
    super.initState();
    _pinToEnd();
  }

  @override
  void didUpdateWidget(covariant _ThoughtBody oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.text != oldWidget.text) _pinToEnd();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _pinToEnd() {
    if (!widget.live || !_follow) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  bool _onScroll(ScrollNotification notification) {
    // Only the reader's own drag decides: a jump to the end is not one.
    if (notification is ScrollUpdateNotification &&
        notification.dragDetails != null) {
      final metrics = notification.metrics;
      _follow = metrics.pixels >= metrics.maxScrollExtent - 8;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Container(
      constraints: const BoxConstraints(maxHeight: _thoughtMaxHeight),
      decoration: BoxDecoration(
        color: colors.surfaceContainer,
        borderRadius: const BorderRadius.all(UxnanRadius.md),
      ),
      clipBehavior: Clip.antiAlias,
      child: NotificationListener<ScrollNotification>(
        onNotification: _onScroll,
        child: SingleChildScrollView(
          controller: _scroll,
          padding: const EdgeInsets.all(UxnanSpacing.sm),
          // Quieter than the answer: the same Markdown, one step smaller and in
          // the muted tone, through the theme the style sheet reads.
          child: Theme(
            data: theme.copyWith(
              textTheme: theme.textTheme.copyWith(
                bodyMedium: theme.textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                ),
              ),
            ),
            child: MessageContentView(content: TextContent(widget.text)),
          ),
        ),
      ),
    );
  }
}

/// The one-line face of a [_WorkLogRow]: status icon, the step ellipsized to
/// one line, and — when [open] is not null — a chevron that turns down open.
class _WorkLogLine extends StatelessWidget {
  const _WorkLogLine({
    required this.icon,
    required this.iconColor,
    required this.label,
    this.leading,
    this.labelWidget,
    this.open,
    this.onTap,
  });

  final UxIconData icon;
  final Color iconColor;
  final String label;

  /// Drawn in place of [icon] (a thought being written shows the loader).
  final Widget? leading;

  /// Drawn in place of [label] when the line is more than plain text.
  final Widget? labelWidget;
  final bool? open;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final open = this.open;
    return InkWell(
      borderRadius: const BorderRadius.all(UxnanRadius.md),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.sm),
        child: Row(
          children: [
            leading ?? UxIcon(icon, size: 14, color: iconColor),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: labelWidget ??
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: UxnanTypography.codeSmall,
                  ),
            ),
            if (open != null) ...[
              const SizedBox(width: UxnanSpacing.sm),
              AnimatedRotation(
                turns: open ? 0.25 : 0,
                duration: UxnanMotion.revealIn(context),
                child: UxIcon(
                  UxIcons.chevronRight,
                  size: 16,
                  color: colors.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A collapsible "Changed files (N) · +a −d" summary listing the files the
/// turn changed — merged by name across its edits and its summarized runs.
/// A file's row opens its diff on its own screen, read from the bridge.
class _ChangedFilesSection extends StatefulWidget {
  const _ChangedFilesSection({
    required this.files,
    required this.threadId,
    required this.turnId,
  });
  final List<TurnChangedFile> files;
  final String threadId;
  final String turnId;

  @override
  State<_ChangedFilesSection> createState() => _ChangedFilesSectionState();
}

class _ChangedFilesSectionState extends State<_ChangedFilesSection> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final duration =
        reduceMotion ? Duration.zero : const Duration(milliseconds: 220);
    var additions = 0;
    var deletions = 0;
    for (final file in widget.files) {
      additions += file.additions;
      deletions += file.deletions;
    }
    return Material(
      color: colors.surfaceContainerLow,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(
          _expanded ? UxnanRadius.lg : UxnanRadius.full,
        ),
      ),
      animationDuration: duration,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minHeight: UxnanSpacing.xxxl,
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.md,
                  vertical: UxnanSpacing.sm,
                ),
                child: Row(
                  children: [
                    UxIcon(
                      UxIcons.difference,
                      size: 16,
                      color: colors.onSurfaceVariant,
                    ),
                    const SizedBox(width: UxnanSpacing.sm),
                    Text(
                      l10n.conversationChangedFiles,
                      style: textTheme.labelMedium,
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                    _CountBadge(count: widget.files.length),
                    const Spacer(),
                    _DiffCounts(additions: additions, deletions: deletions),
                    const SizedBox(width: UxnanSpacing.sm),
                    UxIcon(
                      _expanded ? UxIcons.expandLess : UxIcons.expandMore,
                      size: 18,
                      color: colors.onSurfaceVariant,
                    ),
                  ],
                ),
              ),
            ),
          ),
          AnimatedSize(
            duration: duration,
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: _expanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(
                      UxnanSpacing.sm,
                      0,
                      UxnanSpacing.sm,
                      UxnanSpacing.sm,
                    ),
                    child: Column(
                      children: [
                        for (final file in widget.files)
                          _ChangedFileRow(
                            file: file,
                            onTap: () => TurnDetailScreen.open(
                              context,
                              FileDiffDetailRequest(
                                threadId: widget.threadId,
                                turnId: widget.turnId,
                                file: file,
                              ),
                            ),
                          ),
                      ],
                    ),
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}

/// One file in the changed-files list; a tap opens its diff.
class _ChangedFileRow extends StatelessWidget {
  const _ChangedFileRow({required this.file, required this.onTap});
  final TurnChangedFile file;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: const BorderRadius.all(UxnanRadius.md),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: UxnanSpacing.sm,
          vertical: UxnanSpacing.sm,
        ),
        child: Row(
          children: [
            UxIcon(
              UxIcons.insertDriveFile,
              size: 14,
              color: colors.onSurfaceVariant,
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Text(
                file.filename,
                style: UxnanTypography.codeSmall,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            _DiffCounts(additions: file.additions, deletions: file.deletions),
            const SizedBox(width: UxnanSpacing.xs),
            UxIcon(
              UxIcons.chevronRight,
              size: 16,
              color: colors.onSurfaceVariant,
            ),
          ],
        ),
      ),
    );
  }
}

/// A small count pill (e.g. the `5` in "Work log (5)").
class _CountBadge extends StatelessWidget {
  const _CountBadge({required this.count});
  final int count;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHigh,
        borderRadius: const BorderRadius.all(UxnanRadius.full),
      ),
      child: Text(
        '$count',
        style: UxnanTypography.codeSmall.copyWith(
          color: colors.onSurfaceVariant,
        ),
      ),
    );
  }
}
