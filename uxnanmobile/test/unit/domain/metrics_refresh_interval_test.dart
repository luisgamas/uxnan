import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/metrics_refresh_interval.dart';

void main() {
  group('MetricsRefreshIntervalX.duration', () {
    test('only the periodic modes poll', () {
      expect(MetricsRefreshInterval.automatic.duration, isNull);
      expect(MetricsRefreshInterval.manual.duration, isNull);
      expect(
        MetricsRefreshInterval.every5m.duration,
        const Duration(minutes: 5),
      );
      expect(
        MetricsRefreshInterval.every15m.duration,
        const Duration(minutes: 15),
      );
      expect(
        MetricsRefreshInterval.every30m.duration,
        const Duration(minutes: 30),
      );
      expect(MetricsRefreshInterval.every1h.duration, const Duration(hours: 1));
    });
  });

  group('MetricsRefreshIntervalX.refreshesOnOpen', () {
    test('is what makes `automatic` different from the other modes', () {
      expect(MetricsRefreshInterval.automatic.refreshesOnOpen, isTrue);
      for (final mode in MetricsRefreshInterval.values
          .where((m) => m != MetricsRefreshInterval.automatic)) {
        expect(mode.refreshesOnOpen, isFalse, reason: mode.name);
      }
    });

    test('every mode is either polled or opens/manual — none is a dead end',
        () {
      for (final mode in MetricsRefreshInterval.values) {
        final reachable = mode.duration != null ||
            mode.refreshesOnOpen ||
            mode == MetricsRefreshInterval.manual;
        expect(reachable, isTrue, reason: '${mode.name} never refreshes');
      }
    });
  });

  group('MetricsRefreshIntervalX.fromName', () {
    test('round-trips every value through its stored name', () {
      for (final mode in MetricsRefreshInterval.values) {
        expect(MetricsRefreshIntervalX.fromName(mode.name), mode);
      }
    });

    test('falls back to automatic for unset/unknown stored names', () {
      expect(
        MetricsRefreshIntervalX.fromName(null),
        MetricsRefreshInterval.automatic,
      );
      expect(
        MetricsRefreshIntervalX.fromName('every42m'),
        MetricsRefreshInterval.automatic,
      );
    });
  });
}
