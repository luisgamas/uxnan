import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_highlight/themes/atom-one-light.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:uxnan/domain/enums/approval_risk.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/plan_step_status.dart';
import 'package:uxnan/domain/enums/subagent_action_kind.dart';
import 'package:uxnan/domain/enums/system_content_kind.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Renders a single [MessageContent] block. The enclosing bubble provides the
/// background; this widget renders the block's body.
class MessageContentView extends StatelessWidget {
  /// Creates a [MessageContentView].
  const MessageContentView({required this.content, super.key});

  /// The content block to render.
  final MessageContent content;

  @override
  Widget build(BuildContext context) {
    return switch (content) {
      final TextContent c => _TextBlock(content: c),
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
  const _TextBlock({required this.content});
  final TextContent content;

  @override
  Widget build(BuildContext context) {
    return MarkdownBody(
      data: content.text.isEmpty ? '…' : content.text,
      selectable: true,
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
    final lines = content.diff.split('\n');
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
                Text(
                  '+${content.additions} -${content.deletions}',
                  style: UxnanTypography.codeSmall,
                ),
              ],
            ),
          ),
          for (final line in lines)
            ColoredBox(
              color: _lineColor(line),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: UxnanSpacing.sm,
                  vertical: 1,
                ),
                child: Text(line, style: UxnanTypography.codeSmall),
              ),
            ),
        ],
      ),
    );
  }

  Color _lineColor(String line) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return UxnanColors.gitAdded.withValues(alpha: 0.12);
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return UxnanColors.gitDeleted.withValues(alpha: 0.12);
    }
    return Colors.transparent;
  }
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
