import 'package:uxnan/presentation/router/app_router.dart';

/// What a location says about where it belongs: the PC and the conversation
/// it is about, and the screen one level up from it.
///
/// The ONE reader of the route table's shape. The shell asks it which
/// conversation the pane holds, the drawer which PC to list, and "back" where
/// to go when nothing is left to pop. They used to parse locations each on
/// their own, and each only knew `/conversation/`: a PC's archive, its stats,
/// or a folder's files opened from a conversation said nothing to any of them,
/// so the drawer fell back to whichever PC was visited last and back went all
/// the way to the overview.
class RouteFacts {
  const RouteFacts._({required this.path, this.deviceId, this.threadId});

  /// Reads [location] — a router location, query included.
  factory RouteFacts.parse(String location) {
    final uri = Uri.tryParse(location) ?? Uri();
    final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
    String? deviceId;
    String? threadId;
    if (segments.length >= 2 && segments.first == 'device') {
      deviceId = segments[1];
    } else if (segments.length >= 2 && segments.first == 'conversation') {
      threadId = segments[1];
    } else if (segments.isNotEmpty && segments.first == 'workspace') {
      final thread = uri.queryParameters['thread'];
      if (thread != null && thread.isNotEmpty) threadId = thread;
    }
    return RouteFacts._(
      path: '/${segments.join('/')}',
      deviceId: deviceId,
      threadId: threadId,
    );
  }

  /// The location's path, normalized, without its query.
  final String path;

  /// The PC the location names outright (`/device/:id/…`).
  final String? deviceId;

  /// The conversation the location is about: the one on screen
  /// (`/conversation/:id`), or the one a folder's screen was opened from
  /// (`/workspace/…?thread=`).
  final String? threadId;

  /// Whether the location IS a conversation — the only thing the drawer marks
  /// as open.
  bool get isConversation => path.startsWith('/conversation/');

  /// Where "back" goes from here when nothing was left behind to pop —
  /// rotating a tablet turns a pane that was REPLACED into a phone stack of
  /// one screen, and back must still lead somewhere real.
  ///
  /// The screen the user would have come through on a phone: a PC's archive or
  /// stats go to its list, a conversation to its PC's list, a folder's screen
  /// to the conversation it was opened from (or the PC's list), a list to the
  /// overview. [deviceOfThread] resolves a conversation's PC; [fallbackDevice]
  /// is the PC in focus, for a folder opened from a list.
  String parent({
    required String? Function(String threadId) deviceOfThread,
    required String? fallbackDevice,
  }) {
    final segments = path.split('/').where((s) => s.isNotEmpty).toList();
    final device = deviceId;
    if (device != null) {
      return segments.length > 2 && segments[2] != 'threads'
          ? AppRoutes.deviceThreads(device)
          : AppRoutes.home;
    }
    final thread = threadId;
    if (path.startsWith('/workspace/')) {
      if (thread != null) return AppRoutes.conversation(thread);
      return fallbackDevice == null
          ? AppRoutes.home
          : AppRoutes.deviceThreads(fallbackDevice);
    }
    if (isConversation && thread != null) {
      final owner = deviceOfThread(thread);
      return owner == null ? AppRoutes.home : AppRoutes.deviceThreads(owner);
    }
    return AppRoutes.home;
  }
}
