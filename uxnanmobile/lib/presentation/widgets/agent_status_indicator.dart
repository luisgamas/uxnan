import 'package:flutter/material.dart';
import 'package:uxnan/domain/enums/agent_run_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/agent_run_state_provider.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// One agent's state as a single compact mark.
///
/// **A glyph means something is happening; a plain dot means nothing is.** That
/// is what makes a list scannable, and it is why `idle` — by far the most
/// common state — is deliberately the only one without a glyph: a symbol there
/// would be constant noise with no signal.
///
/// Each state also has a **different shape**, not just a different colour.
/// Colour alone is not a channel a colour-blind reader can use, and this mark
/// is often the only thing distinguishing two otherwise identical rows.
class AgentStatusIndicator extends StatelessWidget {
  /// Creates an [AgentStatusIndicator] for [status].
  const AgentStatusIndicator({
    required this.status,
    this.size = 14,
    super.key,
  });

  /// The state to draw, with its modifiers.
  final AgentRunStatus status;

  /// Height and width of the mark.
  final double size;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    final label = switch (status.state) {
      AgentRunState.working => l10n.agentStateWorking,
      AgentRunState.waiting => l10n.agentStateWaiting,
      AgentRunState.blocked => l10n.agentStateBlocked,
      AgentRunState.done => l10n.agentStateDone,
      AgentRunState.idle => l10n.agentStateIdle,
    };
    // An error re-tints whatever the agent is doing rather than replacing it:
    // "the last turn failed" and "it is working again" are both true, and the
    // row should not have to pick one.
    final tint = status.errored
        ? UxnanColors.error
        : switch (status.state) {
            AgentRunState.working => colors.primary,
            AgentRunState.waiting => UxnanColors.warning,
            AgentRunState.blocked => UxnanColors.connecting,
            AgentRunState.done => UxnanColors.connected,
            AgentRunState.idle => UxnanColors.onSurfaceMuted,
          };

    final mark = switch (status.state) {
      // The app's one loading language, never a bare CircularProgressIndicator.
      AgentRunState.working => PolygonLoader(size: size, color: tint),
      AgentRunState.waiting =>
        UxIcon(UxIcons.agentWaiting, size: size, color: tint),
      AgentRunState.blocked =>
        UxIcon(UxIcons.agentBlocked, size: size, color: tint),
      AgentRunState.done => UxIcon(UxIcons.agentDone, size: size, color: tint),
      AgentRunState.idle => _Dot(color: tint, size: size),
    };

    return Tooltip(
      message: status.stale ? '$label · ${l10n.agentStateStale}' : label,
      child: Semantics(
        label: label,
        child: ExcludeSemantics(
          child: SizedBox.square(
            dimension: size,
            child: Center(
              // A claim that has gone quiet for half an hour is dimmed rather
              // than dropped: the turn may still be alive, and hiding it would
              // be a bigger lie than showing it faintly.
              child: status.stale ? Opacity(opacity: 0.4, child: mark) : mark,
            ),
          ),
        ),
      ),
    );
  }
}

/// The resting mark: small, quiet, and the same size as every glyph beside it
/// so a column of rows never shifts as agents wake and settle.
class _Dot extends StatelessWidget {
  const _Dot({required this.color, required this.size});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size * 0.45,
      height: size * 0.45,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
