/// Which stream of activity the contribution heatmap buckets by day.
///
/// The default [combined] sums the three streams; the others isolate one so the
/// user can read exactly what a day's intensity means (the widget always
/// captions the active metric).
enum ActivityMetric {
  /// Conversations started + messages + Git work, summed.
  combined,

  /// Conversations (threads) started.
  conversations,

  /// Messages exchanged (sent + received).
  messages,

  /// Git actions performed (commits, pushes, PRs, …).
  work,
}
