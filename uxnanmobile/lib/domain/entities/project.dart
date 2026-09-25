import 'package:equatable/equatable.dart';

/// A project in a PC's bridge registry (`project/list`, `sync/changes`,
/// architecture/02a §5.8.17) — the same list Uxnan Desktop shows on that PC.
///
/// Mirrors the bridge contract
/// `Project = { id, name, cwd, agentId?, source? }`. The parser is tolerant so
/// the app degrades gracefully against newer bridges.
class Project extends Equatable {
  /// Creates a [Project].
  const Project({
    required this.id,
    required this.name,
    required this.cwd,
    this.agentId,
    this.source,
  });

  /// Reconstructs a [Project] from a `project/list` entry.
  factory Project.fromJson(Map<String, dynamic> json) => Project(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? json['id'] as String? ?? '',
        cwd: json['cwd'] as String? ?? '',
        agentId: json['agentId'] as String?,
        source: json['source'] as String?,
      );

  /// Unique project identifier.
  final String id;

  /// Human readable project name.
  final String name;

  /// Working directory on the PC.
  final String cwd;

  /// Default agent wire id for the project, if any.
  final String? agentId;

  /// How it entered the registry (`user`, `desktop`, `thread`, `config`);
  /// absent for a folder nobody registered (a `project/resolve` answer).
  final String? source;

  @override
  List<Object?> get props => [id, name, cwd, agentId, source];
}
