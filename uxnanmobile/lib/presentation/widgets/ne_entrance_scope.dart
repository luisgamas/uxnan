import 'package:flutter/widgets.dart';
import 'package:uxnan/presentation/widgets/ne_enter_transition.dart';

/// Makes a list's rows rise into place **the first time it fills**, and only
/// then.
///
/// The obvious way to stagger a list — give row `i` a delay of `i × step` —
/// is wrong for a lazy [SliverList]: row 30 is not built at startup, it is
/// built when you scroll to it, so it would animate in under your thumb, and
/// with a delay proportional to an index that no longer means anything. What
/// should animate is the list *arriving*, not each row being reached.
///
/// So the window is **one frame**: the first row to ask opens it, and it shuts
/// at the end of that same frame. A sliver lays out everything the viewport
/// needs in a single pass, so "the rows that arrived together" and "the rows
/// built in one frame" are the same set — including when the data landed
/// asynchronously, since those rows all build in the frame the data arrived.
/// Anything built in a later frame is a row you scrolled to, and appears at
/// once.
///
/// Frames, not milliseconds, on purpose: a wall-clock window cannot be tested
/// (a widget test runs a hundred frames in less real time than any window
/// worth having) and would drift with however long a slow first build took.
class NeEntranceScope extends StatefulWidget {
  /// Creates a [NeEntranceScope] over [child].
  const NeEntranceScope({required this.child, super.key});

  /// The subtree whose rows may stagger — normally a whole screen.
  final Widget child;

  /// The gap between one row and the next.
  static const Duration step = Duration(milliseconds: 35);

  /// How many rows still take a longer delay than the row above them.
  ///
  /// Past this the stagger flattens: a screenful is about eight rows, and the
  /// ninth waiting longer than the eighth is a wait, not a flourish.
  static const int maxStaggered = 8;

  /// The delay row [index] should wait before entering, or `null` if it should
  /// not animate at all — no scope above it, reduced motion, or the window has
  /// closed.
  static Duration? delayFor(BuildContext context, int index) {
    if (MediaQuery.disableAnimationsOf(context)) return null;
    final scope =
        context.getInheritedWidgetOfExactType<_EntranceWindow>()?.state;
    if (scope == null || !scope.isOpen) return null;
    final steps = index < maxStaggered ? index : maxStaggered;
    return step * steps;
  }

  @override
  State<NeEntranceScope> createState() => _NeEntranceScopeState();
}

class _NeEntranceScopeState extends State<NeEntranceScope> {
  bool _closed = false;
  bool _closing = false;

  /// Opened by the first caller and shut at the end of that frame.
  bool get isOpen {
    if (_closed) return false;
    if (!_closing) {
      _closing = true;
      // No setState: nothing rebuilds on this. A row asks once, during the
      // build that created it, and its answer can never change afterwards.
      WidgetsBinding.instance.addPostFrameCallback((_) => _closed = true);
    }
    return true;
  }

  @override
  Widget build(BuildContext context) =>
      _EntranceWindow(state: this, child: widget.child);
}

class _EntranceWindow extends InheritedWidget {
  const _EntranceWindow({required this.state, required super.child});

  final _NeEntranceScopeState state;

  // The window is read during build and never notifies: a row asks once, on
  // the build it was created in, and its answer cannot change afterwards.
  @override
  bool updateShouldNotify(_EntranceWindow oldWidget) => false;
}

/// Convenience: [child] wrapped in an entrance if the scope above says so.
///
/// Rows call this rather than reaching for `NeEnterTransition` themselves, so
/// the "don't animate on scroll" rule lives in one place instead of at every
/// list.
class NeEntranceRow extends StatefulWidget {
  /// Creates a [NeEntranceRow] for the row at [index].
  const NeEntranceRow({
    required this.index,
    required this.child,
    super.key,
  });

  /// The row's position in its list — what the stagger is measured from.
  final int index;

  /// The row itself.
  final Widget child;

  @override
  State<NeEntranceRow> createState() => _NeEntranceRowState();
}

class _NeEntranceRowState extends State<NeEntranceRow> {
  /// Decided ONCE, when the row is created, and never revisited.
  ///
  /// Asking per build would be a bug with teeth: the window shuts after the
  /// first frame, so the very next rebuild would answer "no" and return the
  /// bare child — changing this subtree's shape, which makes Flutter unmount
  /// the row's element and build a fresh one. Every piece of State inside the
  /// row dies at that point: a revealed address re-hides itself, an open
  /// expander closes, a half-typed field empties. It cost a real test to find.
  Duration? _delay;
  bool _decided = false;

  @override
  Widget build(BuildContext context) {
    if (!_decided) {
      _decided = true;
      _delay = NeEntranceScope.delayFor(context, widget.index);
    }
    final delay = _delay;
    if (delay == null) return widget.child;
    return NeEnterTransition(delay: delay, child: widget.child);
  }
}
