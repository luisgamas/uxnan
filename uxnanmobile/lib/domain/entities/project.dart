import 'package:equatable/equatable.dart';

/// A project the bridge exposes for starting threads (`project/list`).
///
/// Mirrors the bridge contract `Project = { id, name, cwd, agentId? }`. The
/// parser is tolerant so the app degrades gracefully against newer bridges.
class Project extends Equatable {
  /// Creates a [Project].
  const Project({
    required this.id,
    required this.name,
    required this.cwd,
    this.agentId,
  });

  /// Reconstructs a [Project] from a `project/list` entry.
  factory Project.fromJson(Map<String, dynamic> json) => Project(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? json['id'] as String? ?? '',
        cwd: json['cwd'] as String? ?? '',
        agentId: json['agentId'] as String?,
      );

  /// Unique project identifier.
  final String id;

  /// Human readable project name.
  final String name;

  /// Working directory on the PC.
  final String cwd;

  /// Default agent wire id for the project, if any.
  final String? agentId;

  @override
  List<Object?> get props => [id, name, cwd, agentId];
}
