import 'package:uxnan/domain/entities/agent_view_page.dart';

/// Reads bridge-owned agent view pages.
// ignore: one_member_abstracts
abstract interface class IAgentViewRepository {
  /// Returns the prepared page, or throws when the bridge cannot provide it.
  Future<AgentViewPage> readView(String viewId);
}
