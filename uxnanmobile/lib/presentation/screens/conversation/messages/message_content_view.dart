import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_highlight/themes/atom-one-light.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/approval_decision.dart';
import 'package:uxnan/domain/enums/approval_risk.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/plan_step_status.dart';
import 'package:uxnan/domain/enums/subagent_action_kind.dart';
import 'package:uxnan/domain/enums/system_content_kind.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/approval_providers.dart';
import 'package:uxnan/presentation/providers/question_providers.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/markdown.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';

/// Renders a single [MessageContent] block. The enclosing bubble provides the
/// background; this widget renders the block's body.
class MessageContentView extends StatelessWidget {
  /// Creates a [MessageContentView].
  const MessageContentView({
    required this.content,
    this.selectableText = true,
    this.threadId,
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

  @override
  Widget build(BuildContext context) {
    return switch (content) {
      final TextContent c => _TextBlock(content: c, selectable: selectableText),
      // Thinking is normally lifted into the turn's dedicated section by
      // AssistantTurnView; rendered here too for completeness.
      final ThinkingContent c => _StandaloneThinkingSection(text: c.text),
      final CodeContent c => _CodeBlock(content: c),
      final CommandExecutionContent c => _CommandCard(content: c),
      final SystemContent c => _SystemBanner(content: c),
      final DiffContent c => _DiffBlock(content: c),
      final ImageContent c => _ImageBlock(content: c),
      final ToolUseContent c =>
        _Placeholder(icon: Icons.build_outlined, label: 'Tool · ${c.toolName}'),
      final MermaidContent _ =>
        const _Placeholder(icon: Icons.account_tree_outlined, label: 'Diagram'),
      final ApprovalContent c => _ApprovalCard(content: c, threadId: threadId),
      final QuestionContent c => _QuestionCard(content: c, threadId: threadId),
      final PlanContent c => _PlanCard(content: c),
      final SubagentContent c => _SubagentCard(content: c),
      final UnknownContent c =>
        _Placeholder(icon: Icons.widgets_outlined, label: c.type),
    };
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
/// Live end-to-end: the bridge emits `approval` blocks (Claude/Codex/Gemini
/// hooks, OpenCode via `opencode serve`) and accepts `turn/send { approvalResponse }`.
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
                Icon(
                  resolved
                      ? (response!.decision == ApprovalDecision.reject
                          ? Icons.cancel_rounded
                          : Icons.verified_user_outlined)
                      : Icons.shield_outlined,
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
              Icon(Icons.error_outline_rounded, size: 14, color: colors.error),
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
        Icon(
          approved ? Icons.check_circle_rounded : Icons.cancel_rounded,
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

  List<QuestionItem> get _questions => widget.content.request.questions;

  @override
  void initState() {
    super.initState();
    _selected = List.generate(_questions.length, (_) => <String>{});
  }

  @override
  void didUpdateWidget(covariant _QuestionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Re-sync the selection buffer if the question set is swapped under us.
    if (_questions.length != _selected.length) {
      _selected = List.generate(_questions.length, (_) => <String>{});
    }
  }

  /// A question is satisfied once it has a selection — or trivially when it has
  /// no options to pick from (a degenerate payload).
  bool _satisfied(int i) =>
      _questions[i].options.isEmpty || _selected[i].isNotEmpty;

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

    void toggle(int qIndex, String label) {
      if (!interactive) return;
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
        }
      });
    }

    void submit() {
      if (!canSubmit) return;
      final answers = [
        for (var i = 0; i < questions.length; i++) _selected[i].toList(),
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
                Icon(
                  resolved ? Icons.check_circle_rounded : Icons.quiz_outlined,
                  size: 16,
                  color: accent,
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Text(
                  resolved ? l10n.questionAnswered : l10n.questionNeedsAnswer,
                  style: textTheme.labelMedium,
                ),
                const Spacer(),
                if (questions.length > 1) _CountBadge(count: questions.length),
              ],
            ),
            for (var i = 0; i < questions.length; i++) ...[
              const SizedBox(height: UxnanSpacing.md),
              _QuestionBlock(
                question: questions[i],
                selected: _selected[i],
                resolved: resolved,
                chosen: chosenFor(i),
                enabled: interactive,
                onToggle: (label) => toggle(i, label),
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
  });

  final QuestionItem question;
  final Set<String> selected;
  final bool resolved;
  final List<String> chosen;
  final bool enabled;
  final ValueChanged<String> onToggle;

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
        ? (selected
            ? Icons.check_box_rounded
            : Icons.check_box_outline_blank_rounded)
        : (selected
            ? Icons.radio_button_checked_rounded
            : Icons.radio_button_unchecked_rounded);
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
                child: Icon(
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
                const Icon(
                  Icons.check_rounded,
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
  });

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
              Icon(Icons.error_outline_rounded, size: 14, color: colors.error),
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
            Expanded(
              child: OutlinedButton(
                onPressed: acting ? onSkip : null,
                child: Text(l10n.questionSkip),
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: FilledButton(
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
        const Icon(
          Icons.check_circle_rounded,
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
        icon: Icons.image_outlined,
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
            icon: Icons.broken_image_outlined,
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
                  Icon(
                    Icons.checklist_rounded,
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
                  Icon(
                    _expanded
                        ? Icons.expand_less_rounded
                        : Icons.expand_more_rounded,
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
          Icons.radio_button_unchecked,
          Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      PlanStepStatus.inProgress => (
          Icons.autorenew_rounded,
          UxnanColors.connecting,
        ),
      PlanStepStatus.completed => (
          Icons.check_circle_rounded,
          UxnanColors.success,
        ),
    };
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Icon(icon, size: 16, color: color),
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
    final hasActions = actions.isNotEmpty;

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
                  Icon(
                    Icons.account_tree_rounded,
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
                  Icon(
                    _expanded
                        ? Icons.expand_less_rounded
                        : Icons.expand_more_rounded,
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
            child: hasActions && _expanded
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
            child: Icon(
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

IconData _subagentActionIcon(SubagentActionKind kind) => switch (kind) {
      SubagentActionKind.tool => Icons.build_outlined,
      SubagentActionKind.edit => Icons.edit_outlined,
      SubagentActionKind.command => Icons.terminal_rounded,
      SubagentActionKind.message => Icons.chat_bubble_outline,
      SubagentActionKind.unknown => Icons.bolt_outlined,
    };

class _TextBlock extends StatelessWidget {
  const _TextBlock({required this.content, this.selectable = true});
  final TextContent content;
  final bool selectable;

  @override
  Widget build(BuildContext context) {
    return MarkdownBody(
      data: content.text.isEmpty ? '…' : content.text,
      selectable: selectable,
      styleSheet: uxnanMarkdownStyleSheet(context),
    );
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
                  icon: const Icon(Icons.copy_rounded, size: 16),
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
          Icons.autorenew_rounded,
          UxnanColors.connecting,
        ),
      CommandStatus.completed => (
          Icons.check_circle_outline,
          UxnanColors.success,
        ),
      CommandStatus.error => (Icons.error_outline, UxnanColors.error),
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
                Icon(icon, size: 16, color: color),
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
              Text(content.output!, style: UxnanTypography.codeSmall),
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
      SystemContentKind.info => (Icons.info_outline, UxnanColors.gitUntracked),
      SystemContentKind.warning => (
          Icons.warning_amber_rounded,
          UxnanColors.warning
        ),
      SystemContentKind.error => (Icons.error_outline, UxnanColors.error),
      SystemContentKind.debug => (
          Icons.bug_report_outlined,
          colors.onSurfaceVariant
        ),
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
        Icon(icon, size: 16, color: color),
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
                const Icon(Icons.difference_outlined, size: 16),
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
          _DiffLines(diff: content.diff),
        ],
      ),
    );
  }
}

/// The colored, per-line body of a unified diff (no header). Shared by the
/// inline diff block and the changed-files section.
class _DiffLines extends StatelessWidget {
  const _DiffLines({required this.diff});
  final String diff;

  @override
  Widget build(BuildContext context) {
    final lines = diff.split('\n');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final line in lines)
          ColoredBox(
            color: _diffLineColor(line),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: UxnanSpacing.sm,
                vertical: 1,
              ),
              child: Text(line, style: UxnanTypography.codeSmall),
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
  final IconData icon;
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
            Icon(icon, size: 18, color: colors.onSurfaceVariant),
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
  const AssistantTurnView({required this.message, super.key});

  /// The assistant message to render.
  final Message message;

  @override
  ConsumerState<AssistantTurnView> createState() => _AssistantTurnViewState();
}

class _AssistantTurnViewState extends ConsumerState<AssistantTurnView> {
  String? _expandedProcess;

  void _toggleProcess(String id) {
    setState(() => _expandedProcess = _expandedProcess == id ? null : id);
  }

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final showThinking = ref.watch(showAgentThinkingProvider);
    final thinking = StringBuffer();
    final diffs = <DiffContent>[];
    final prose = StringBuffer();
    // Ordered segments: work-log cards and prose/other blocks IN THE ORDER the
    // agent produced them, so a work log sits just above the response it
    // precedes and interleaved responses don't collapse into one block.
    // Reasoning is lifted to the top; diffs to the changed-files summary.
    final segments = <Widget>[];
    final pendingCommands = <MessageContent>[];
    final pendingText = StringBuffer();
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
      segments.add(MessageContentView(content: TextContent(text)));
    }

    void flushCommands() {
      if (pendingCommands.isEmpty) return;
      final items = List<MessageContent>.of(pendingCommands);
      pendingCommands.clear();
      final processId = 'work-${workLogIndex++}';
      gap();
      segments.add(
        _WorkLogSection(
          items: items,
          expanded: _expandedProcess == processId,
          onToggle: () => _toggleProcess(processId),
        ),
      );
    }

    for (final content in message.contents) {
      switch (content) {
        case final ThinkingContent reasoning:
          thinking.write(reasoning.text);
        case final DiffContent diff:
          diffs.add(diff);
        case CommandExecutionContent() || ToolUseContent():
          flushText();
          pendingCommands.add(content);
        case final TextContent text:
          flushCommands();
          if (text.text.isNotEmpty) {
            if (pendingText.isNotEmpty) pendingText.write('\n\n');
            pendingText.write(text.text);
            if (prose.isNotEmpty) prose.write('\n\n');
            prose.write(text.text);
          }
        default:
          flushCommands();
          flushText();
          gap();
          segments.add(
            MessageContentView(content: content, threadId: message.threadId),
          );
      }
    }
    flushCommands();
    flushText();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (message.isStreaming) ...[
            _AgentRespondingStatus(
              label: AppLocalizations.of(context).conversationAgentResponding,
            ),
            const SizedBox(height: UxnanSpacing.sm),
          ],
          if (showThinking && thinking.isNotEmpty) ...[
            _ThinkingSection(
              text: thinking.toString(),
              expanded: _expandedProcess == 'thinking',
              onToggle: () => _toggleProcess('thinking'),
            ),
            const SizedBox(height: UxnanSpacing.sm),
          ],
          ...segments,
          if (diffs.isNotEmpty) ...[
            const SizedBox(height: UxnanSpacing.sm),
            _ChangedFilesSection(diffs: diffs),
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
        Text(
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
        icon: const Icon(Icons.copy_rounded, size: 16),
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

/// Standalone fallback for a reasoning block rendered outside an assistant
/// turn. Assistant turns lift expansion state to their parent so opening one
/// process panel collapses the previously open panel in that same turn.
class _StandaloneThinkingSection extends StatefulWidget {
  const _StandaloneThinkingSection({required this.text});
  final String text;

  @override
  State<_StandaloneThinkingSection> createState() =>
      _StandaloneThinkingSectionState();
}

class _StandaloneThinkingSectionState
    extends State<_StandaloneThinkingSection> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    return _ThinkingSection(
      text: widget.text,
      expanded: _expanded,
      onToggle: () => setState(() => _expanded = !_expanded),
    );
  }
}

/// A subdued reasoning disclosure. Its tonal surface keeps the process visible
/// without competing with the assistant's editorial response.
class _ThinkingSection extends StatelessWidget {
  const _ThinkingSection({
    required this.text,
    required this.expanded,
    required this.onToggle,
  });

  final String text;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final l10n = AppLocalizations.of(context);
    return _AgentProcessDisclosure(
      icon: Icons.psychology_outlined,
      title: l10n.conversationThinking,
      expanded: expanded,
      onToggle: onToggle,
      child: SelectableText(
        text,
        style: textTheme.bodySmall?.copyWith(
          color: colors.onSurfaceVariant,
          fontStyle: FontStyle.italic,
        ),
      ),
    );
  }
}

/// A compact work-log disclosure. Collapsed state keeps only the count and the
/// latest activity summary visible; expansion reveals every command/tool and
/// its available output.
class _WorkLogSection extends StatelessWidget {
  const _WorkLogSection({
    required this.items,
    required this.expanded,
    required this.onToggle,
  });

  /// The [CommandExecutionContent] / [ToolUseContent] blocks of the turn.
  final List<MessageContent> items;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _AgentProcessDisclosure(
      icon: Icons.terminal_rounded,
      title: l10n.conversationWorkLog,
      count: items.length,
      collapsedSummary: _workLogSummary(items.last),
      expanded: expanded,
      onToggle: onToggle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) const SizedBox(height: UxnanSpacing.sm),
            _WorkLogRow(item: items[i]),
          ],
        ],
      ),
    );
  }
}

String _workLogSummary(MessageContent item) => switch (item) {
      final CommandExecutionContent command => '\$ ${command.command}',
      final ToolUseContent tool =>
        tool.toolName.isEmpty ? 'tool' : tool.toolName,
      _ => '',
    };

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

  final IconData icon;
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
    final reduceMotion = MediaQuery.of(context).disableAnimations;
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
                    Icon(icon, size: 16, color: colors.onSurfaceVariant),
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
                    Icon(
                      expanded
                          ? Icons.expand_less_rounded
                          : Icons.expand_more_rounded,
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

/// One expanded work-log entry: a command or tool call with its available
/// output. The collapsed disclosure uses [_workLogSummary] instead.
class _WorkLogRow extends StatelessWidget {
  const _WorkLogRow({required this.item});
  final MessageContent item;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    switch (item) {
      case final CommandExecutionContent command:
        final (icon, color) = switch (command.status) {
          CommandStatus.running => (
              Icons.autorenew_rounded,
              UxnanColors.connecting,
            ),
          CommandStatus.completed => (
              Icons.check_circle_outline,
              UxnanColors.success,
            ),
          CommandStatus.error => (Icons.error_outline, UxnanColors.error),
        };
        final hasOutput = command.output != null && command.output!.isNotEmpty;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Icon(icon, size: 14, color: color),
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: Text(
                    '\$ ${command.command}',
                    style: UxnanTypography.codeSmall,
                  ),
                ),
              ],
            ),
            if (hasOutput)
              Padding(
                padding: const EdgeInsets.only(
                  left: UxnanSpacing.lg,
                  top: 2,
                ),
                child: Text(
                  command.output!,
                  style: UxnanTypography.codeSmall.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        );
      case final ToolUseContent tool:
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(
                tool.isError ? Icons.error_outline : Icons.build_outlined,
                size: 14,
                color:
                    tool.isError ? UxnanColors.error : colors.onSurfaceVariant,
              ),
            ),
            const SizedBox(width: UxnanSpacing.sm),
            Expanded(
              child: Text(
                tool.toolName.isEmpty ? 'tool' : tool.toolName,
                style: UxnanTypography.codeSmall,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

/// A collapsible "Changed files (N) · +a −d" summary listing the turn's diffs;
/// tapping a file row expands its unified diff.
class _ChangedFilesSection extends StatefulWidget {
  const _ChangedFilesSection({required this.diffs});
  final List<DiffContent> diffs;

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
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final duration =
        reduceMotion ? Duration.zero : const Duration(milliseconds: 220);
    var additions = 0;
    var deletions = 0;
    for (final diff in widget.diffs) {
      additions += diff.additions;
      deletions += diff.deletions;
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
                    Icon(
                      Icons.difference_outlined,
                      size: 16,
                      color: colors.onSurfaceVariant,
                    ),
                    const SizedBox(width: UxnanSpacing.sm),
                    Text(
                      l10n.conversationChangedFiles,
                      style: textTheme.labelMedium,
                    ),
                    const SizedBox(width: UxnanSpacing.xs),
                    _CountBadge(count: widget.diffs.length),
                    const Spacer(),
                    _DiffCounts(additions: additions, deletions: deletions),
                    const SizedBox(width: UxnanSpacing.sm),
                    Icon(
                      _expanded
                          ? Icons.expand_less_rounded
                          : Icons.expand_more_rounded,
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
                        for (final diff in widget.diffs)
                          _ChangedFileRow(diff: diff),
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

/// One file in the changed-files list; tap to expand/collapse its diff.
class _ChangedFileRow extends StatefulWidget {
  const _ChangedFileRow({required this.diff});
  final DiffContent diff;

  @override
  State<_ChangedFileRow> createState() => _ChangedFileRowState();
}

class _ChangedFileRowState extends State<_ChangedFileRow> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          borderRadius: const BorderRadius.all(UxnanRadius.md),
          onTap: () => setState(() => _open = !_open),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: UxnanSpacing.sm,
              vertical: UxnanSpacing.sm,
            ),
            child: Row(
              children: [
                Icon(
                  Icons.insert_drive_file_outlined,
                  size: 14,
                  color: colors.onSurfaceVariant,
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: Text(
                    widget.diff.filename,
                    style: UxnanTypography.codeSmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: UxnanSpacing.sm),
                _DiffCounts(
                  additions: widget.diff.additions,
                  deletions: widget.diff.deletions,
                ),
              ],
            ),
          ),
        ),
        if (_open && widget.diff.diff.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: UxnanSpacing.sm),
            child: _DiffLines(diff: widget.diff.diff),
          ),
      ],
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
