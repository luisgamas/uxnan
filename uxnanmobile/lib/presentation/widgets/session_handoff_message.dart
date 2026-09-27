import 'package:uxnan/domain/value_objects/agent_session.dart';
import 'package:uxnan/l10n/app_localizations.dart';

/// What asking a PC's terminal to let a session go means for the person, when
/// it did not (architecture/02a §5.8.19).
String handoffMessage(AppLocalizations l10n, AgentSessionHandoffOutcome o) =>
    switch (o) {
      AgentSessionHandoffOutcome.busy => l10n.sessionHandoffBusy,
      AgentSessionHandoffOutcome.declined => l10n.sessionHandoffDeclined,
      _ => l10n.sessionHandoffUnreachable,
    };
