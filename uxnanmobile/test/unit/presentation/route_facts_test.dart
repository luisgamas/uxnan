import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/router/app_router.dart';
import 'package:uxnan/presentation/router/route_facts.dart';

/// The one reader of the route table's shape. The shell, the drawer and "back"
/// used to parse locations each on their own, and each only knew
/// `/conversation/` — a PC's archive, its stats or a folder's screen said
/// nothing to any of them.
void main() {
  String? devices(String threadId) => {'t-1': 'mac-a'}[threadId];

  String parentOf(String location, {String? focused}) =>
      RouteFacts.parse(location).parent(
        deviceOfThread: devices,
        fallbackDevice: focused,
      );

  group('what a location belongs to', () {
    test('a conversation names its thread, and is the one marked open', () {
      final facts = RouteFacts.parse('/conversation/t-1');
      expect(facts.threadId, 't-1');
      expect(facts.deviceId, isNull);
      expect(facts.isConversation, isTrue);
    });

    test("a PC's list and archive name the PC", () {
      for (final location in [
        AppRoutes.deviceThreads('mac-b'),
        AppRoutes.deviceArchived('mac-b'),
      ]) {
        expect(RouteFacts.parse(location).deviceId, 'mac-b', reason: location);
      }
    });

    test("a folder's screen names the conversation it was opened from", () {
      final facts = RouteFacts.parse(
        AppRoutes.workspaceGit('/dev/app', threadId: 't-1'),
      );
      expect(facts.threadId, 't-1');
      expect(facts.isConversation, isFalse);
      expect(
        RouteFacts.parse(AppRoutes.workspaceFiles('/dev/app')).threadId,
        isNull,
      );
    });

    test('everything else belongs to no PC', () {
      for (final location in [
        AppRoutes.home,
        AppRoutes.settings,
        AppRoutes.profile,
        '/conversation/',
      ]) {
        final facts = RouteFacts.parse(location);
        expect(facts.deviceId, isNull, reason: location);
        expect(facts.threadId, isNull, reason: location);
      }
    });
  });

  group('one level up, when nothing was left behind to pop', () {
    test("a conversation goes to its PC's list", () {
      expect(parentOf('/conversation/t-1'), AppRoutes.deviceThreads('mac-a'));
      expect(parentOf('/conversation/unknown'), AppRoutes.home);
    });

    test("a PC's archive goes to its list; the list to the overview", () {
      expect(
        parentOf(AppRoutes.deviceArchived('mac-b')),
        AppRoutes.deviceThreads('mac-b'),
      );
      expect(parentOf(AppRoutes.deviceThreads('mac-b')), AppRoutes.home);
    });

    test("a folder's screen goes back to where it was opened from", () {
      expect(
        parentOf(AppRoutes.workspaceFiles('/dev/app', threadId: 't-1')),
        AppRoutes.conversation('t-1'),
      );
      expect(
        parentOf(AppRoutes.workspaceGit('/dev/app'), focused: 'mac-a'),
        AppRoutes.deviceThreads('mac-a'),
      );
      expect(parentOf(AppRoutes.workspaceGit('/dev/app')), AppRoutes.home);
    });

    test('a destination goes to the overview', () {
      expect(parentOf(AppRoutes.settings), AppRoutes.home);
      expect(parentOf(AppRoutes.manualPairing), AppRoutes.home);
    });
  });
}
