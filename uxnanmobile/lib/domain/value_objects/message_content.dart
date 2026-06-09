import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/approval_risk.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/plan_step_status.dart';
import 'package:uxnan/domain/enums/subagent_action_kind.dart';
import 'package:uxnan/domain/enums/system_content_kind.dart';

/// A single block of message content (spec 02a §6.2).
///
/// Serialized as JSON with a `type` discriminator. The central
/// [MessageContent.fromJson] factory dispatches on `type`; any unrecognized
/// type round-trips losslessly as an [UnknownContent], so newer bridge content
/// never breaks decoding. The advanced `approval` / `plan` / `subagent` types
/// decode into [ApprovalContent] / [PlanContent] / [SubagentContent] and are
/// tolerant of both nested (`{request|state: {...}}`) and flat payloads.
sealed class MessageContent {
  const MessageContent();

  /// Decodes a [MessageContent] from its JSON form, dispatching on `type`.
  factory MessageContent.fromJson(Map<String, dynamic> json) {
    return switch (json['type']) {
      TextContent.typeName => TextContent.fromJson(json),
      CodeContent.typeName => CodeContent.fromJson(json),
      ImageContent.typeName => ImageContent.fromJson(json),
      ToolUseContent.typeName => ToolUseContent.fromJson(json),
      DiffContent.typeName => DiffContent.fromJson(json),
      MermaidContent.typeName => MermaidContent.fromJson(json),
      SystemContent.typeName => SystemContent.fromJson(json),
      CommandExecutionContent.typeName =>
        CommandExecutionContent.fromJson(json),
      ApprovalContent.typeName => ApprovalContent.fromJson(json),
      PlanContent.typeName => PlanContent.fromJson(json),
      SubagentContent.typeName => SubagentContent.fromJson(json),
      _ => UnknownContent(
          type: json['type'] is String ? json['type'] as String : 'unknown',
          raw: json,
        ),
    };
  }

  /// The wire `type` discriminator.
  String get type;

  /// Plain-text projection of this content (for previews and fingerprinting).
  String get asPlainText;

  /// Serializes this content to JSON.
  Map<String, dynamic> toJson();
}

/// Plain or streaming text.
class TextContent extends MessageContent with EquatableMixin {
  /// Creates a [TextContent].
  const TextContent(this.text, {this.isStreaming = false});

  /// Decodes a [TextContent].
  factory TextContent.fromJson(Map<String, dynamic> json) => TextContent(
        json['text'] as String? ?? '',
        isStreaming: json['isStreaming'] as bool? ?? false,
      );

  /// The text.
  final String text;

  /// Whether this text is still streaming in.
  final bool isStreaming;

  /// Wire type discriminator.
  static const String typeName = 'text';

  @override
  String get type => typeName;

  @override
  String get asPlainText => text;

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'text': text,
        'isStreaming': isStreaming,
      };

  @override
  List<Object?> get props => [text, isStreaming];
}

/// A code block.
class CodeContent extends MessageContent with EquatableMixin {
  /// Creates a [CodeContent].
  const CodeContent(this.code, {this.language, this.filename});

  /// Decodes a [CodeContent].
  factory CodeContent.fromJson(Map<String, dynamic> json) => CodeContent(
        json['code'] as String? ?? '',
        language: json['language'] as String?,
        filename: json['filename'] as String?,
      );

  /// The code.
  final String code;

  /// Programming language, if known.
  final String? language;

  /// Source filename, if known.
  final String? filename;

  /// Wire type discriminator.
  static const String typeName = 'code';

  @override
  String get type => typeName;

  @override
  String get asPlainText => code;

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'code': code,
        if (language != null) 'language': language,
        if (filename != null) 'filename': filename,
      };

  @override
  List<Object?> get props => [code, language, filename];
}

/// An image, either by workspace path or inline base64.
class ImageContent extends MessageContent with EquatableMixin {
  /// Creates an [ImageContent].
  const ImageContent({
    required this.mimeType,
    this.path,
    this.base64Data,
    this.width,
    this.height,
  });

  /// Decodes an [ImageContent].
  factory ImageContent.fromJson(Map<String, dynamic> json) => ImageContent(
        mimeType: json['mimeType'] as String? ?? 'application/octet-stream',
        path: json['path'] as String?,
        base64Data: json['base64Data'] as String?,
        width: json['width'] as int?,
        height: json['height'] as int?,
      );

  /// Workspace path, if any.
  final String? path;

  /// Inline base64 data, if any.
  final String? base64Data;

  /// MIME type.
  final String mimeType;

  /// Pixel width, if known.
  final int? width;

  /// Pixel height, if known.
  final int? height;

  /// Wire type discriminator.
  static const String typeName = 'image';

  @override
  String get type => typeName;

  @override
  String get asPlainText => '[image]';

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'mimeType': mimeType,
        if (path != null) 'path': path,
        if (base64Data != null) 'base64Data': base64Data,
        if (width != null) 'width': width,
        if (height != null) 'height': height,
      };

  @override
  List<Object?> get props => [path, base64Data, mimeType, width, height];
}

/// An agent tool invocation and its result.
class ToolUseContent extends MessageContent with EquatableMixin {
  /// Creates a [ToolUseContent].
  const ToolUseContent({
    required this.toolName,
    required this.toolId,
    required this.input,
    this.output,
    this.isError = false,
  });

  /// Decodes a [ToolUseContent].
  factory ToolUseContent.fromJson(Map<String, dynamic> json) => ToolUseContent(
        toolName: json['toolName'] as String? ?? '',
        toolId: json['toolId'] as String? ?? '',
        input: (json['input'] as Map?)?.cast<String, dynamic>() ?? const {},
        output: json['output'],
        isError: json['isError'] as bool? ?? false,
      );

  /// Tool name.
  final String toolName;

  /// Tool invocation id.
  final String toolId;

  /// Tool input arguments.
  final Map<String, dynamic> input;

  /// Tool output, if any.
  final Object? output;

  /// Whether the tool reported an error.
  final bool isError;

  /// Wire type discriminator.
  static const String typeName = 'tool';

  @override
  String get type => typeName;

  @override
  String get asPlainText => '[tool: $toolName]';

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'toolName': toolName,
        'toolId': toolId,
        'input': input,
        if (output != null) 'output': output,
        'isError': isError,
      };

  @override
  List<Object?> get props => [toolName, toolId, input, output, isError];
}

/// A unified diff for a single file.
class DiffContent extends MessageContent with EquatableMixin {
  /// Creates a [DiffContent].
  const DiffContent({
    required this.filename,
    required this.diff,
    this.additions = 0,
    this.deletions = 0,
  });

  /// Decodes a [DiffContent].
  factory DiffContent.fromJson(Map<String, dynamic> json) => DiffContent(
        filename: json['filename'] as String? ?? '',
        diff: json['diff'] as String? ?? '',
        additions: json['additions'] as int? ?? 0,
        deletions: json['deletions'] as int? ?? 0,
      );

  /// File the diff applies to.
  final String filename;

  /// Unified diff text.
  final String diff;

  /// Number of added lines.
  final int additions;

  /// Number of deleted lines.
  final int deletions;

  /// Wire type discriminator.
  static const String typeName = 'diff';

  @override
  String get type => typeName;

  @override
  String get asPlainText => '[diff: $filename (+$additions/-$deletions)]';

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'filename': filename,
        'diff': diff,
        'additions': additions,
        'deletions': deletions,
      };

  @override
  List<Object?> get props => [filename, diff, additions, deletions];
}

/// A Mermaid diagram.
class MermaidContent extends MessageContent with EquatableMixin {
  /// Creates a [MermaidContent].
  const MermaidContent(this.diagram, {this.diagramType});

  /// Decodes a [MermaidContent].
  factory MermaidContent.fromJson(Map<String, dynamic> json) => MermaidContent(
        json['diagram'] as String? ?? '',
        diagramType: json['diagramType'] as String?,
      );

  /// Mermaid diagram source.
  final String diagram;

  /// Diagram type (`flowchart`, `sequenceDiagram`, …), if known.
  final String? diagramType;

  /// Wire type discriminator.
  static const String typeName = 'mermaid';

  @override
  String get type => typeName;

  @override
  String get asPlainText => '[diagram]';

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'diagram': diagram,
        if (diagramType != null) 'diagramType': diagramType,
      };

  @override
  List<Object?> get props => [diagram, diagramType];
}

/// A system message (info/warning/error/debug).
class SystemContent extends MessageContent with EquatableMixin {
  /// Creates a [SystemContent].
  const SystemContent(this.text, {this.kind = SystemContentKind.info});

  /// Decodes a [SystemContent].
  factory SystemContent.fromJson(Map<String, dynamic> json) => SystemContent(
        json['text'] as String? ?? '',
        kind: _kindFromName(json['kind'] as String?),
      );

  /// The system text.
  final String text;

  /// Severity/kind.
  final SystemContentKind kind;

  /// Wire type discriminator.
  static const String typeName = 'system';

  static SystemContentKind _kindFromName(String? name) {
    for (final value in SystemContentKind.values) {
      if (value.name == name) return value;
    }
    return SystemContentKind.info;
  }

  @override
  String get type => typeName;

  @override
  String get asPlainText => text;

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'text': text,
        'kind': kind.name,
      };

  @override
  List<Object?> get props => [text, kind];
}

/// A command execution and its (possibly streaming) output.
class CommandExecutionContent extends MessageContent with EquatableMixin {
  /// Creates a [CommandExecutionContent].
  const CommandExecutionContent({
    required this.command,
    required this.status,
    this.output,
    this.exitCode,
  });

  /// Decodes a [CommandExecutionContent].
  factory CommandExecutionContent.fromJson(Map<String, dynamic> json) =>
      CommandExecutionContent(
        command: json['command'] as String? ?? '',
        status: _statusFromName(json['status'] as String?),
        output: json['output'] as String?,
        exitCode: json['exitCode'] as int?,
      );

  /// The command line.
  final String command;

  /// Command output, if any.
  final String? output;

  /// Exit code, if finished.
  final int? exitCode;

  /// Execution status.
  final CommandStatus status;

  /// Wire type discriminator.
  static const String typeName = 'command_execution';

  static CommandStatus _statusFromName(String? name) {
    for (final value in CommandStatus.values) {
      if (value.name == name) return value;
    }
    return CommandStatus.running;
  }

  @override
  String get type => typeName;

  @override
  String get asPlainText => '\$ $command';

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'command': command,
        'status': status.name,
        if (output != null) 'output': output,
        if (exitCode != null) 'exitCode': exitCode,
      };

  @override
  List<Object?> get props => [command, output, exitCode, status];
}

/// A pending approval the agent requests before performing an action
/// (spec 02a §6.2; `stream/approval/requested { approvalId, action, risk }`).
class ApprovalRequest extends Equatable {
  /// Creates an [ApprovalRequest].
  const ApprovalRequest({
    required this.approvalId,
    required this.action,
    this.risk = ApprovalRisk.unknown,
    this.detail,
  });

  /// Decodes an [ApprovalRequest].
  factory ApprovalRequest.fromJson(Map<String, dynamic> json) =>
      ApprovalRequest(
        approvalId: json['approvalId'] as String? ?? '',
        action: json['action'] as String? ?? '',
        risk: _riskFromName(json['risk'] as String?),
        detail: json['detail'] as String?,
      );

  /// Bridge id used to respond to this request.
  final String approvalId;

  /// Human description of what the agent wants to do.
  final String action;

  /// Risk level the agent assigned.
  final ApprovalRisk risk;

  /// Optional extra detail (e.g. the command or affected paths).
  final String? detail;

  /// Serializes this request.
  Map<String, dynamic> toJson() => {
        'approvalId': approvalId,
        'action': action,
        'risk': risk.name,
        if (detail != null) 'detail': detail,
      };

  @override
  List<Object?> get props => [approvalId, action, risk, detail];
}

/// One step of an agent plan (plan mode).
class PlanStep extends Equatable {
  /// Creates a [PlanStep].
  const PlanStep({
    required this.description,
    this.status = PlanStepStatus.pending,
  });

  /// Decodes a [PlanStep].
  factory PlanStep.fromJson(Map<String, dynamic> json) => PlanStep(
        description:
            json['description'] as String? ?? json['text'] as String? ?? '',
        status: _planStepStatusFromName(json['status'] as String?),
      );

  /// What the step does.
  final String description;

  /// The step's progress.
  final PlanStepStatus status;

  /// Serializes this step.
  Map<String, dynamic> toJson() => {
        'description': description,
        'status': _planStepStatusToName(status),
      };

  @override
  List<Object?> get props => [description, status];
}

/// An agent plan: an ordered list of steps with statuses (spec 02a §6.2).
class PlanState extends Equatable {
  /// Creates a [PlanState].
  const PlanState({this.steps = const [], this.title});

  /// Decodes a [PlanState].
  factory PlanState.fromJson(Map<String, dynamic> json) => PlanState(
        title: json['title'] as String?,
        steps: [
          for (final raw in (json['steps'] as List? ?? const []))
            if (raw is Map) PlanStep.fromJson(raw.cast<String, dynamic>()),
        ],
      );

  /// The plan's steps, in order.
  final List<PlanStep> steps;

  /// Optional plan heading / explanation.
  final String? title;

  /// Serializes this plan.
  Map<String, dynamic> toJson() => {
        if (title != null) 'title': title,
        'steps': [for (final step in steps) step.toJson()],
      };

  @override
  List<Object?> get props => [steps, title];
}

/// A single action a subagent performed.
class SubagentAction extends Equatable {
  /// Creates a [SubagentAction].
  const SubagentAction({
    required this.label,
    this.kind = SubagentActionKind.unknown,
  });

  /// Decodes a [SubagentAction].
  factory SubagentAction.fromJson(Map<String, dynamic> json) => SubagentAction(
        label: json['label'] as String? ?? json['text'] as String? ?? '',
        kind: _subagentKindFromName(json['kind'] as String?),
      );

  /// Human description of the action.
  final String label;

  /// The kind of action.
  final SubagentActionKind kind;

  /// Serializes this action.
  Map<String, dynamic> toJson() => {'label': label, 'kind': kind.name};

  @override
  List<Object?> get props => [label, kind];
}

/// State of a subagent launched by the main agent (spec 02a §6.2).
class SubagentState extends Equatable {
  /// Creates a [SubagentState].
  const SubagentState({
    required this.id,
    required this.name,
    this.status,
    this.actions = const [],
  });

  /// Decodes a [SubagentState].
  factory SubagentState.fromJson(Map<String, dynamic> json) => SubagentState(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        status: json['status'] as String?,
        actions: [
          for (final raw in (json['actions'] as List? ?? const []))
            if (raw is Map)
              SubagentAction.fromJson(raw.cast<String, dynamic>()),
        ],
      );

  /// Subagent id.
  final String id;

  /// Subagent name / role.
  final String name;

  /// Free-form status (e.g. `running`, `done`), if reported.
  final String? status;

  /// The actions the subagent has taken.
  final List<SubagentAction> actions;

  /// Serializes this subagent.
  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        if (status != null) 'status': status,
        'actions': [for (final action in actions) action.toJson()],
      };

  @override
  List<Object?> get props => [id, name, status, actions];
}

/// An approval the agent is requesting before acting.
///
/// Tolerant of both nested (`{type:'approval', request:{...}}`) and flat
/// (`{type:'approval', approvalId, action, risk}`) payloads.
class ApprovalContent extends MessageContent with EquatableMixin {
  /// Creates an [ApprovalContent].
  const ApprovalContent(this.request);

  /// Decodes an [ApprovalContent].
  factory ApprovalContent.fromJson(Map<String, dynamic> json) {
    final req = json['request'] is Map
        ? (json['request'] as Map).cast<String, dynamic>()
        : json;
    return ApprovalContent(ApprovalRequest.fromJson(req));
  }

  /// The pending approval.
  final ApprovalRequest request;

  /// Wire type discriminator.
  static const String typeName = 'approval';

  @override
  String get type => typeName;

  @override
  String get asPlainText => '[approval: ${request.action}]';

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'request': request.toJson(),
      };

  @override
  List<Object?> get props => [request];
}

/// An agent plan (plan mode).
///
/// Tolerant of both nested (`{type:'plan', state:{...}}`) and flat payloads.
class PlanContent extends MessageContent with EquatableMixin {
  /// Creates a [PlanContent].
  const PlanContent(this.state);

  /// Decodes a [PlanContent].
  factory PlanContent.fromJson(Map<String, dynamic> json) {
    final st = json['state'] is Map
        ? (json['state'] as Map).cast<String, dynamic>()
        : json;
    return PlanContent(PlanState.fromJson(st));
  }

  /// The plan.
  final PlanState state;

  /// Wire type discriminator.
  static const String typeName = 'plan';

  @override
  String get type => typeName;

  @override
  String get asPlainText => '[plan: ${state.steps.length} steps]';

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'state': state.toJson(),
      };

  @override
  List<Object?> get props => [state];
}

/// A subagent launched by the main agent.
///
/// Tolerant of both nested (`{type:'subagent', state:{...}}`) and flat forms.
class SubagentContent extends MessageContent with EquatableMixin {
  /// Creates a [SubagentContent].
  const SubagentContent(this.state);

  /// Decodes a [SubagentContent].
  factory SubagentContent.fromJson(Map<String, dynamic> json) {
    final st = json['state'] is Map
        ? (json['state'] as Map).cast<String, dynamic>()
        : json;
    return SubagentContent(SubagentState.fromJson(st));
  }

  /// The subagent's state.
  final SubagentState state;

  /// Wire type discriminator.
  static const String typeName = 'subagent';

  @override
  String get type => typeName;

  @override
  String get asPlainText => '[subagent: ${state.name}]';

  @override
  Map<String, dynamic> toJson() => {
        'type': typeName,
        'state': state.toJson(),
      };

  @override
  List<Object?> get props => [state];
}

ApprovalRisk _riskFromName(String? name) {
  for (final value in ApprovalRisk.values) {
    if (value.name == name) return value;
  }
  return ApprovalRisk.unknown;
}

PlanStepStatus _planStepStatusFromName(String? name) => switch (name) {
      'in_progress' => PlanStepStatus.inProgress,
      'completed' => PlanStepStatus.completed,
      _ => PlanStepStatus.pending,
    };

String _planStepStatusToName(PlanStepStatus status) => switch (status) {
      PlanStepStatus.inProgress => 'in_progress',
      PlanStepStatus.completed => 'completed',
      PlanStepStatus.pending => 'pending',
    };

SubagentActionKind _subagentKindFromName(String? name) {
  for (final value in SubagentActionKind.values) {
    if (value.name == name) return value;
  }
  return SubagentActionKind.unknown;
}

/// A content type this app version does not model yet.
///
/// Preserves the original [raw] JSON so it round-trips losslessly and can be
/// rendered by a generic fallback widget.
class UnknownContent extends MessageContent with EquatableMixin {
  /// Creates an [UnknownContent].
  const UnknownContent({required this.type, required this.raw});

  @override
  final String type;

  /// The original JSON, preserved verbatim.
  final Map<String, dynamic> raw;

  @override
  String get asPlainText => '[$type]';

  @override
  Map<String, dynamic> toJson() => raw;

  @override
  List<Object?> get props => [type, raw];
}
