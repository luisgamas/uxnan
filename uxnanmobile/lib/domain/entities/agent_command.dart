import 'package:equatable/equatable.dart';

/// A special ("slash") command an agent exposes (`agent/commands`).
///
/// Mirrors the bridge contract `AgentCommand = { name, description?,
/// argumentHint?, source, headlessSupported? }`. The app is a generic renderer:
/// it lists the advertised commands in the composer's `/` palette and, when one
/// is picked, sends it back on `turn/send` under `command` (the bridge resolves
/// it to the final prompt). Parsing is tolerant so a newer bridge advertising a
/// richer command never breaks the app.
class AgentCommand extends Equatable {
  /// Creates an [AgentCommand].
  const AgentCommand({
    required this.name,
    this.description,
    this.argumentHint,
    this.source = 'custom',
    this.headlessSupported = true,
  });

  /// Builds a command from a JSON map, or null when it has no usable `name`.
  static AgentCommand? fromAny(Object? raw) {
    if (raw is! Map) return null;
    final json = raw.cast<String, dynamic>();
    final name = (json['name'] as String?)?.trim();
    if (name == null || name.isEmpty) return null;
    final description = (json['description'] as String?)?.trim();
    final argumentHint = (json['argumentHint'] as String?)?.trim();
    final source = (json['source'] as String?)?.trim();
    return AgentCommand(
      name: name,
      description:
          description != null && description.isNotEmpty ? description : null,
      argumentHint:
          argumentHint != null && argumentHint.isNotEmpty ? argumentHint : null,
      source: source != null && source.isNotEmpty ? source : 'custom',
      // Absent → supported (the bridge only advertises what it can run).
      headlessSupported: json['headlessSupported'] != false,
    );
  }

  /// Command name without the leading slash (e.g. `compact`, `refactor`).
  final String name;

  /// One-line description for the palette, when the source provides one.
  final String? description;

  /// Hint for the arguments the command accepts (e.g. `<file>`).
  final String? argumentHint;

  /// Where the command comes from: `acp`, `builtin`, or `custom`.
  final String source;

  /// Whether the command runs headless; `false` → the palette hides it.
  final bool headlessSupported;

  @override
  List<Object?> get props =>
      [name, description, argumentHint, source, headlessSupported];
}
