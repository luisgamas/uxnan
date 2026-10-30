/// Where a user message's images and files sit in its text — the phone's copy
/// of the shared contract (`shared/src/models/inline-attachments.ts`).
///
/// The text carries one [kAttachmentMarker] (U+FFFC OBJECT REPLACEMENT
/// CHARACTER) per attachment, in order: the n-th marker is the n-th
/// attachment. It is the same character Flutter's text layout uses for a
/// `WidgetSpan` placeholder, so the composer's controller text *is* the text
/// `turn/send` carries — a chip is one character the caret steps over and one
/// backspace deletes. The bridge refuses a message whose markers do not match
/// its attachments one for one.
library;

/// The character that stands for one attachment in a message's text (U+FFFC).
const String kAttachmentMarker = '￼';

/// How many attachment markers [text] holds.
int countAttachmentMarkers(String text) {
  var count = 0;
  for (final unit in text.codeUnits) {
    if (unit == 0xFFFC) count++;
  }
  return count;
}

/// [text] cut at its markers: `n` markers give `n + 1` pieces, so attachment
/// `i` sits between piece `i` and piece `i + 1`.
List<String> splitAtAttachmentMarkers(String text) =>
    text.split(kAttachmentMarker);

/// [text] without any attachment marker — for text pasted or typed from
/// elsewhere, which can never bring an attachment with it.
String stripAttachmentMarkers(String text) =>
    text.replaceAll(kAttachmentMarker, '');

/// [text] fitted to [count] attachments: markers past the [count]-th are
/// removed (their attachments are gone — the bridge would refuse the message),
/// and an attachment with no marker of its own gets one at the end, so a
/// message written before markers existed keeps its attachments.
String fitAttachmentMarkers(String text, int count) {
  final have = countAttachmentMarkers(text);
  if (have == count) return text;
  if (have < count) {
    final missing = kAttachmentMarker * (count - have);
    if (text.isEmpty) return missing;
    final joiner = text.endsWith(' ') || text.endsWith('\n') ? '' : ' ';
    return '$text$joiner$missing';
  }
  final pieces = splitAtAttachmentMarkers(text);
  final buffer = StringBuffer(pieces.first);
  for (var i = 1; i < pieces.length; i++) {
    if (i <= count) buffer.write(kAttachmentMarker);
    buffer.write(pieces[i]);
  }
  return buffer.toString();
}

/// [text] for a place that shows only words (a preview, the clipboard): each
/// marker becomes `[name]` of the attachment it stands for — [names] in order,
/// [fallback] for one without a name or past the end.
String inlineAttachmentsPlainText(
  String text,
  List<String?> names, {
  String fallback = 'attachment',
}) {
  if (!text.contains(kAttachmentMarker)) return text;
  final pieces = splitAtAttachmentMarkers(text);
  final buffer = StringBuffer(pieces.first);
  for (var i = 1; i < pieces.length; i++) {
    final name = i - 1 < names.length ? names[i - 1]?.trim() : null;
    buffer
      ..write('[')
      ..write(name == null || name.isEmpty ? fallback : name)
      ..write(']')
      ..write(pieces[i]);
  }
  return buffer.toString();
}
