import 'package:equatable/equatable.dart';

/// One selectable value of an [AgentModelOption] of kind `enum`.
class AgentModelOptionValue extends Equatable {
  /// Creates an [AgentModelOptionValue].
  const AgentModelOptionValue({required this.value, required this.label});

  /// Builds a value from a JSON map, or null when it has no usable `value`.
  static AgentModelOptionValue? fromAny(Object? raw) {
    if (raw is! Map) return null;
    final json = raw.cast<String, dynamic>();
    final value = (json['value'] as String?)?.trim();
    if (value == null || value.isEmpty) return null;
    final label = json['label'] as String?;
    return AgentModelOptionValue(
      value: value,
      label: label != null && label.isNotEmpty ? label : value,
    );
  }

  /// Value sent back in `turn/send` `options` when chosen.
  final String value;

  /// Human-facing label (falls back to [value]).
  final String label;

  @override
  List<Object?> get props => [value, label];
}

/// A per-model run-option "knob" the bridge advertises (e.g. reasoning effort).
///
/// Mirrors the contract `AgentModelOption = { key, kind: 'enum'|'toggle',
/// label, values?, default? }`. The app is a generic renderer: it shows the
/// advertised knobs and sends chosen values on `turn/send` keyed by [key]. An
/// unknown [kind] is parsed but should be ignored by the UI (forward-compat).
class AgentModelOption extends Equatable {
  /// Creates an [AgentModelOption].
  const AgentModelOption({
    required this.key,
    required this.kind,
    required this.label,
    this.values = const [],
    this.defaultValue,
  });

  /// Builds an option from a JSON map, or null when it has no usable `key`.
  static AgentModelOption? fromAny(Object? raw) {
    if (raw is! Map) return null;
    final json = raw.cast<String, dynamic>();
    final key = (json['key'] as String?)?.trim();
    if (key == null || key.isEmpty) return null;
    final kind = (json['kind'] as String?)?.trim();
    if (kind == null || kind.isEmpty) return null;
    final label = json['label'] as String?;
    final rawValues = json['values'];
    final values = rawValues is List
        ? [
            for (final v in rawValues)
              if (AgentModelOptionValue.fromAny(v) case final value?) value,
          ]
        : const <AgentModelOptionValue>[];
    return AgentModelOption(
      key: key,
      kind: kind,
      label: label != null && label.isNotEmpty ? label : key,
      values: values,
      defaultValue: json['default'],
    );
  }

  /// Stable key echoed back in `turn/send` `options` (e.g. `reasoning`).
  final String key;

  /// Control kind (`enum`, `toggle`, …). Unknown kinds should be ignored.
  final String kind;

  /// Human-facing label.
  final String label;

  /// For `enum`: the selectable values.
  final List<AgentModelOptionValue> values;

  /// Default value when the agent reports one (`String` or `bool`).
  final Object? defaultValue;

  @override
  List<Object?> get props => [key, kind, label, values, defaultValue];
}

/// A selectable model an agent reports (`agent/models`).
///
/// Mirrors the bridge contract `AgentModel = { id, displayName, description?,
/// version?, isDefault? }`. [id] is the routing key sent back to the agent
/// (a Claude alias like `opus`, a `provider/model` for OpenCode, or a concrete
/// model id for Codex). Parsing is tolerant: older bridges report bare id
/// strings, which [AgentModel.fromAny] still accepts.
class AgentModel extends Equatable {
  /// Creates an [AgentModel].
  const AgentModel({
    required this.id,
    required this.displayName,
    this.description,
    this.version,
    this.isDefault = false,
    this.options = const [],
  });

  /// Builds an [AgentModel] from a JSON map (the structured contract) or a bare
  /// string (legacy bridges), returning null when neither yields a usable id.
  static AgentModel? fromAny(Object? raw) {
    if (raw is String) {
      final id = raw.trim();
      return id.isEmpty ? null : AgentModel(id: id, displayName: id);
    }
    if (raw is Map) {
      final json = raw.cast<String, dynamic>();
      final id = (json['id'] as String?)?.trim();
      if (id == null || id.isEmpty) return null;
      final displayName = json['displayName'] as String?;
      final description = json['description'] as String?;
      final version = json['version'] as String?;
      final rawOptions = json['options'];
      final options = rawOptions is List
          ? [
              for (final o in rawOptions)
                if (AgentModelOption.fromAny(o) case final option?) option,
            ]
          : const <AgentModelOption>[];
      return AgentModel(
        id: id,
        displayName:
            displayName != null && displayName.isNotEmpty ? displayName : id,
        description:
            description != null && description.isNotEmpty ? description : null,
        version: version != null && version.isNotEmpty ? version : null,
        isDefault: json['isDefault'] == true,
        options: options,
      );
    }
    return null;
  }

  /// Routing key sent back to the agent to select this model.
  final String id;

  /// Human-facing label (falls back to [id]).
  final String displayName;

  /// One-line description, when the agent provides one.
  final String? description;

  /// Concrete version an alias resolves to (e.g. `opus` → `claude-opus-4-8`).
  final String? version;

  /// Whether this is the agent's current default model.
  final bool isDefault;

  /// Per-model run-option knobs (reasoning effort, etc.); empty when none.
  final List<AgentModelOption> options;

  @override
  List<Object?> get props =>
      [id, displayName, description, version, isDefault, options];
}
