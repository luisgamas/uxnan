import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/domain/value_objects/inline_attachments.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// A draft that was set aside to make room for text coming back from the queue.
class RescuedDraft extends Equatable {
  /// Creates a [RescuedDraft].
  const RescuedDraft({
    required this.id,
    required this.text,
    this.attachments = const [],
  });

  /// Stable identity, so a row can be restored or dismissed on its own.
  final String id;

  /// The full text the composer held, one attachment marker per chip.
  final String text;

  /// The chips' images and files, in the order of their markers, with their
  /// bytes — they go back into the composer with the text.
  final List<AttachmentContent> attachments;

  /// [text] for the Drafts card: each chip named where it sat.
  String get wordsText =>
      inlineAttachmentsPlainText(text, [for (final a in attachments) a.name]);

  @override
  List<Object?> get props => [id, text, attachments];
}

/// What comes back into the composer: a queued message being edited — its
/// wording AND whatever it carried — or a saved draft.
class ComposerIncoming extends Equatable {
  /// Creates a [ComposerIncoming].
  const ComposerIncoming({
    required this.text,
    this.attachments = const [],
  });

  /// The text to put in the field, one attachment marker per entry of
  /// [attachments] (just its markers for an attachment-only message).
  final String text;

  /// Images and files to attach again, in the order of their markers, each
  /// with its bytes inline so it can be re-sent.
  final List<AttachmentContent> attachments;

  @override
  List<Object?> get props => [text, attachments];
}

/// Composer ↔ queue hand-off state for one thread.
class ComposerHandoffState extends Equatable {
  /// Creates a [ComposerHandoffState].
  const ComposerHandoffState({
    this.incoming,
    this.rescued = const [],
    this.draft = '',
    this.draftAttachments = const [],
  });

  /// An empty hand-off (nothing waiting, nothing set aside).
  static const ComposerHandoffState empty = ComposerHandoffState();

  /// What is waiting to be placed into the composer — an edited queued message
  /// (text and attachments), or a restored draft. The composer takes it and
  /// clears it.
  final ComposerIncoming? incoming;

  /// Drafts set aside because the composer was occupied when text came back.
  /// Newest first, so the most recently displaced one is easiest to reach.
  final List<RescuedDraft> rescued;

  /// What the composer currently holds, mirrored so a widget elsewhere in the
  /// tree (a queued bubble's cancel button) can tell whether handing text over
  /// would overwrite something.
  final String draft;

  /// The chips of [draft], in the order of its markers — kept so a draft set
  /// aside keeps its images and files.
  final List<AttachmentContent> draftAttachments;

  /// Returns a copy with the given fields replaced.
  ComposerHandoffState copyWith({
    ComposerIncoming? incoming,
    List<RescuedDraft>? rescued,
    String? draft,
    List<AttachmentContent>? draftAttachments,
    bool clearIncoming = false,
  }) {
    return ComposerHandoffState(
      incoming: clearIncoming ? null : (incoming ?? this.incoming),
      rescued: rescued ?? this.rescued,
      draft: draft ?? this.draft,
      draftAttachments: draftAttachments ?? this.draftAttachments,
    );
  }

  @override
  List<Object?> get props => [incoming, rescued, draft, draftAttachments];
}

/// What [ComposerHandoff.edit] did, so the caller can say so.
enum RecoverOutcome {
  /// The text went straight into an empty composer.
  restored,

  /// The composer was occupied, so its own text was saved as a draft first.
  restoredAndRescued,

  /// Nothing moved: the bridge refused to un-queue the message, or one of its
  /// attachments could not be fetched to go back into the composer.
  failed,
}

/// Moves text between the composer and the message queue, per thread.
///
/// **Editing** a queued message pulls its wording back into the composer and
/// takes it off the queue entirely — as if it had never been sent. (Cancelling
/// is the other action, and it is not this: it just marks the message as
/// cancelled in the timeline and touches nothing here.)
///
/// Editing creates the one collision this class exists to resolve: the composer
/// may already hold a different draft, which must not be silently overwritten.
/// It is saved into [ComposerHandoffState.rescued] and offered back from the
/// Drafts card, and a saved draft only returns to an **empty** composer — so
/// recovering text can never destroy the text recovering was meant to protect.
class ComposerHandoff extends Notifier<Map<String, ComposerHandoffState>> {
  @override
  Map<String, ComposerHandoffState> build() => const {};

  ComposerHandoffState _of(String threadId) =>
      state[threadId] ?? ComposerHandoffState.empty;

  void _set(String threadId, ComposerHandoffState next) {
    if (_of(threadId) == next) return;
    final map = Map<String, ComposerHandoffState>.from(state);
    if (next == ComposerHandoffState.empty) {
      map.remove(threadId);
    } else {
      map[threadId] = next;
    }
    state = map;
  }

  /// Mirrors the composer's current text and chips (called as the user
  /// types).
  void reportDraft(
    String threadId,
    String text, {
    List<AttachmentContent> attachments = const [],
  }) {
    _set(
      threadId,
      _of(threadId).copyWith(draft: text, draftAttachments: attachments),
    );
  }

  /// The composer's current message, set aside as a [RescuedDraft] with [id].
  static RescuedDraft _rescue(ComposerHandoffState current, String id) =>
      RescuedDraft(
        id: id,
        text: current.draft,
        attachments: current.draftAttachments,
      );

  /// Offers page-authored text to the conversation composer without sending it.
  /// An existing draft is kept as a rescued draft instead of being overwritten.
  void offerText(String threadId, String text) {
    final current = _of(threadId);
    final occupied = current.draft.trim().isNotEmpty;
    final incoming = current.incoming;
    // A page's text can never carry an attachment.
    final offered = stripAttachmentMarkers(text);
    final offeredText = [
      if (incoming?.text.trim().isNotEmpty ?? false) incoming!.text,
      if (offered.trim().isNotEmpty) offered,
    ].join('\n\n');
    _set(
      threadId,
      current.copyWith(
        incoming: ComposerIncoming(
          text: offeredText,
          attachments: incoming?.attachments ?? const [],
        ),
        rescued: occupied
            ? [
                _rescue(
                  current,
                  'view-${DateTime.now().microsecondsSinceEpoch}',
                ),
                ...current.rescued,
              ]
            : current.rescued,
      ),
    );
  }

  /// Withdraws [turnId] from the queue — removing its bubble entirely — and
  /// hands [text] and its [attachments] (in marker order) back to the
  /// composer for rewriting, each chip where it was.
  ///
  /// The attachments go back with their bytes. One the phone holds only by
  /// reference (queued from another device, or restored from the bridge) is
  /// fetched first, while the message is still queued: if it cannot be had,
  /// nothing is withdrawn — editing must not quietly drop part of a message.
  Future<RecoverOutcome> edit({
    required String threadId,
    required String turnId,
    required String text,
    List<AttachmentContent> attachments = const [],
  }) async {
    final manager = ref.read(threadManagerProvider);
    final sendable = <AttachmentContent>[];
    for (final attachment in attachments) {
      final ready = await _sendable(manager, threadId, attachment);
      if (ready == null) return RecoverOutcome.failed;
      sendable.add(ready);
    }
    final ok = await manager.withdrawQueuedTurn(threadId, turnId);
    // Only move the text once the bridge confirms the message really left the
    // queue — otherwise it would be both queued to run AND sitting in the
    // composer, and the user would send it twice.
    if (!ok) return RecoverOutcome.failed;

    final current = _of(threadId);
    final occupied = current.draft.trim().isNotEmpty;
    _set(
      threadId,
      current.copyWith(
        incoming: ComposerIncoming(text: text, attachments: sendable),
        rescued: occupied
            ? [_rescue(current, turnId), ...current.rescued]
            : current.rescued,
      ),
    );
    return occupied
        ? RecoverOutcome.restoredAndRescued
        : RecoverOutcome.restored;
  }

  /// [attachment] with its bytes inline — as the composer holds a picked one
  /// — or null when they cannot be had.
  static Future<AttachmentContent?> _sendable(
    ThreadManager manager,
    String threadId,
    AttachmentContent attachment,
  ) async {
    if (attachment.base64Data != null) return attachment;
    final id = attachment.attachmentId;
    if (id == null) return null;
    final bytes = await manager.loadAttachment(threadId, id);
    if (bytes == null) return null;
    return switch (attachment) {
      final ImageContent image => ImageContent(
          mimeType: image.mimeType,
          name: image.name,
          base64Data: base64Encode(bytes),
          width: image.width,
          height: image.height,
        ),
      final AttachedFileContent file => AttachedFileContent(
          name: file.name,
          mimeType: file.mimeType,
          bytes: bytes.length,
          base64Data: base64Encode(bytes),
        ),
    };
  }

  /// Puts a rescued draft back — **only into an empty composer**. Returns false
  /// when it is occupied, so the caller can say why nothing happened.
  bool restore(String threadId, RescuedDraft draft) {
    final current = _of(threadId);
    if (current.draft.trim().isNotEmpty) return false;
    _set(
      threadId,
      current.copyWith(
        incoming: ComposerIncoming(
          text: draft.text,
          attachments: draft.attachments,
        ),
        rescued: [
          for (final entry in current.rescued)
            if (entry.id != draft.id) entry,
        ],
      ),
    );
    return true;
  }

  /// Drops every saved draft for the thread (behind a confirmation in the UI).
  void clearAll(String threadId) {
    final current = _of(threadId);
    if (current.rescued.isEmpty) return;
    _set(threadId, current.copyWith(rescued: const []));
  }

  /// Drops a saved draft the user no longer wants.
  void dismiss(String threadId, RescuedDraft draft) {
    final current = _of(threadId);
    _set(
      threadId,
      current.copyWith(
        rescued: [
          for (final entry in current.rescued)
            if (entry.id != draft.id) entry,
        ],
      ),
    );
  }

  /// The composer has taken [ComposerHandoffState.incoming] in.
  void consumeIncoming(String threadId) {
    final current = _of(threadId);
    if (current.incoming == null) return;
    _set(threadId, current.copyWith(clearIncoming: true));
  }
}

/// Holds the per-thread composer hand-off state.
final composerHandoffsProvider =
    NotifierProvider<ComposerHandoff, Map<String, ComposerHandoffState>>(
  ComposerHandoff.new,
);

/// The composer hand-off state for one thread (empty when there is none).
final composerHandoffProvider =
    Provider.family<ComposerHandoffState, String>((ref, threadId) {
  return ref.watch(composerHandoffsProvider)[threadId] ??
      ComposerHandoffState.empty;
});
