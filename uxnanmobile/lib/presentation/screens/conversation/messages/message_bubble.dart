import 'package:flutter/material.dart';
import 'package:uxnan/domain/entities/message.dart';
import 'package:uxnan/domain/enums/message_role.dart';
import 'package:uxnan/presentation/screens/conversation/messages/message_content_view.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Renders a [Message] as a chat bubble, aligned and colored by role. System
/// messages render full-width without a bubble.
class MessageBubble extends StatelessWidget {
  /// Creates a [MessageBubble].
  const MessageBubble({required this.message, super.key});

  /// The message to render.
  final Message message;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    final blocks = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < message.contents.length; i++) ...[
          if (i > 0) const SizedBox(height: UxnanSpacing.sm),
          MessageContentView(content: message.contents[i]),
        ],
        if (message.isStreaming) ...[
          const SizedBox(height: UxnanSpacing.sm),
          const _StreamingDots(),
        ],
      ],
    );

    if (message.role == MessageRole.system) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
        child: blocks,
      );
    }

    final isUser = message.role == MessageRole.user;
    final bubbleColor =
        isUser ? colors.primaryContainer : colors.surfaceContainerHighest;
    final maxWidth = MediaQuery.sizeOf(context).width * 0.82;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: UxnanSpacing.xs),
          padding: const EdgeInsets.symmetric(
            horizontal: UxnanSpacing.md,
            vertical: UxnanSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: bubbleColor,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(14),
              topRight: const Radius.circular(14),
              bottomLeft: Radius.circular(isUser ? 14 : 4),
              bottomRight: Radius.circular(isUser ? 4 : 14),
            ),
          ),
          child: blocks,
        ),
      ),
    );
  }
}

class _StreamingDots extends StatefulWidget {
  const _StreamingDots();

  @override
  State<_StreamingDots> createState() => _StreamingDotsState();
}

class _StreamingDotsState extends State<_StreamingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return SizedBox(
      height: 8,
      width: 34,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          return Row(
            children: List<Widget>.generate(3, (i) {
              final t = (_controller.value + i / 3) % 1.0;
              final opacity = 0.3 + 0.7 * (t < 0.5 ? t * 2 : (1 - t) * 2);
              return Padding(
                padding: const EdgeInsets.only(right: 5),
                child: Opacity(
                  opacity: opacity,
                  child: CircleAvatar(radius: 3, backgroundColor: color),
                ),
              );
            }),
          );
        },
      ),
    );
  }
}
