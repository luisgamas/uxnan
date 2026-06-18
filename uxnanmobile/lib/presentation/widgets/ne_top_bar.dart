import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';

/// Neural Expressive top bar (guide §4.1–4.2): a 56 dp **transparent** chrome
/// layer with a vertical *scroll veil* (surface → transparent) so content
/// scrolling underneath stays legible without a solid app bar cutting it off.
///
/// Designed to be overlaid at the top of a [Stack] above a scroll view whose
/// content is top-padded by [preferredHeight]. Structure is asymmetric:
/// [leading] + [title] on the left, [actions] on the right.
class NeTopBar extends StatelessWidget {
  /// Creates a [NeTopBar].
  const NeTopBar({
    this.leading,
    this.title,
    this.actions = const [],
    super.key,
  });

  /// Leading widget (typically a back `IconSurface`).
  final Widget? leading;

  /// Title area (e.g. a model-picker pill); expands to fill available width.
  final Widget? title;

  /// Trailing actions (typically `IconSurface`s and an overflow menu).
  final List<Widget> actions;

  /// Toolbar row height (excludes the status-bar inset).
  static const double toolbarHeight = 56;

  /// Total vertical space the bar occupies for [context], including the
  /// status-bar inset. Use to top-pad the scroll content behind it.
  static double preferredHeight(BuildContext context) =>
      MediaQuery.paddingOf(context).top + toolbarHeight + UxnanSpacing.sm;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final topInset = MediaQuery.paddingOf(context).top;

    return Container(
      padding: EdgeInsets.only(top: topInset),
      decoration: BoxDecoration(
        // A subtle scroll veil: the surface is mostly transparent
        // (peaks at 0.75 alpha) so the content underneath reads through
        // the bar instead of looking like a solid app-bar band. The top
        // is just opaque enough to give the back / actions a stable
        // background; the bottom dissolves quickly into the surface.
        // Matches the conversation + file browser + git screen chrome
        // exactly — same alpha curve everywhere so no screen reads as a
        // solid app-bar band over its content.
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            colors.surface.withValues(alpha: 0.75),
            colors.surface.withValues(alpha: 0.45),
            colors.surface.withValues(alpha: 0),
          ],
          stops: const [0, 0.5, 1],
        ),
      ),
      child: SizedBox(
        height: toolbarHeight,
        child: Row(
          children: [
            const SizedBox(width: UxnanSpacing.xs),
            if (leading != null) leading!,
            const SizedBox(width: UxnanSpacing.xs),
            Expanded(child: title ?? const SizedBox.shrink()),
            ...actions,
            const SizedBox(width: UxnanSpacing.xs),
          ],
        ),
      ),
    );
  }
}

/// A [Scaffold] whose [slivers] scroll **under** an overlaid [NeTopBar], with a
/// top spacer so the first content clears the bar. The standard chrome for
/// list/detail screens, matching the conversation's transparent-bar treatment.
/// A back [IconSurface] is added automatically on pushed routes.
class NeScaffold extends StatelessWidget {
  /// Creates a [NeScaffold].
  const NeScaffold({
    required this.slivers,
    this.title,
    this.leading,
    this.actions = const [],
    this.floatingActionButton,
    this.scrollController,
    this.onRefresh,
    this.automaticBackButton = true,
    super.key,
  });

  /// Content slivers (a top spacer is prepended).
  final List<Widget> slivers;

  /// Optional bar title.
  final String? title;

  /// Leading widget; defaults to a back [IconSurface] on pushed routes.
  final Widget? leading;

  /// Trailing bar actions.
  final List<Widget> actions;

  /// Optional FAB.
  final Widget? floatingActionButton;

  /// Optional scroll controller for the content.
  final ScrollController? scrollController;

  /// When set, wraps the content in a [RefreshIndicator].
  final Future<void> Function()? onRefresh;

  /// Whether to auto-add a back button when the route can pop.
  final bool automaticBackButton;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final canPop = ModalRoute.of(context)?.canPop ?? false;
    final lead = leading ??
        (automaticBackButton && canPop
            ? IconSurface(
                icon: Icons.arrow_back_rounded,
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                onPressed: () => Navigator.of(context).maybePop(),
              )
            : null);

    Widget scroll = CustomScrollView(
      controller: scrollController,
      physics: const BouncingScrollPhysics(
        parent: AlwaysScrollableScrollPhysics(),
      ),
      slivers: [
        SliverToBoxAdapter(
          child: SizedBox(height: NeTopBar.preferredHeight(context)),
        ),
        ...slivers,
      ],
    );
    final onRefresh = this.onRefresh;
    if (onRefresh != null) {
      scroll = RefreshIndicator(onRefresh: onRefresh, child: scroll);
    }

    return Scaffold(
      floatingActionButton: floatingActionButton,
      body: Stack(
        children: [
          scroll,
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: NeTopBar(
              leading: lead,
              // Compact single-line title (slightly smaller than titleLarge),
              // truncated with an ellipsis when it doesn't fit.
              title: title == null
                  ? null
                  : Text(
                      title!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.titleLarge?.copyWith(fontSize: 20),
                    ),
              actions: actions,
            ),
          ),
        ],
      ),
    );
  }
}
