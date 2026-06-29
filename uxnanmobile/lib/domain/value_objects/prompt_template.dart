import 'package:equatable/equatable.dart';

/// A user-authored `/` command-palette prompt template — a reusable snippet the
/// composer drops into the message. Single-language (whatever the user typed),
/// persisted locally; the shipped defaults are seeded in the app's language on
/// first run and are themselves editable.
class PromptTemplate extends Equatable {
  /// Creates a [PromptTemplate].
  const PromptTemplate({
    required this.id,
    required this.label,
    required this.body,
  });

  /// Reconstructs a [PromptTemplate] from its JSON form.
  factory PromptTemplate.fromJson(Map<String, dynamic> json) => PromptTemplate(
        id: json['id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        body: json['body'] as String? ?? '',
      );

  /// Stable id (also what `/<query>` matches against).
  final String id;

  /// Short display name shown in the palette.
  final String label;

  /// The text inserted into the composer when picked.
  final String body;

  /// Serializes this template to JSON.
  Map<String, dynamic> toJson() => {'id': id, 'label': label, 'body': body};

  /// Returns a copy with [label] / [body] overridden (the id is preserved).
  PromptTemplate copyWith({String? label, String? body}) => PromptTemplate(
        id: id,
        label: label ?? this.label,
        body: body ?? this.body,
      );

  @override
  List<Object?> get props => [id, label, body];
}
