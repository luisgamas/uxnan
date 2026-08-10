import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The conversation currently filling the content pane, or null.
///
/// Only the wide layout has an answer worth drawing. On a phone the open
/// conversation IS the screen — marking a row you cannot see while you read it
/// would be marking nothing. Beside a permanent drawer the list stays visible
/// the whole time, and a list that never says which of its rows you are reading
/// makes you keep the answer in your head.
///
/// Fed by the shell, which already resolves it from the route.
class OpenThread extends Notifier<String?> {
  @override
  String? build() => null;

  /// Records which conversation the pane is showing, or null for none.
  // ignore: use_setters_to_change_properties
  void set(String? threadId) => state = threadId;
}

/// The conversation currently filling the content pane, or null.
final openThreadProvider =
    NotifierProvider<OpenThread, String?>(OpenThread.new);
