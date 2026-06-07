import 'package:drift/drift.dart';
import 'package:uxnan/domain/repositories/i_composer_draft_repository.dart';
import 'package:uxnan/infrastructure/storage/local_database.dart';

/// drift-backed implementation of [IComposerDraftRepository].
class DriftComposerDraftRepository implements IComposerDraftRepository {
  /// Creates a [DriftComposerDraftRepository] over the given database.
  const DriftComposerDraftRepository(this._db);

  final UxnanDatabase _db;

  @override
  Future<String?> getDraft(String threadId) async {
    final row = await (_db.select(_db.composerDraftsTable)
          ..where((d) => d.threadId.equals(threadId)))
        .getSingleOrNull();
    return row?.draft;
  }

  @override
  Future<void> saveDraft(String threadId, String content) async {
    await _db.into(_db.composerDraftsTable).insertOnConflictUpdate(
          ComposerDraftsTableCompanion(
            threadId: Value(threadId),
            draft: Value(content),
            updatedAtMs: Value(DateTime.now().millisecondsSinceEpoch),
          ),
        );
  }

  @override
  Future<void> clearDraft(String threadId) async {
    await (_db.delete(_db.composerDraftsTable)
          ..where((d) => d.threadId.equals(threadId)))
        .go();
  }
}
