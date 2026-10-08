/// Mobile mirror of shared/src/models/view.ts and
/// shared/src/views/view-protocol.ts. Keep wire bounds and annotation text in
/// sync with those contracts.
const int viewMinHeight = 80;
const int viewMaxHeight = 1600;
const int viewDefaultHeight = 320;
const int viewMaxTitleLength = 120;
const int viewMaxHtmlBytes = 512 * 1024;
const int viewMaxSelectorLength = 300;
const int viewMaxAnnotationTextLength = 500;
const int viewMaxAnnotationHtmlLength = 1000;

const List<String> viewThemeVariables = [
  '--color-background-primary',
  '--color-background-secondary',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-border-primary',
  '--color-ring-primary',
  '--color-background-info',
  '--color-background-danger',
  '--color-background-success',
  '--color-background-warning',
  '--font-sans',
  '--font-mono',
  '--border-radius-sm',
  '--border-radius-md',
  '--border-radius-lg',
];

/// Clamps an agent or page-reported height to the shared inline range.
int clampViewHeight(num? height) {
  if (height == null || !height.isFinite) return viewDefaultHeight;
  return height.round().clamp(viewMinHeight, viewMaxHeight);
}

/// An element selected from a view while annotation mode is active.
class ViewAnnotation {
  const ViewAnnotation({
    required this.selector,
    required this.tag,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    this.text,
    this.html,
  });

  final String selector;
  final String tag;
  final String? text;
  final String? html;
  final double x;
  final double y;
  final double width;
  final double height;

  /// Validates the shared protocol shape and bounds at the WebView boundary.
  static ViewAnnotation? parse(Object? value) {
    if (value is! Map) return null;
    final selector = value['selector'];
    final tag = value['tag'];
    final text = value['text'];
    final html = value['html'];
    final rect = value['rect'];
    if (selector is! String ||
        selector.isEmpty ||
        selector.length > viewMaxSelectorLength) {
      return null;
    }
    if (tag is! String || !RegExp(r'^[a-z][a-z0-9-]{0,40}$').hasMatch(tag)) {
      return null;
    }
    if (text != null &&
        (text is! String || text.length > viewMaxAnnotationTextLength)) {
      return null;
    }
    if (html != null &&
        (html is! String || html.length > viewMaxAnnotationHtmlLength)) {
      return null;
    }
    if (rect is! Map) return null;
    double? number(String key) {
      final value = rect[key];
      return value is num && value.isFinite ? value.toDouble() : null;
    }

    final x = number('x');
    final y = number('y');
    final width = number('width');
    final height = number('height');
    if (x == null || y == null || width == null || height == null) return null;
    return ViewAnnotation(
      selector: selector,
      tag: tag,
      text: text as String?,
      html: html as String?,
      x: x,
      y: y,
      width: width,
      height: height,
    );
  }

  Map<String, Object?> toJson() => {
        'selector': selector,
        'tag': tag,
        if (text != null) 'text': text,
        if (html != null) 'html': html,
        'rect': {'x': x, 'y': y, 'width': width, 'height': height},
      };
}

/// Mirrors shared/src/views/view-protocol.ts `isViewAnnotation`.
bool isViewAnnotation(Object? value) => ViewAnnotation.parse(value) != null;

/// Mirrors `formatViewAnnotations` exactly so the same picks read the same in
/// either client.
String formatViewAnnotations(
  String title,
  List<({ViewAnnotation annotation, String note})> notes,
) {
  final lines = ['On the view "$title":'];
  for (var index = 0; index < notes.length; index++) {
    final entry = notes[index];
    final annotation = entry.annotation;
    lines
      ..add('')
      ..add('${index + 1}. `${annotation.selector}` (<${annotation.tag}>)');
    if (annotation.text case final text? when text.isNotEmpty) {
      lines.add('   Text: ${text.replaceAll(RegExp(r'\s+'), ' ')}');
    }
    final note = entry.note.trim();
    if (note.isNotEmpty) lines.add('   Note: $note');
  }
  return lines.join('\n');
}
