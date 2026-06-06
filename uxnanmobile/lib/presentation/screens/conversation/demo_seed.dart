import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/command_status.dart';
import 'package:uxnan/domain/enums/message_delivery_state.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/presentation/providers/infrastructure_providers.dart';

/// FOR-DEV: id of the demo conversation thread.
const String demoThreadId = 'demo-thread';

/// FOR-DEV: seeds a sample conversation into local storage so the conversation
/// UI can be reviewed on-device without a connected bridge. Remove (and the
/// home-screen preview entry) before release.
Future<String> seedDemoConversation(WidgetRef ref) async {
  final now = DateTime.now();
  await ref.read(threadRepositoryProvider).saveThread(
        Thread(
          id: demoThreadId,
          title: 'Demo conversation',
          agentId: 'claude-code',
          syncState: ThreadSyncState.synced,
          status: ThreadStatus.active,
          lastActivity: now,
        ),
      );

  Message message(
    String id,
    int order,
    MessageRole role,
    List<MessageContent> contents,
  ) =>
      Message(
        id: id,
        threadId: demoThreadId,
        turnId: 'turn-$order',
        role: role,
        contents: contents,
        deliveryState: MessageDeliveryState.delivered,
        orderIndex: order,
        createdAt: now.add(Duration(seconds: order)),
      );

  await ref.read(messageRepositoryProvider).saveMessages([
    message('d1', 0, MessageRole.user, [
      const TextContent('How do I read a file in Dart?'),
    ]),
    message('d2', 1, MessageRole.assistant, [
      const TextContent('You can read a file with **`dart:io`**:'),
      const CodeContent(
        "import 'dart:io';\n\n"
        "final content = await File('notes.txt').readAsString();",
        language: 'dart',
        filename: 'main.dart',
      ),
    ]),
    message('d3', 2, MessageRole.assistant, [
      const CommandExecutionContent(
        command: 'dart run main.dart',
        status: CommandStatus.completed,
        output: 'hello world',
        exitCode: 0,
      ),
    ]),
    message('d4', 3, MessageRole.assistant, [
      const DiffContent(
        filename: 'lib/main.dart',
        diff: "@@ -1,3 +1,4 @@\n import 'dart:io';\n"
            "+import 'dart:convert';\n void main() {\n-  print(1);\n"
            "+  print('done');\n }",
        additions: 2,
        deletions: 1,
      ),
    ]),
    message('d5', 4, MessageRole.system, [
      const SystemContent('Context window 42% used'),
    ]),
    message('d6', 5, MessageRole.assistant, [
      const TextContent('Let me run that for you', isStreaming: true),
    ]),
  ]);

  return demoThreadId;
}
