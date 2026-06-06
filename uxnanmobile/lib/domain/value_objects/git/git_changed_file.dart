import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';

/// A single changed file in a repository's working tree (spec 02a §5.5).
class GitChangedFile extends Equatable {
  /// Creates a [GitChangedFile].
  const GitChangedFile({
    required this.path,
    required this.status,
    this.additions = 0,
    this.deletions = 0,
  });

  /// Reconstructs a [GitChangedFile] from its JSON form. An unknown status
  /// string falls back to [GitFileStatus.modified].
  factory GitChangedFile.fromJson(Map<String, dynamic> json) => GitChangedFile(
        path: json['path'] as String? ?? '',
        status: _status(json['status'] as String?),
        additions:
            json['additions'] is num ? (json['additions'] as num).toInt() : 0,
        deletions:
            json['deletions'] is num ? (json['deletions'] as num).toInt() : 0,
      );

  /// Repository-relative file path.
  final String path;

  /// Working-tree status of the file.
  final GitFileStatus status;

  /// Lines added in this file.
  final int additions;

  /// Lines removed from this file.
  final int deletions;

  static GitFileStatus _status(String? name) {
    for (final value in GitFileStatus.values) {
      if (value.name == name) return value;
    }
    return GitFileStatus.modified;
  }

  @override
  List<Object?> get props => [path, status, additions, deletions];
}
