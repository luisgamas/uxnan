/// Bounds of what the messages table keeps beside a message's contents.
abstract final class MessagePreviewLimits {
  /// How many characters of a message's text its `preview_text` column keeps:
  /// more than any surface shows of it (a thread row shows 120, the scroll
  /// rail 220), so a reader never needs the contents to preview a message.
  static const int columnLength = 280;
}
