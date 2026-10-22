/// The bounds the bridge serves a conversation within, mirrored by hand from
/// `shared/src/models/history.ts` (architecture/02b §1.5, *Historial
/// acotado*). Characters are UTF-16 code units — a Dart `String.length`, the
/// same unit as a JavaScript string's.
///
/// The phone applies the same cuts to what it keeps from a live turn, so a
/// stored reply has the shape a page would have given it.
abstract final class HistoryBudget {
  /// A step preview's `command`: its first this-many characters.
  static const int stepCommandPreviewChars = 400;

  /// A step preview's `output`: its LAST this-many characters.
  static const int stepOutputPreviewChars = 1200;

  /// A thought's preview `text`: its first this-many characters.
  static const int stepThinkingPreviewChars = 600;
}
