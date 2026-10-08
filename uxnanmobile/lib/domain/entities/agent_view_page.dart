/// Prepared, self-contained HTML returned by the bridge's `view/read` method.
class AgentViewPage {
  const AgentViewPage({
    required this.viewId,
    required this.title,
    required this.html,
    required this.bytes,
  });

  final String viewId;
  final String title;
  final String html;
  final int bytes;
}
