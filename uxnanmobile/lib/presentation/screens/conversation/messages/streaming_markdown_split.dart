/// Splits a reply that is still streaming into the part that will never change
/// again and the part still being written.
///
/// **Why this exists.** A streamed reply was rendered as one Markdown body over
/// the whole accumulated text, rebuilt on every delta — so the cost of showing
/// a turn grew with its own length. Measured on a real device (profile build):
/// under 4 500 characters the reply cost 5.4 ms per frame at p95 and dropped 4
/// janky frames out of 2 761; past that it cost 28.1 ms at p95 and dropped 97
/// out of 1 381 — one frame in fourteen, which is what reads as the answer
/// pausing. The raster stayed at 3.7 ms throughout, so the cost is building and
/// laying out widgets, not drawing them.
///
/// Cutting the settled prefix into chunks lets each finished chunk keep its
/// widget instance, which Flutter skips entirely on rebuild; only the last
/// chunk — the one still growing — is rebuilt.
///
/// **The rule is deliberately conservative.** A chunk boundary is only taken at
/// a blank line that is OUTSIDE a fenced code block and is followed by a line
/// that unambiguously starts a new block. Anything that might be a continuation
/// of what came before — a list item, a blockquote, a table row, an indented
/// code line, a link reference definition — is never split, because Markdown
/// parsed in pieces must render exactly as it does whole: splitting between two
/// items of a loose list would turn it into two lists, and splitting inside a
/// fence would turn code into prose.
///
/// Every chunk is a verbatim slice of the source: `split(s).join() == s`.
library;

/// Splits [source] into chunks where every chunk except the last is final:
/// appending more text to [source] can only ever change the last one.
///
/// Returns an empty list for empty input. The concatenation of the result is
/// always exactly [source].
List<String> splitStreamingMarkdown(String source) {
  if (source.isEmpty) return const <String>[];
  final lines = _scanLines(source);
  final chunks = <String>[];
  var chunkStart = 0;
  var fence = '';

  for (var i = 0; i < lines.length; i += 1) {
    final line = lines[i];
    final text = source.substring(line.start, line.contentEnd);
    if (fence.isEmpty) {
      final opened = _fenceMarker(text);
      if (opened != null) {
        fence = opened;
        continue;
      }
    } else {
      // Inside a fence nothing is a boundary — not even a blank line.
      if (_closesFence(text, fence)) fence = '';
      continue;
    }
    if (text.trim().isNotEmpty) continue;
    if (!_startsFreshBlock(source, lines, i + 1)) continue;
    chunks.add(source.substring(chunkStart, line.end));
    chunkStart = line.end;
  }

  if (chunkStart < source.length) chunks.add(source.substring(chunkStart));
  return chunks;
}

/// A line's bounds: [start]..[contentEnd] is the text, [end] includes its
/// newline (so slices rejoin into the original exactly).
typedef _Line = ({int start, int contentEnd, int end});

List<_Line> _scanLines(String source) {
  final lines = <_Line>[];
  var start = 0;
  for (var i = 0; i < source.length; i += 1) {
    if (source.codeUnitAt(i) != 0x0a) continue;
    final contentEnd =
        i > start && source.codeUnitAt(i - 1) == 0x0d ? i - 1 : i;
    lines.add((start: start, contentEnd: contentEnd, end: i + 1));
    start = i + 1;
  }
  if (start < source.length) {
    lines.add((start: start, contentEnd: source.length, end: source.length));
  }
  return lines;
}

/// The fence marker a line opens (```` ``` ```` or `~~~`), or null.
String? _fenceMarker(String line) {
  final trimmed = line.trimLeft();
  // Four or more leading spaces is an indented code block, not a fence.
  if (line.length - trimmed.length > 3) {
    return null;
  }
  for (final marker in const ['```', '~~~']) {
    if (trimmed.startsWith(marker)) {
      var length = 0;
      while (length < trimmed.length && trimmed[length] == marker[0]) {
        length += 1;
      }
      return marker[0] * length;
    }
  }
  return null;
}

/// Whether [line] closes an open [fence] (same character, at least as long, and
/// nothing after it).
bool _closesFence(String line, String fence) {
  final trimmed = line.trim();
  if (trimmed.isEmpty || trimmed[0] != fence[0]) return false;
  var length = 0;
  while (length < trimmed.length && trimmed[length] == fence[0]) {
    length += 1;
  }
  return length >= fence.length && trimmed.substring(length).trim().isEmpty;
}

/// A line that may continue the block above it, so nothing may be cut
/// before it.
final RegExp _continuation = RegExp(
  r'^(?: {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)'
  '| {0,3}>'
  r'| {0,3}\|'
  r'|(?: {4,}|\t)'
  r'| {0,3}\[[^\]]*\]:)',
);

/// Whether the first non-blank line at or after [from] starts a block that can
/// stand on its own. Trailing blank lines alone are never a boundary: the reply
/// has not written what follows them yet.
bool _startsFreshBlock(String source, List<_Line> lines, int from) {
  for (var i = from; i < lines.length; i += 1) {
    final text = source.substring(lines[i].start, lines[i].contentEnd);
    if (text.trim().isEmpty) continue;
    return !_continuation.hasMatch(text);
  }
  return false;
}
