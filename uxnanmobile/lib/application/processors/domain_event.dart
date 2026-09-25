import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/git_action_phase_status.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';

/// A classified event derived from an inbound bridge notification
/// (spec 02a §5.2.5).
///
/// This increment models the conversation/turn streaming events and git action
/// progress; other stream notifications (plan, subagent, approval, connection,
/// workspace, auth) currently map to [UnknownDomainEvent] and gain dedicated
/// event types with their modules (FOR-DEV).
sealed class DomainEvent extends Equatable {
  const DomainEvent();
}

/// A turn started streaming.
class TurnStartedEvent extends DomainEvent {
  /// Creates a [TurnStartedEvent].
  const TurnStartedEvent({required this.turnId, this.threadId});

  /// The turn that started.
  final String turnId;

  /// The owning thread, if the bridge provided it.
  final String? threadId;

  @override
  List<Object?> get props => [turnId, threadId];
}

/// A streaming text delta for the active turn.
class MessageDeltaEvent extends DomainEvent {
  /// Creates a [MessageDeltaEvent].
  const MessageDeltaEvent({
    required this.turnId,
    required this.delta,
    this.threadId,
  });

  /// The turn being streamed.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  /// The text delta to append.
  final String delta;

  @override
  List<Object?> get props => [turnId, threadId, delta];
}

/// A streaming reasoning ("thinking") delta for the active turn.
class ThinkingDeltaEvent extends DomainEvent {
  /// Creates a [ThinkingDeltaEvent].
  const ThinkingDeltaEvent({
    required this.turnId,
    required this.delta,
    this.threadId,
  });

  /// The turn being streamed.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  /// The reasoning delta to append.
  final String delta;

  @override
  List<Object?> get props => [turnId, threadId, delta];
}

/// A structured content block (command/diff/tool) produced during the turn,
/// already decoded into a [MessageContent] (`stream/content/block`).
class ContentBlockEvent extends DomainEvent {
  /// Creates a [ContentBlockEvent].
  const ContentBlockEvent({
    required this.turnId,
    required this.content,
    this.threadId,
    this.beforeText = false,
  });

  /// The turn that produced the block.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  /// The decoded content block.
  final MessageContent content;

  /// `true` when the block came from a parallel/background activity (e.g. a
  /// Claude Code subagent's tool run) while the assistant's main text was
  /// still streaming: it must be inserted BEFORE the open text run instead of
  /// appended after it, so the run is never severed (appending would render
  /// the sentence split mid-word by an activity card). Mirrors the order the
  /// bridge persists in `Message.segments`, keeping live view and re-sync
  /// identical.
  final bool beforeText;

  @override
  List<Object?> get props => [turnId, threadId, content, beforeText];
}

/// A turn finished successfully.
class TurnCompletedEvent extends DomainEvent {
  /// Creates a [TurnCompletedEvent].
  const TurnCompletedEvent({
    required this.turnId,
    this.threadId,
    this.text,
    this.tokens,
    this.contextWindow,
  });

  /// The completed turn.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  /// The agent's full final answer text for the turn (authoritative). Used to
  /// finalize the message even when the live delta buffer is empty or partial —
  /// e.g. the app re-attached to a turn already in flight (after reconnecting
  /// while backgrounded) and never received its earlier deltas. Null on agents
  /// that don't report a final text.
  final String? text;

  /// Context-occupying token count for the turn, when the agent reported it.
  final int? tokens;

  /// The model's context window, when known (Claude tiers); null otherwise.
  final int? contextWindow;

  @override
  List<Object?> get props => [turnId, threadId, text, tokens, contextWindow];
}

/// A turn ended in an error.
class TurnErrorEvent extends DomainEvent {
  /// Creates a [TurnErrorEvent].
  const TurnErrorEvent({required this.turnId, this.threadId, this.message});

  /// The turn that errored.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  /// The error message, if any.
  final String? message;

  @override
  List<Object?> get props => [turnId, threadId, message];
}

/// A turn was aborted by the user.
class TurnAbortedEvent extends DomainEvent {
  /// Creates a [TurnAbortedEvent].
  const TurnAbortedEvent({required this.turnId, this.threadId});

  /// The aborted turn.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [turnId, threadId];
}

/// A queued turn was removed before it ever ran (`stream/turn/cancelled`).
/// Distinct from [TurnAbortedEvent], which is a turn that was *running* and got
/// stopped: this one never started, and its user message stays in the timeline
/// marked as cancelled instead of disappearing.
class TurnCancelledEvent extends DomainEvent {
  /// Creates a [TurnCancelledEvent].
  const TurnCancelledEvent({required this.turnId, this.threadId});

  /// The turn that was taken off the queue.
  final String turnId;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [turnId, threadId];
}

/// A queued turn reached the agent **without waiting** — it was folded into the
/// turn already running (`stream/turn/delivered`), the way a CLI picks up what
/// you type while it works.
///
/// Distinct from [TurnCancelledEvent] in the outcome that matters: this message
/// DID reach the agent. It will never run as a turn of its own, because the
/// answer belongs to [intoTurnId], so the bubble settles into an ordinary sent
/// message and stops offering to edit or cancel.
class TurnDeliveredEvent extends DomainEvent {
  /// Creates a [TurnDeliveredEvent].
  const TurnDeliveredEvent({
    required this.turnId,
    required this.intoTurnId,
    this.threadId,
  });

  /// The queued turn that was handed over.
  final String turnId;

  /// The running turn it joined; its reply covers both messages.
  final String intoTurnId;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [turnId, intoTurnId, threadId];
}

/// The thread's message queue changed (`stream/queue/updated`).
///
/// Carries the WHOLE queue state rather than a delta, so a client that missed
/// one (backgrounded, mid-reconnect) converges on the next one instead of
/// drifting.
class QueueUpdatedEvent extends DomainEvent {
  /// Creates a [QueueUpdatedEvent].
  const QueueUpdatedEvent({
    required this.queuedTurnIds,
    required this.paused,
    this.pausedReason,
    this.threadId,
  });

  /// Queued turn ids in the order they will run.
  final List<String> queuedTurnIds;

  /// Whether draining is held after the user stopped a turn or one failed.
  final bool paused;

  /// Why draining is held; null when it is not paused.
  final QueuePausedReason? pausedReason;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [queuedTurnIds, paused, pausedReason, threadId];
}

/// The agent resolved its alias to a concrete model for a turn
/// (`stream/model/resolved`), e.g. `opus` → `claude-opus-4-8`.
/// A thread was created or its stored metadata changed on the bridge
/// (`stream/thread/updated`) — by this phone, another phone, the desktop, or
/// the bridge itself (a generated title). Carries the whole wire thread, so
/// applying it is an idempotent upsert.
class ThreadUpdatedEvent extends DomainEvent {
  /// Creates a [ThreadUpdatedEvent].
  const ThreadUpdatedEvent({required this.thread, this.threadId});

  /// The wire `Thread` object, as `thread/list` returns them.
  final Map<String, dynamic> thread;

  /// The thread's id (read from [thread]).
  final String? threadId;

  @override
  List<Object?> get props => [thread, threadId];
}

/// A thread was deleted on the bridge (`stream/thread/deleted`), possibly from
/// another client.
class ThreadDeletedEvent extends DomainEvent {
  /// Creates a [ThreadDeletedEvent].
  const ThreadDeletedEvent({this.threadId, this.rev});

  /// The deleted thread.
  final String? threadId;

  /// Sync revision of the deletion (architecture/02a §5.8.17), when sent.
  final int? rev;

  @override
  List<Object?> get props => [threadId, rev];
}

/// A project entered or changed in the PC's registry (`stream/project/updated`,
/// architecture/02a §5.8.17) — added on this phone, another one, or Uxnan
/// Desktop. Carries the whole wire project (with its sync `rev`).
class ProjectUpdatedEvent extends DomainEvent {
  /// Creates a [ProjectUpdatedEvent].
  const ProjectUpdatedEvent({required this.project});

  /// The wire `Project`.
  final Map<String, dynamic> project;

  @override
  List<Object?> get props => [project];
}

/// A project left the PC's registry (`stream/project/removed`). Its
/// conversations are untouched.
class ProjectRemovedEvent extends DomainEvent {
  /// Creates a [ProjectRemovedEvent].
  const ProjectRemovedEvent({required this.projectId, this.rev});

  /// The removed project.
  final String projectId;

  /// Sync revision of the removal.
  final int? rev;

  @override
  List<Object?> get props => [projectId, rev];
}

/// The PC's shared settings changed (`stream/settings/updated`).
class SettingsUpdatedEvent extends DomainEvent {
  /// Creates a [SettingsUpdatedEvent].
  const SettingsUpdatedEvent({this.home, this.name, this.rev});

  /// The start folder new projects are explored from.
  final String? home;

  /// What every client calls the PC.
  final String? name;

  /// Sync revision of the change.
  final int? rev;

  @override
  List<Object?> get props => [home, name, rev];
}

/// Who is connected to the PC's bridge changed (`stream/presence/updated`):
/// the whole list, so applying it is idempotent.
class PresenceUpdatedEvent extends DomainEvent {
  /// Creates a [PresenceUpdatedEvent].
  const PresenceUpdatedEvent({required this.clients});

  /// The wire `ClientPresence` entries.
  final List<Object?> clients;

  @override
  List<Object?> get props => [clients];
}

/// A phone was paired to the PC, described, renamed or removed
/// (`stream/devices/updated`): the whole list, so applying it is idempotent.
class DevicesUpdatedEvent extends DomainEvent {
  /// Creates a [DevicesUpdatedEvent].
  const DevicesUpdatedEvent({required this.devices});

  /// The wire `TrustedDevice` entries.
  final List<Object?> devices;

  @override
  List<Object?> get props => [devices];
}

/// An agent CLI appeared or disappeared on the PC (`stream/agents/updated`).
class AgentsUpdatedEvent extends DomainEvent {
  /// Creates an [AgentsUpdatedEvent].
  const AgentsUpdatedEvent();

  @override
  List<Object?> get props => const [];
}

/// A user turn was stored on the bridge (`stream/turn/created`) — started or
/// queued — carrying the user's message, so a prompt typed on another client
/// takes its place in the timeline before the answer streams.
///
/// [clientTurnId] echoes the id this app sent on `turn/send` for its own
/// optimistic bubble; when it matches, the event confirms that bubble instead
/// of adding a second copy of the message.
class TurnCreatedEvent extends DomainEvent {
  /// Creates a [TurnCreatedEvent].
  const TurnCreatedEvent({
    required this.turn,
    this.clientTurnId,
    this.threadId,
  });

  /// The wire `Turn` object (`id`, `status`, `messages`, `createdAt`).
  final Map<String, dynamic> turn;

  /// The sender's optimistic-bubble id, when the sender supplied one.
  final String? clientTurnId;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [turn, clientTurnId, threadId];
}

/// A pending approval stopped being pending (`stream/approval/resolved`):
/// answered on some client, or timed out to a reject.
class ApprovalResolvedEvent extends DomainEvent {
  /// Creates an [ApprovalResolvedEvent].
  const ApprovalResolvedEvent({
    required this.approvalId,
    required this.decision,
    this.timedOut = false,
    this.threadId,
  });

  /// The approval the cards are keyed by.
  final String approvalId;

  /// What the agent got, as its wire name (`approve`, `reject`,
  /// `approveSession`).
  final String decision;

  /// True when nobody answered and it defaulted to reject.
  final bool timedOut;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [approvalId, decision, timedOut, threadId];
}

/// A pending question stopped being pending (`stream/question/resolved`):
/// answered on some client, skipped, or timed out.
class QuestionResolvedEvent extends DomainEvent {
  /// Creates a [QuestionResolvedEvent].
  const QuestionResolvedEvent({
    required this.questionId,
    required this.answers,
    required this.skipped,
    this.timedOut = false,
    this.threadId,
  });

  /// The question the cards are keyed by.
  final String questionId;

  /// The chosen labels, one list per question, in order.
  final List<List<String>> answers;

  /// True when no option was chosen.
  final bool skipped;

  /// True when nobody answered in time.
  final bool timedOut;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [questionId, answers, skipped, timedOut, threadId];
}

class ModelResolvedEvent extends DomainEvent {
  /// Creates a [ModelResolvedEvent].
  const ModelResolvedEvent({
    required this.model,
    this.turnId,
    this.threadId,
  });

  /// The concrete model id the agent resolved.
  final String model;

  /// The turn it was resolved for, if provided.
  final String? turnId;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [model, turnId, threadId];
}

/// A progress update for a long-running git action (`stream/git/progress`).
class GitProgressEvent extends DomainEvent {
  /// Creates a [GitProgressEvent].
  const GitProgressEvent({
    required this.phase,
    required this.status,
    this.threadId,
  });

  /// The phase the bridge is reporting (e.g. `resolving`, `uploading`).
  final String phase;

  /// The phase's status.
  final GitActionPhaseStatus status;

  /// The owning thread, if provided.
  final String? threadId;

  @override
  List<Object?> get props => [phase, status, threadId];
}

/// A notification not yet modeled as a specific domain event.
class UnknownDomainEvent extends DomainEvent {
  /// Creates an [UnknownDomainEvent].
  const UnknownDomainEvent({required this.method, this.params});

  /// The originating JSON-RPC method.
  final String method;

  /// The raw params, if any.
  final Map<String, dynamic>? params;

  @override
  List<Object?> get props => [method, params];
}
