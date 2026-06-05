import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/app.dart';

void main() {
  testWidgets('app boots to the home empty state', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: UxnanApp()));
    await tester.pumpAndSettle();

    // English is the test default locale; the empty-state title should render.
    expect(find.text('No active sessions'), findsOneWidget);
    expect(find.text('Pair a device'), findsOneWidget);
  });
}
