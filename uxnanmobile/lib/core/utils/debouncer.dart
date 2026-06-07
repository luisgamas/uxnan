import 'dart:async';

/// Coalesces rapid calls into a single deferred invocation.
///
/// Each call to [run] resets the timer; the supplied action only fires once no
/// new call has arrived for [delay]. Used for composer drafts, search input and
/// other high-frequency UI events. Remember to [dispose] to cancel pending
/// work.
class Debouncer {
  /// Creates a [Debouncer] that fires its action [delay] after the last call.
  Debouncer({required this.delay});

  /// The quiet period that must elapse before the pending action runs.
  final Duration delay;

  Timer? _timer;

  /// Schedules [action], cancelling any previously scheduled action.
  void run(void Function() action) {
    _timer?.cancel();
    _timer = Timer(delay, action);
  }

  /// Whether an action is currently scheduled but not yet fired.
  bool get isActive => _timer?.isActive ?? false;

  /// Cancels any pending action without running it.
  void cancel() => _timer?.cancel();

  /// Releases the underlying timer. Call when the owner is disposed.
  void dispose() => _timer?.cancel();
}
