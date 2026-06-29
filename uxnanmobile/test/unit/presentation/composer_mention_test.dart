import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/screens/conversation/composer/composer_commands.dart';
import 'package:uxnan/presentation/screens/conversation/composer/mention_suggestion.dart';

void main() {
  group('detectComposerTrigger', () {
    test('returns null for plain text with no trigger', () {
      expect(detectComposerTrigger('hello world', 11), isNull);
    });

    test('detects a bare @ at the start of the message', () {
      final ctx = detectComposerTrigger('@', 1);
      expect(ctx, isNotNull);
      expect(ctx!.trigger, ComposerTrigger.file);
      expect(ctx.query, '');
      expect(ctx.triggerOffset, 0);
    });

    test('detects an @ mention mid-message after whitespace', () {
      final ctx = detectComposerTrigger('see @lib/main', 13);
      expect(ctx!.trigger, ComposerTrigger.file);
      expect(ctx.query, 'lib/main');
      expect(ctx.triggerOffset, 4);
    });

    test('an @ not at a word boundary (e.g. an email) is ignored', () {
      expect(detectComposerTrigger('mail@host', 9), isNull);
    });

    test('whitespace after the @ token breaks the mention', () {
      expect(detectComposerTrigger('@lib here', 9), isNull);
    });

    test('respects a caret in the middle of the token', () {
      final ctx = detectComposerTrigger('@library', 4);
      expect(ctx!.query, 'lib');
      expect(ctx.cursor, 4);
    });

    test('detects a leading / command', () {
      final ctx = detectComposerTrigger('/rev', 4);
      expect(ctx!.trigger, ComposerTrigger.command);
      expect(ctx.query, 'rev');
      expect(ctx.triggerOffset, 0);
    });

    test('a / that is not message-initial is not a command', () {
      // A path-like token mid-message must never open the command palette.
      expect(detectComposerTrigger('lib/main.dart', 3), isNull);
    });

    test('the command context ends at the first space', () {
      // Caret after the space → no command (and no @), so null.
      expect(detectComposerTrigger('/fix this', 9), isNull);
    });
  });

  group('splitFileQuery', () {
    test('no slash → all basename', () {
      expect(splitFileQuery('mai'), (dir: '', name: 'mai'));
    });
    test('splits dir and basename', () {
      expect(splitFileQuery('lib/pres'), (dir: 'lib', name: 'pres'));
    });
    test('trailing slash → empty basename', () {
      expect(splitFileQuery('lib/'), (dir: 'lib', name: ''));
    });
    test('nested path keeps the full dir', () {
      expect(splitFileQuery('a/b/c'), (dir: 'a/b', name: 'c'));
    });
  });

  group('applyFileMention', () {
    test('a folder drills in: @path/ with no trailing space', () {
      const ctx = ComposerTriggerContext(
        trigger: ComposerTrigger.file,
        query: 'li',
        triggerOffset: 0,
        cursor: 3,
      );
      final edit = applyFileMention(
        '@li',
        ctx,
        relativePath: 'lib',
        isDir: true,
      );
      expect(edit.text, '@lib/');
      expect(edit.cursor, 5);
    });

    test('a file finalizes the mention: @path + trailing space', () {
      const ctx = ComposerTriggerContext(
        trigger: ComposerTrigger.file,
        query: 'ma',
        triggerOffset: 4,
        cursor: 7,
      );
      final edit = applyFileMention(
        'see @ma',
        ctx,
        relativePath: 'lib/main.dart',
        isDir: false,
      );
      expect(edit.text, 'see @lib/main.dart ');
      expect(edit.cursor, edit.text.length);
    });
  });

  group('applyCommand', () {
    test('replaces the whole /command run with the template', () {
      const ctx = ComposerTriggerContext(
        trigger: ComposerTrigger.command,
        query: 'rev',
        triggerOffset: 0,
        cursor: 4,
      );
      final edit = applyCommand('/rev', ctx, replacement: 'Review this: ');
      expect(edit.text, 'Review this: ');
      expect(edit.cursor, 'Review this: '.length);
    });

    test('hands off to the @ picker', () {
      const ctx = ComposerTriggerContext(
        trigger: ComposerTrigger.command,
        query: 'files',
        triggerOffset: 0,
        cursor: 6,
      );
      final edit = applyCommand('/files', ctx, replacement: '@');
      expect(edit.text, '@');
      expect(edit.cursor, 1);
    });
  });

  group('matchComposerCommands', () {
    const commands = [
      ComposerCommand(
        id: 'files',
        icon: IconData(0),
        label: 'Attach file or folder',
        description: '',
        kind: ComposerCommandKind.startFileMention,
      ),
      ComposerCommand(
        id: 'review',
        icon: IconData(0),
        label: 'Review',
        description: '',
        kind: ComposerCommandKind.insertTemplate,
        template: 'Review this: ',
      ),
    ];

    test('an empty query returns the full catalog', () {
      expect(matchComposerCommands(commands, ''), equals(commands));
    });

    test('matches by stable id', () {
      final result = matchComposerCommands(commands, 'rev');
      expect(result, hasLength(1));
      expect(result.single.id, 'review');
    });

    test('matches by localized label (case-insensitive)', () {
      final result = matchComposerCommands(commands, 'attach');
      expect(result, hasLength(1));
      expect(result.single.id, 'files');
    });

    test('returns nothing when no command matches', () {
      expect(matchComposerCommands(commands, 'zzz'), isEmpty);
    });
  });
}
