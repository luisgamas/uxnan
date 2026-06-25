import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

/// Reports its child's rendered **height** to [onChange] after every layout in
/// which it changes.
///
/// Used to let a floating bottom chrome (the composer pill + its banners) tell
/// the scroll view behind it how much bottom padding to reserve, so content can
/// scroll *under* the translucent composer veil while the last item still rests
/// just above the pill. The callback is fired from a post-frame callback (never
/// synchronously during layout) so a `setState` in the parent is safe.
class MeasureHeight extends SingleChildRenderObjectWidget {
  /// Creates a [MeasureHeight] that wraps [child] and reports its height.
  const MeasureHeight({
    required this.onChange,
    required Widget super.child,
    super.key,
  });

  /// Called with the child's height whenever it changes between layouts.
  final ValueChanged<double> onChange;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderMeasureHeight(onChange);

  @override
  void updateRenderObject(BuildContext context, RenderObject renderObject) {
    (renderObject as _RenderMeasureHeight).onChange = onChange;
  }
}

class _RenderMeasureHeight extends RenderProxyBox {
  _RenderMeasureHeight(this.onChange);

  ValueChanged<double> onChange;
  double? _lastHeight;

  @override
  void performLayout() {
    super.performLayout();
    final height = size.height;
    if (_lastHeight != height) {
      _lastHeight = height;
      // Defer: mutating parent state synchronously during layout throws.
      SchedulerBinding.instance.addPostFrameCallback((_) => onChange(height));
    }
  }
}
