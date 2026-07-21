import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/app.dart';
import 'package:uxnan/domain/value_objects/metrics_snapshot.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

var _metricsBuilt = false;

class _TrackingMetricsController extends MetricsController {
  @override
  Future<Map<String, MetricsSnapshot>> build() async {
    _metricsBuilt = true;
    return const {};
  }
}

void main() {
  testWidgets('app boots to the home empty state', (tester) async {
    _metricsBuilt = false;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          metricsSnapshotsProvider.overrideWith(_TrackingMetricsController.new),
        ],
        child: const UxnanApp(),
      ),
    );
    await tester.pumpAndSettle();

    // English is the test default locale; the empty-state title should render.
    expect(find.text('No active sessions'), findsOneWidget);
    expect(find.text('Pair a device'), findsOneWidget);
    expect(
      _metricsBuilt,
      isTrue,
      reason: 'the app shell must listen before Profile is opened',
    );
  });
}
