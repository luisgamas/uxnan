// `buildTextSpan` overrides TextEditingController's signature, whose optional
// `style` sits between two required params — the override can't reorder them.
// ignore_for_file: always_put_required_named_parameters_first
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/inline_attachments.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/attachment_chip.dart';

// FOR-DEV: verified by widget tests only — IME composition next to a chip and
// selection handles over one still need a Gboard / iOS keyboard run
// (uxnanmobile/FOR-DEV.md → Composer chips on a real keyboard).
/// The composer's text and the images and files written into it — one owner
/// for both, because they are one message: each attachment is a chip at the
/// place it was put, and the text holds one [kAttachmentMarker] (U+FFFC) for
/// it, exactly as `turn/send` carries it.
///
/// U+FFFC is also the character Flutter's text layout reserves for a
/// `WidgetSpan`, so [buildTextSpan] simply draws an [AttachmentChip] for each
/// marker: the caret steps over a chip as one character, one backspace
/// deletes it, and every selection offset is a plain index of [text].
///
/// Every edit is reconciled against the text it replaced (common prefix and
/// suffix, anchored at the caret where identical neighbours make that
/// ambiguous): a marker that left the text takes its attachment with it, and a
/// marker that arrived by typing or pasting — which can never carry an
/// attachment — is stripped. Only [insertAttachments] and [setContents] add
/// chips.
///
/// `@`-file mentions are drawn as inline code-style badges, purely visually:
/// the sent prompt keeps the raw `@path`.
class ComposerTextController extends TextEditingController {
  /// Creates a [ComposerTextController], optionally seeded with [text] (never
  /// with chips: [setContents] places those).
  ComposerTextController({String? text})
      : super(text: text == null ? null : stripAttachmentMarkers(text));

  final List<AttachmentContent> _attachments = [];

  /// Set while the controller writes its own value (no reconciliation).
  bool _applying = false;

  /// Opens the chip of the attachment at the given index (its preview and
  /// the remove action). Set by the composer.
  ValueChanged<int>? onChipTap;

  /// The images and files of the message, in the order of their markers.
  List<AttachmentContent> get attachments => List.unmodifiable(_attachments);

  /// Whether the message carries any image or file.
  bool get hasAttachments => _attachments.isNotEmpty;

  /// How many images the message carries.
  int get imageCount => _attachments.where((a) => a.isImage).length;

  /// How many files (not images) the message carries.
  int get fileCount => _attachments.where((a) => !a.isImage).length;

  /// `@` token: `@` followed by one or more non-space, non-`@` chars. The
  /// leading word boundary is checked separately (so an email like `a@b` is
  /// not styled).
  static final RegExp _mention = RegExp(r'@[^\s@￼]+');

  @override
  set value(TextEditingValue newValue) {
    if (_applying) {
      super.value = newValue;
      return;
    }
    super.value = _reconcile(super.value, newValue);
  }

  void _write(TextEditingValue next) {
    _applying = true;
    try {
      super.value = next;
    } finally {
      _applying = false;
    }
  }

  /// [next] as the edit of [previous] it is: attachments whose markers it
  /// removed are dropped, markers it brought are stripped.
  TextEditingValue _reconcile(
    TextEditingValue previous,
    TextEditingValue next,
  ) {
    final old = previous.text;
    final now = next.text;
    if (old == now) return next;

    final shortest = math.min(old.length, now.length);
    var prefix = 0;
    while (
        prefix < shortest && old.codeUnitAt(prefix) == now.codeUnitAt(prefix)) {
      prefix++;
    }
    // An edit happens at the caret: when the characters around it repeat
    // (two chips side by side), the common prefix can run past it, and the
    // edit would be pinned on the wrong neighbour.
    final caret = next.selection;
    if (caret.isValid) prefix = math.min(prefix, caret.start);
    var suffix = 0;
    while (suffix < old.length - prefix &&
        suffix < now.length - prefix &&
        old.codeUnitAt(old.length - 1 - suffix) ==
            now.codeUnitAt(now.length - 1 - suffix)) {
      suffix++;
    }

    final removedEnd = old.length - suffix;
    final firstRemoved = countAttachmentMarkers(old.substring(0, prefix));
    final removed = countAttachmentMarkers(old.substring(prefix, removedEnd));
    if (removed > 0) {
      _attachments.removeRange(
        math.min(firstRemoved, _attachments.length),
        math.min(firstRemoved + removed, _attachments.length),
      );
    }

    final insertedEnd = now.length - suffix;
    final inserted = now.substring(prefix, insertedEnd);
    final stray = countAttachmentMarkers(inserted);
    if (stray == 0) return next;
    final cleaned = stripAttachmentMarkers(inserted);
    int map(int offset) {
      if (offset <= prefix) return offset;
      if (offset >= insertedEnd) return offset - stray;
      return prefix +
          stripAttachmentMarkers(now.substring(prefix, offset)).length;
    }

    TextSelection mapSelection(TextSelection s) => s.isValid
        ? s.copyWith(
            baseOffset: map(s.baseOffset),
            extentOffset: map(s.extentOffset),
          )
        : s;
    return TextEditingValue(
      text: now.substring(0, prefix) + cleaned + now.substring(insertedEnd),
      selection: mapSelection(next.selection),
    );
  }

  /// Writes [items] as chips at the caret (at the end before the field was
  /// ever focused), replacing a selected range, each set apart from the words
  /// around it by a space. An image without a name is named `image-<n>`.
  void insertAttachments(List<AttachmentContent> items) {
    if (items.isEmpty) return;
    final current = value;
    final text = current.text;
    final selection = current.selection;
    final start = selection.isValid ? selection.start : text.length;
    final end = selection.isValid ? selection.end : text.length;

    final before = text.substring(0, start);
    final after = text.substring(end);
    final firstIndex = countAttachmentMarkers(before);
    final replaced = countAttachmentMarkers(text.substring(start, end));
    _attachments.removeRange(firstIndex, firstIndex + replaced);

    final named = <AttachmentContent>[];
    for (final item in items) {
      named.add(_named(item, [..._attachments, ...named]));
    }
    _attachments.insertAll(firstIndex, named);

    final lead =
        before.isEmpty || _isSpace(before[before.length - 1]) ? '' : ' ';
    final chips = List.filled(named.length, kAttachmentMarker).join(' ');
    final trail = after.isNotEmpty && _isSpace(after[0]) ? '' : ' ';
    final insertion = '$lead$chips$trail';
    final caret = before.length + insertion.length;
    _write(
      TextEditingValue(
        text: '$before$insertion$after',
        selection: TextSelection.collapsed(offset: caret),
      ),
    );
  }

  /// Takes the attachment at [index] out of the message: its chip, and the
  /// space that set it apart when one is left doubled.
  void removeAttachmentAt(int index) {
    if (index < 0 || index >= _attachments.length) return;
    final text = this.text;
    final at = markerOffset(index);
    if (at < 0) return;
    var start = at;
    var end = at + 1;
    // "a ⟨chip⟩ b" becomes "a b", not "a  b"; a chip at an edge takes its
    // one neighbouring space.
    final spaceBefore = start > 0 && text[start - 1] == ' ';
    final spaceAfter = end < text.length && text[end] == ' ';
    if (spaceAfter && (spaceBefore || start == 0)) {
      end++;
    } else if (spaceBefore && end == text.length) {
      start--;
    }
    _attachments.removeAt(index);
    final selection = this.selection;
    int shift(int offset) {
      if (offset <= start) return offset;
      if (offset >= end) return offset - (end - start);
      return start;
    }

    _write(
      TextEditingValue(
        text: text.substring(0, start) + text.substring(end),
        selection: selection.isValid
            ? TextSelection(
                baseOffset: shift(selection.baseOffset),
                extentOffset: shift(selection.extentOffset),
              )
            : TextSelection.collapsed(offset: start),
      ),
    );
  }

  /// Replaces the whole message: [text] with [attachments] at its markers —
  /// a queued message handed back, or a saved draft. A marker whose
  /// attachment is gone is removed and an attachment without one is placed at
  /// the end ([fitAttachmentMarkers]). The caret goes to the end.
  void setContents(String text, List<AttachmentContent> attachments) {
    final fitted = fitAttachmentMarkers(text, attachments.length);
    _attachments
      ..clear()
      ..addAll(attachments);
    _write(
      TextEditingValue(
        text: fitted,
        selection: TextSelection.collapsed(offset: fitted.length),
      ),
    );
  }

  /// Offset in [text] of the marker of the attachment at [index], or -1.
  int markerOffset(int index) {
    var seen = 0;
    for (var i = 0; i < text.length; i++) {
      if (text.codeUnitAt(i) != 0xFFFC) continue;
      if (seen == index) return i;
      seen++;
    }
    return -1;
  }

  AttachmentContent _named(
    AttachmentContent item,
    List<AttachmentContent> others,
  ) {
    final name = item.name?.trim();
    if (name != null && name.isNotEmpty) return item;
    if (!item.isImage) return item.withName('file');
    final taken = {for (final other in others) other.name};
    final ext = _imageExtension(item.mimeType);
    var n = others.where((o) => o.isImage).length + 1;
    while (taken.contains('image-$n.$ext')) {
      n++;
    }
    return item.withName('image-$n.$ext');
  }

  @override
  TextSpan buildTextSpan({
    required BuildContext context,
    TextStyle? style,
    required bool withComposing,
  }) {
    final base = style ?? const TextStyle();
    final composing = withComposing &&
            value.isComposingRangeValid &&
            !value.composing.isCollapsed
        ? value.composing
        : null;
    final colors = Theme.of(context).colorScheme;
    final mentionStyle = base.copyWith(
      fontFamily: UxnanTypography.monoFontFamily,
      color: colors.primary,
      backgroundColor: colors.primary.withValues(alpha: 0.10),
      fontWeight: FontWeight.w500,
    );

    final spans = <InlineSpan>[];
    var chip = 0;
    var start = 0;
    for (var i = 0; i <= text.length; i++) {
      final atEnd = i == text.length;
      if (!atEnd && text.codeUnitAt(i) != 0xFFFC) continue;
      if (i > start) {
        _addText(spans, start, i, base, mentionStyle, composing);
      }
      if (!atEnd) {
        final index = chip++;
        spans.add(
          WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: index < _attachments.length
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 1),
                    child: AttachmentChip(
                      key: ValueKey('composer-chip-$index'),
                      attachment: _attachments[index],
                      onTap: onChipTap == null ? null : () => onChipTap!(index),
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        );
      }
      start = i + 1;
    }
    if (spans.isEmpty) return TextSpan(text: '', style: base);
    if (spans.length == 1 && spans.first is TextSpan && chip == 0) {
      final only = spans.first as TextSpan;
      if (only.children == null && only.style == base) {
        return TextSpan(text: only.text, style: base);
      }
    }
    return TextSpan(style: base, children: spans);
  }

  /// The text run [from]..[to] (no markers in it): `@` mentions styled, or —
  /// while an IME composes inside it — the composing range underlined.
  void _addText(
    List<InlineSpan> spans,
    int from,
    int to,
    TextStyle base,
    TextStyle mentionStyle,
    TextRange? composing,
  ) {
    if (composing != null && composing.start < to && composing.end > from) {
      final cStart = math.max(composing.start, from);
      final cEnd = math.min(composing.end, to);
      if (cStart > from) {
        spans.add(TextSpan(text: text.substring(from, cStart), style: base));
      }
      spans.add(
        TextSpan(
          text: text.substring(cStart, cEnd),
          style: base.merge(
            const TextStyle(decoration: TextDecoration.underline),
          ),
        ),
      );
      if (to > cEnd) {
        spans.add(TextSpan(text: text.substring(cEnd, to), style: base));
      }
      return;
    }
    final run = text.substring(from, to);
    var last = 0;
    for (final match in _mention.allMatches(run)) {
      final absolute = from + match.start;
      final boundaryOk = absolute == 0 || _isSpace(text[absolute - 1]);
      if (!boundaryOk) continue;
      if (match.start > last) {
        spans
            .add(TextSpan(text: run.substring(last, match.start), style: base));
      }
      spans.add(
        TextSpan(
          text: run.substring(match.start, match.end),
          style: mentionStyle,
        ),
      );
      last = match.end;
    }
    if (last < run.length) {
      spans.add(TextSpan(text: run.substring(last), style: base));
    }
  }

  static bool _isSpace(String ch) => ch.trim().isEmpty;

  static String _imageExtension(String mimeType) =>
      switch (mimeType.toLowerCase()) {
        'image/png' => 'png',
        'image/gif' => 'gif',
        'image/webp' => 'webp',
        'image/heic' => 'heic',
        'image/bmp' => 'bmp',
        _ => 'jpg',
      };
}
