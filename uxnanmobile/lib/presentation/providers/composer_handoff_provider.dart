import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/application/managers/thread_manager.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

/// A draft that was set aside to make room for text coming back from the queue.
class RescuedDraft extends Equatable {
  /// Creates a [RescuedDraft].
  const RescuedDraft({required this.id, required this.text});

  /// Stable identity, so a row can be restored or dismissed on its own.
  final String id;

  /// The full text the composer held.
  final String text;

  @override
  List<Object?> get props => [id, text];
}

/// What comes back into the composer: a queued message being edited — its
/// wording AND whatever it carried — or a saved draft (text only).
class ComposerIncoming extends Equatable {
  /// Creates a [ComposerIncoming].
  const ComposerIncoming({
    required this.text,
    this.images = const [],
    this.files = const [],
  });

  /// The text to put in the field (may be empty for an image-only message).
  final String text;

  /// Images to attach again, each with its bytes inline so it can be re-sent.
  final List<ImageContent> images;

  /// Files to attach again, each with its bytes inline so it can be re-sent.
  final List<AttachedFileContent> files;

  @override
  List<Object?> get props => [text, images, files];
}

/// Composer ↔ queue hand-off state for one thread.
class ComposerHandoffState extends Equatable {
  /// Creates a [ComposerHandoffState].
  const ComposerHandoffState({
    this.incoming,
    this.rescued = const [],
    this.draft = '',
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

  /// Returns a copy with the given fields replaced.
  ComposerHandoffState copyWith({
    ComposerIncoming? incoming,
    List<RescuedDraft>? rescued,
    String? draft,
    bool clearIncoming = false,
  }) {
    return ComposerHandoffState(
      incoming: clearIncoming ? null : (incoming ?? this.incoming),
      rescued: rescued ?? this.rescued,
      draft: draft ?? this.draft,
    );
  }

  @override
  List<Object?> get props => [incoming, rescued, draft];
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

  /// Mirrors the composer's current text (called as the user types).
  void reportDraft(String threadId, String text) {
    _set(threadId, _of(threadId).copyWith(draft: text));
  }

  /// Offers page-authored text to the conversation composer without sending it.
  /// An existing draft is kept as a rescued draft instead of being overwritten.
  void offerText(String threadId, String text) {
    final current = _of(threadId);
    final occupied = current.draft.trim().isNotEmpty;
    final incoming = current.incoming;
    final offeredText = [
      if (incoming?.text.trim().isNotEmpty ?? false) incoming!.text,
      if (text.trim().isNotEmpty) text,
    ].join('\n\n');
    _set(
      threadId,
      current.copyWith(
        incoming: ComposerIncoming(
          text: offeredText,
          images: incoming?.images ?? const [],
          files: incoming?.files ?? const [],
        ),
        rescued: occupied
            ? [
                RescuedDraft(
                  id: 'view-${DateTime.now().microsecondsSinceEpoch}',
                  text: current.draft,
                ),
                ...current.rescued,
              ]
            : current.rescued,
      ),
    );
  }

  /// Withdraws [turnId] from the queue — removing its bubble entirely — and
  /// hands [text], [images] and [files] back to the composer for rewriting.
  ///
  /// The attachments go back with their bytes. One the phone holds only by
  /// reference (queued from another device, or restored from the bridge) is
  /// fetched first, while the message is still queued: if it cannot be had,
  /// nothing is withdrawn — editing must not quietly drop part of a message.
  Future<RecoverOutcome> edit({
    required String threadId,
    required String turnId,
    required String text,
    List<ImageContent> images = const [],
    List<AttachedFileContent> files = const [],
  }) async {
    final manager = ref.read(threadManagerProvider);
    final sendableImages = <ImageContent>[];
    for (final image in images) {
      final ready = await _sendableImage(manager, threadId, image);
      if (ready == null) return RecoverOutcome.failed;
      sendableImages.add(ready);
    }
    final sendableFiles = <AttachedFileContent>[];
    for (final file in files) {
      final ready = await _sendableFile(manager, threadId, file);
      if (ready == null) return RecoverOutcome.failed;
      sendableFiles.add(ready);
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
        incoming: ComposerIncoming(
          text: text,
          images: sendableImages,
          files: sendableFiles,
        ),
        rescued: occupied
            ? [
                RescuedDraft(id: turnId, text: current.draft),
                ...current.rescued,
              ]
            : current.rescued,
      ),
    );
    return occupied
        ? RecoverOutcome.restoredAndRescued
        : RecoverOutcome.restored;
  }

  /// [image] with its bytes inline — as the composer holds a picked one — or
  /// null when they cannot be had.
  static Future<ImageContent?> _sendableImage(
    ThreadManager manager,
    String threadId,
    ImageContent image,
  ) async {
    if (image.base64Data != null) return image;
    final id = image.attachmentId;
    if (id == null) return null;
    final bytes = await manager.loadAttachment(threadId, id);
    if (bytes == null) return null;
    return ImageContent(
      mimeType: image.mimeType,
      base64Data: base64Encode(bytes),
      width: image.width,
      height: image.height,
    );
  }

  /// [file] with its bytes inline, or null when they cannot be had.
  static Future<AttachedFileContent?> _sendableFile(
    ThreadManager manager,
    String threadId,
    AttachedFileContent file,
  ) async {
    if (file.base64Data != null) return file;
    final id = file.attachmentId;
    if (id == null) return null;
    final bytes = await manager.loadAttachment(threadId, id);
    if (bytes == null) return null;
    return AttachedFileContent(
      name: file.name,
      mimeType: file.mimeType,
      bytes: bytes.length,
      base64Data: base64Encode(bytes),
    );
  }

  /// Puts a rescued draft back — **only into an empty composer**. Returns false
  /// when it is occupied, so the caller can say why nothing happened.
  bool restore(String threadId, RescuedDraft draft) {
    final current = _of(threadId);
    if (current.draft.trim().isNotEmpty) return false;
    _set(
      threadId,
      current.copyWith(
        incoming: ComposerIncoming(text: draft.text),
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
