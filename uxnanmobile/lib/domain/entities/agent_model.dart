import 'package:equatable/equatable.dart';

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
      return AgentModel(
        id: id,
        displayName:
            displayName != null && displayName.isNotEmpty ? displayName : id,
        description:
            description != null && description.isNotEmpty ? description : null,
        version: version != null && version.isNotEmpty ? version : null,
        isDefault: json['isDefault'] == true,
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

  @override
  List<Object?> get props => [id, displayName, description, version, isDefault];
}
