import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uxnan/domain/enums/activity_metric.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/activity_heatmap.dart';

/// The activity block shared by the profile (all PCs) and the per-PC details
/// screen (scoped by [deviceId]): a metric selector (Combined / Conversations /
/// Messages / Work), a year selector, and the [ActivityHeatmap]. It always
/// captions exactly what the grid is showing.
class ActivitySection extends ConsumerStatefulWidget {
  /// Creates an [ActivitySection].
  const ActivitySection({required this.firstYear, this.deviceId, super.key});

  /// The earliest year the user has data for (bounds the year selector).
  final int firstYear;

  /// When set, scopes the activity to a single PC (its `macDeviceId`).
  final String? deviceId;

  @override
  ConsumerState<ActivitySection> createState() => _ActivitySectionState();
}

class _ActivitySectionState extends ConsumerState<ActivitySection> {
  ActivityMetric _metric = ActivityMetric.combined;
  late int _year = DateTime.now().year;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final currentYear = DateTime.now().year;
    final query = (
      metric: _metric,
      year: _year,
      deviceId: widget.deviceId,
    );
    final heatmap = ref.watch(activityHeatmapProvider(query));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: UxnanSpacing.xs,
          children: [
            for (final metric in ActivityMetric.values)
              ChoiceChip(
                label: Text(_metricLabel(l10n, metric)),
                selected: _metric == metric,
                onSelected: (_) => setState(() => _metric = metric),
              ),
          ],
        ),
        const SizedBox(height: UxnanSpacing.sm),
        _YearSelector(
          year: _year,
          canGoBack: _year > widget.firstYear,
          canGoForward: _year < currentYear,
          onChange: (delta) => setState(() => _year += delta),
        ),
        const SizedBox(height: UxnanSpacing.xs),
        heatmap.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: UxnanSpacing.lg),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (_, __) => Text(l10n.profileNoData),
          data: (counts) => ActivityHeatmap(year: _year, countsByDay: counts),
        ),
      ],
    );
  }

  String _metricLabel(AppLocalizations l10n, ActivityMetric metric) =>
      switch (metric) {
        ActivityMetric.combined => l10n.metricCombined,
        ActivityMetric.conversations => l10n.metricConversations,
        ActivityMetric.messages => l10n.metricMessages,
        ActivityMetric.work => l10n.metricWork,
      };
}

class _YearSelector extends StatelessWidget {
  const _YearSelector({
    required this.year,
    required this.canGoBack,
    required this.canGoForward,
    required this.onChange,
  });

  final int year;
  final bool canGoBack;
  final bool canGoForward;
  final ValueChanged<int> onChange;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          icon: const Icon(Icons.chevron_left_rounded),
          onPressed: canGoBack ? () => onChange(-1) : null,
          visualDensity: VisualDensity.compact,
        ),
        Text('$year', style: textTheme.titleSmall),
        IconButton(
          icon: const Icon(Icons.chevron_right_rounded),
          onPressed: canGoForward ? () => onChange(1) : null,
          visualDensity: VisualDensity.compact,
        ),
      ],
    );
  }
}
