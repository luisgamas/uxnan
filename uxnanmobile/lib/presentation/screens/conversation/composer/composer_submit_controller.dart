import 'package:flutter/foundation.dart';

/// Lets a control OUTSIDE the composer pill trigger its send.
///
/// The draft text lives in the composer's own `TextEditingController`, so the
/// floating "queue message" action above the pill — which is a sibling widget,
/// not a child — has no way to reach it. Rather than hoisting the whole text
/// controller into the screen (and with it the mention/command state that hangs
/// off it), the screen owns this one-signal channel: it calls [submit], the
/// composer performs its normal send, and the draft, attachments and dictation
/// teardown all stay in the one place that already handles them.
class ComposerSubmitController extends ChangeNotifier {
  /// Asks the composer to send whatever is currently drafted.
  void submit() => notifyListeners();
}
