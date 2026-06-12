import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_highlight/themes/atom-one-light.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/approval_risk.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/plan_step_status.dart';
import 'package:uxnan/domain/enums/subagent_action_kind.dart';
import 'package:uxnan/domain/enums/system_content_kind.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Renders a single [MessageContent] block. The enclosing bubble provides the
/// background; this widget renders the block's body.
class MessageContentView extends StatelessWidget {
  /// Creates a [MessageContentView].
  const MessageContentView({
    required this.content,
    this.selectableText = true,
    super.key,
  });

  /// The content block to render.
  final MessageContent content;

  /// Whether text/markdown is selectable. Disabled for the user's own bubble so
  /// a tap on it toggles its copy affordance instead of placing a text cursor.
  final bool selectableText;

  @override
  Widget build(BuildContext context) {
    return switch (content) {
      final TextContent c => _TextBlock(content: c, selectable: selectableText),
      // Thinking is normally lifted into the turn's dedicated section by
      // AssistantTurnView; rendered here too for completeness.
      final ThinkingContent c => _ThinkingSection(text: c.text),
      final CodeContent c => _CodeBlock(content: c),
      final CommandExecutionContent c => _CommandCard(content: c),
      final SystemContent c => _SystemBanner(content: c),
      final DiffContent c => _DiffBlock(content: c),
      final ImageContent _ =>
        const _Placeholder(icon: Icons.image_outlined, label: 'Image'),
      final ToolUseContent c =>
        _Placeholder(icon: Icons.build_outlined, label: 'Tool · ${c.toolName}'),
      final MermaidContent _ =>
        const _Placeholder(icon: Icons.account_tree_outlined, label: 'Diagram'),
      final ApprovalContent c => _ApprovalCard(content: c),
      final PlanContent c => _PlanCard(content: c),
      final SubagentContent c => _SubagentCard(content: c),
      final UnknownContent c =>
        _Placeholder(icon: Icons.widgets_outlined, label: c.type),
    };
  }
}

/// Renders an [ApprovalContent]: the requested action, its risk, and (disabled)
/// Approve/Reject controls. FOR-DEV: sending the response needs a bridge
/// approval-response RPC (`turn/send { approvalResponse }`); until then this is
/// a read-only card so the request is visible.
class _ApprovalCard extends StatelessWidget {
  const _ApprovalCard({required this.content});
  final ApprovalContent content;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final request = content.request;

    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border:
            Border.all(color: _riskColor(request.risk).withValues(alpha: 0.6)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(UxnanSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.shield_outlined,
                  size: 16,
                  color: _riskColor(request.risk),
                ),
                const SizedBox(width: UxnanSpacing.sm),
                Text('Needs approval', style: textTheme.labelMedium),
                const Spacer(),
                _RiskBadge(risk: request.risk),
              ],
            ),
            const SizedBox(height: UxnanSpacing.sm),
            Text(
              request.action.isEmpty
                  ? 'Action awaiting approval'
                  : request.action,
              style: textTheme.bodyMedium,
            ),
            if (request.detail != null && request.detail!.isNotEmpty) ...[
              const SizedBox(height: UxnanSpacing.xs),
              Text(request.detail!, style: UxnanTypography.codeSmall),
            ],
            const SizedBox(height: UxnanSpacing.md),
            // FOR-DEV: respond via the bridge approval RPC when it exists.
            const Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: null,
                    child: Text('Reject'),
                  ),
                ),
                SizedBox(width: UxnanSpacing.sm),
                Expanded(
                  child: FilledButton(
                    onPressed: null,
                    child: Text('Approve'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: UxnanSpacing.xs),
            Text(
              'Respond from the desktop/CLI for now.',
              style:
                  textTheme.bodySmall?.copyWith(color: colors.onSurfaceVariant),
            ),
          ],
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
    final label = switch (risk) {
      ApprovalRisk.low => 'Low risk',
      ApprovalRisk.medium => 'Medium risk',
      ApprovalRisk.high => 'High risk',
      ApprovalRisk.unknown => 'Risk unknown',
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
class _PlanCard extends StatelessWidget {
  const _PlanCard({required this.content});
  final PlanContent content;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final state = content.state;

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
              ],
            ),
            const SizedBox(height: UxnanSpacing.sm),
            for (final step in state.steps)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
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
class _SubagentCard extends StatelessWidget {
  const _SubagentCard({required this.content});
  final SubagentContent content;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final state = content.state;

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
                  Text(
                    state.status!,
                    style: textTheme.labelSmall
                        ?.copyWith(color: colors.onSurfaceVariant),
                  ),
              ],
            ),
            if (state.actions.isNotEmpty)
              const SizedBox(height: UxnanSpacing.sm),
            for (final action in state.actions)
              Padding(
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
              ),
          ],
        ),
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
      styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
        p: Theme.of(context).textTheme.bodyMedium,
        code: UxnanTypography.codeBody,
      ),
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
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: UxnanSpacing.sm),
        Expanded(
          child: Text(
            content.text,
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
class AssistantTurnView extends ConsumerWidget {
  /// Creates an [AssistantTurnView] for an assistant [message].
  const AssistantTurnView({required this.message, super.key});

  /// The assistant message to render.
  final Message message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Partition the turn: reasoning → the thinking section; command/tool runs →
    // the work log; diffs → the changed-files summary; everything else is the
    // body, with consecutive text merged so the prose is one selectable region.
    final showThinking = ref.watch(showAgentThinkingProvider);
    final thinking = StringBuffer();
    final workLog = <MessageContent>[];
    final diffs = <DiffContent>[];
    final body = <MessageContent>[];
    for (final content in message.contents) {
      switch (content) {
        case final ThinkingContent reasoning:
          thinking.write(reasoning.text);
        case CommandExecutionContent() || ToolUseContent():
          workLog.add(content);
        case final DiffContent diff:
          diffs.add(diff);
        case final TextContent text:
          if (body.isNotEmpty && body.last is TextContent) {
            final prev = body.last as TextContent;
            body[body.length - 1] = TextContent(
              '${prev.text}\n\n${text.text}',
              isStreaming: text.isStreaming,
            );
          } else {
            body.add(text);
          }
        default:
          body.add(content);
      }
    }

    final prose = body
        .whereType<TextContent>()
        .map((t) => t.text)
        .where((t) => t.isNotEmpty)
        .join('\n\n');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showThinking && thinking.isNotEmpty) ...[
            _ThinkingSection(text: thinking.toString()),
            const SizedBox(height: UxnanSpacing.sm),
          ],
          if (workLog.isNotEmpty) ...[
            _WorkLogSection(items: workLog),
            const SizedBox(height: UxnanSpacing.sm),
          ],
          for (var i = 0; i < body.length; i++) ...[
            if (i > 0) const SizedBox(height: UxnanSpacing.sm),
            MessageContentView(content: body[i]),
          ],
          if (message.isStreaming) ...[
            const SizedBox(height: UxnanSpacing.sm),
            const _StreamingDots(),
          ],
          if (diffs.isNotEmpty) ...[
            const SizedBox(height: UxnanSpacing.sm),
            _ChangedFilesSection(diffs: diffs),
          ],
          if (prose.isNotEmpty && !message.isStreaming) ...[
            const SizedBox(height: UxnanSpacing.xs),
            _ResponseActions(text: prose),
          ],
        ],
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

/// A collapsible "Thinking" section showing the agent's reasoning. Default
/// collapsed; only built when the show-thinking setting is on.
class _ThinkingSection extends StatefulWidget {
  const _ThinkingSection({required this.text});
  final String text;

  @override
  State<_ThinkingSection> createState() => _ThinkingSectionState();
}

class _ThinkingSectionState extends State<_ThinkingSection> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.all(UxnanSpacing.md),
              child: Row(
                children: [
                  Icon(
                    Icons.psychology_outlined,
                    size: 16,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Text(l10n.conversationThinking, style: textTheme.labelMedium),
                  const Spacer(),
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
          if (_expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.md,
                0,
                UxnanSpacing.md,
                UxnanSpacing.md,
              ),
              child: SelectableText(
                widget.text,
                style: textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A collapsible "Work log (N)" of the commands and tools an agent turn ran.
class _WorkLogSection extends StatefulWidget {
  const _WorkLogSection({required this.items});

  /// The [CommandExecutionContent] / [ToolUseContent] blocks of the turn.
  final List<MessageContent> items;

  @override
  State<_WorkLogSection> createState() => _WorkLogSectionState();
}

class _WorkLogSectionState extends State<_WorkLogSection> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.all(UxnanSpacing.md),
              child: Row(
                children: [
                  Icon(
                    Icons.terminal_rounded,
                    size: 16,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: UxnanSpacing.sm),
                  Text(l10n.conversationWorkLog, style: textTheme.labelMedium),
                  const SizedBox(width: UxnanSpacing.xs),
                  _CountBadge(count: widget.items.length),
                  const Spacer(),
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
          if (_expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.md,
                0,
                UxnanSpacing.md,
                UxnanSpacing.sm,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final item in widget.items) ...[
                    const SizedBox(height: UxnanSpacing.sm),
                    _WorkLogRow(item: item),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// One compact work-log entry: a command (with its output) or a tool call.
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
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            if (command.output != null && command.output!.isNotEmpty)
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
                  maxLines: 8,
                  overflow: TextOverflow.ellipsis,
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
    var additions = 0;
    var deletions = 0;
    for (final diff in widget.diffs) {
      additions += diff.additions;
      deletions += diff.deletions;
    }
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            borderRadius: const BorderRadius.all(UxnanRadius.lg),
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.all(UxnanSpacing.md),
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
          if (_expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                UxnanSpacing.sm,
                0,
                UxnanSpacing.sm,
                UxnanSpacing.sm,
              ),
              child: Column(
                children: [
                  for (final diff in widget.diffs) _ChangedFileRow(diff: diff),
                ],
              ),
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

/// Three animated dots shown while an assistant turn is still streaming.
class _StreamingDots extends StatefulWidget {
  const _StreamingDots();

  @override
  State<_StreamingDots> createState() => _StreamingDotsState();
}

class _StreamingDotsState extends State<_StreamingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return SizedBox(
      height: 8,
      width: 34,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          return Row(
            children: List<Widget>.generate(3, (i) {
              final t = (_controller.value + i / 3) % 1.0;
              final opacity = 0.3 + 0.7 * (t < 0.5 ? t * 2 : (1 - t) * 2);
              return Padding(
                padding: const EdgeInsets.only(right: 5),
                child: Opacity(
                  opacity: opacity,
                  child: CircleAvatar(radius: 3, backgroundColor: color),
                ),
              );
            }),
          );
        },
      ),
    );
  }
}
