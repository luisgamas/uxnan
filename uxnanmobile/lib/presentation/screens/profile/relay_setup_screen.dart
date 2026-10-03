import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/router/pane_navigation.dart';
import 'package:uxnan/presentation/screens/profile/relay_dialogs.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';
import 'package:uxnan/presentation/widgets/expressive_progress.dart';
import 'package:uxnan/presentation/widgets/ne_button.dart';
import 'package:uxnan/presentation/widgets/ne_enter_transition.dart';
import 'package:uxnan/presentation/widgets/ne_filled_field.dart';
import 'package:uxnan/presentation/widgets/ne_surface.dart';
import 'package:uxnan/presentation/widgets/ne_top_bar.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// Where Cloudflare lists the account's API tokens.
final Uri cloudflareApiTokensUrl =
    Uri.parse('https://dash.cloudflare.com/profile/api-tokens');

/// Sets up the user's own relay on the connected PC (`relay/setup`,
/// architecture/02a §5.10): the PC's bridge deploys it into the person's free
/// Cloudflare account and serves phones through it from then on.
///
/// The token travels inside the end-to-end encrypted channel to the bridge
/// and is never stored here: the field is cleared the moment the call
/// returns, whatever it answered. Whether the PC keeps it (in its system
/// keychain) is the person's choice, off by default.
///
/// A **child** of the PC's details, pushed into whatever navigator holds them
/// ([push]) — the same rule as [PcDetailsScreen]. Laid out like the other
/// full-page form (manual pairing): one entrance, an Icon Surface hero, the
/// fields grouped on one surface and a pill CTA that carries the
/// [PolygonLoader] while the deploy runs (up to a minute).
class RelaySetupScreen extends ConsumerStatefulWidget {
  /// Creates a [RelaySetupScreen].
  const RelaySetupScreen({this.openUrl, super.key});

  /// Opens a link outside the app; defaults to the system browser. Injected
  /// by tests.
  final Future<bool> Function(Uri url)? openUrl;

  /// Opens the setup page in the nearest navigator.
  static Future<void> push(BuildContext context) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const RelaySetupScreen()),
    );
  }

  @override
  ConsumerState<RelaySetupScreen> createState() => _RelaySetupScreenState();
}

class _RelaySetupScreenState extends ConsumerState<RelaySetupScreen> {
  final TextEditingController _account = TextEditingController();
  final TextEditingController _token = TextEditingController();
  bool _remember = false;
  bool _deploying = false;
  String? _error;

  @override
  void dispose() {
    _account.dispose();
    _token.dispose();
    super.dispose();
  }

  Future<void> _openCloudflare() async {
    final open = widget.openUrl ??
        (Uri url) => launchUrl(url, mode: LaunchMode.externalApplication);
    try {
      await open(cloudflareApiTokensUrl);
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Opening Cloudflare failed', error, stackTrace);
    }
  }

  Future<void> _deploy() async {
    final l10n = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final accountId = _account.text.trim();
    final apiToken = _token.text.trim();
    if (accountId.isEmpty || apiToken.isEmpty) {
      setState(() => _error = l10n.relaySetupMissingFields);
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _deploying = true;
      _error = null;
    });
    try {
      await ref.read(relayManagerProvider).setup(
            accountId: accountId,
            apiToken: apiToken,
            remember: _remember,
          );
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(l10n.relaySetupDone)));
      await context.closePane();
    } on RpcError catch (error) {
      // The bridge's message is written for a person ("that token cannot
      // edit Workers"): show it as it is.
      if (mounted) setState(() => _error = error.message);
    } on Object catch (error, stackTrace) {
      AppLogger.warn('relay/setup got no answer', error, stackTrace);
      if (mounted) setState(() => _error = l10n.relayActionNoAnswer);
    } finally {
      // The token lives no longer than the call that needed it.
      _token.clear();
      if (mounted) setState(() => _deploying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return NeScaffold(
      title: l10n.relaySetupTitle,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            UxnanSpacing.xl,
            UxnanSpacing.sm,
            UxnanSpacing.xl,
            UxnanSpacing.xxl,
          ),
          sliver: SliverToBoxAdapter(
            child: Center(
              // One entrance, not a stagger: a form arrives as one thing.
              child: NeEnterTransition(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Container(
                          width: 88,
                          height: 80,
                          decoration: BoxDecoration(
                            color: colors.primaryContainer,
                            borderRadius:
                                const BorderRadius.all(UxnanRadius.xl),
                          ),
                          child: UxIcon(
                            UxIcons.public,
                            size: 38,
                            color: colors.onPrimaryContainer,
                          ),
                        ),
                      ),
                      const SizedBox(height: UxnanSpacing.lg),
                      Text(
                        l10n.relaySetupIntro,
                        style: textTheme.bodyMedium?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: UxnanSpacing.xl),
                      ExpressiveCardGroup(
                        count: 2,
                        itemBuilder: (context, index, position) =>
                            switch (index) {
                          0 => _SetupStep(
                              position: position,
                              number: 1,
                              title: l10n.relaySetupStepToken,
                              body: l10n.relaySetupStepTokenBody,
                              action: TextButton.icon(
                                onPressed: _openCloudflare,
                                icon: const UxIcon(
                                  UxIcons.openInNew,
                                  size: UxnanSize.iconContentSmall,
                                ),
                                label: Text(l10n.relaySetupOpenCloudflare),
                              ),
                            ),
                          _ => _SetupStep(
                              position: position,
                              number: 2,
                              title: l10n.relaySetupStepAccount,
                              body: l10n.relaySetupStepAccountBody,
                            ),
                        },
                      ),
                      const SizedBox(height: UxnanSpacing.xl),
                      NeSurface(
                        padding: const EdgeInsets.all(UxnanSpacing.lg),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            NeFilledField(
                              controller: _account,
                              enabled: !_deploying,
                              icon: UxIcons.badge,
                              label: l10n.relaySetupAccountLabel,
                              hint: l10n.relaySetupAccountHint,
                              keyboardType: TextInputType.visiblePassword,
                              textInputAction: TextInputAction.next,
                            ),
                            const SizedBox(height: UxnanSpacing.md),
                            RelayTokenField(
                              controller: _token,
                              enabled: !_deploying,
                              onSubmitted: (_) {
                                if (!_deploying) unawaited(_deploy());
                              },
                            ),
                            const SizedBox(height: UxnanSpacing.sm),
                            RelayRememberTile(
                              value: _remember,
                              onChanged: _deploying
                                  ? null
                                  : (v) => setState(() => _remember = v),
                            ),
                          ],
                        ),
                      ),
                      if (_error case final String error) ...[
                        const SizedBox(height: UxnanSpacing.lg),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            UxIcon(
                              UxIcons.error,
                              color: colors.error,
                              size: UxnanSize.iconContent,
                            ),
                            const SizedBox(width: UxnanSpacing.sm),
                            Expanded(
                              child: Text(
                                error,
                                style: textTheme.bodySmall
                                    ?.copyWith(color: colors.error),
                              ),
                            ),
                          ],
                        ),
                      ],
                      const SizedBox(height: UxnanSpacing.xl),
                      // The canonical pill CTA (NeButton's shape and size),
                      // with a custom child to carry the loader.
                      SizedBox(
                        height: NeButton.height,
                        child: FilledButton(
                          onPressed: _deploying ? null : _deploy,
                          style: FilledButton.styleFrom(
                            shape: const StadiumBorder(),
                            minimumSize: const Size(0, NeButton.height),
                          ),
                          child: _deploying
                              ? Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    PolygonLoader(
                                      size: UxnanSize.iconContent,
                                      color: colors.onSurfaceVariant,
                                    ),
                                    const SizedBox(width: UxnanSpacing.md),
                                    Text(l10n.relaySetupDeploying),
                                  ],
                                )
                              : Text(l10n.relaySetupDeploy),
                        ),
                      ),
                      if (_deploying) ...[
                        const SizedBox(height: UxnanSpacing.md),
                        Text(
                          l10n.relaySetupDeployingHint,
                          style: textTheme.bodySmall?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// One numbered step of getting the Cloudflare details.
class _SetupStep extends StatelessWidget {
  const _SetupStep({
    required this.position,
    required this.number,
    required this.title,
    required this.body,
    this.action,
  });

  final CardGroupPosition position;
  final int number;
  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final action = this.action;
    return ExpressiveCard(
      position: position,
      color: colors.surfaceContainer,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: UxnanSize.iconContentLarge + UxnanSpacing.xs,
            height: UxnanSize.iconContentLarge + UxnanSpacing.xs,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: colors.secondaryContainer,
              shape: BoxShape.circle,
            ),
            child: Text(
              '$number',
              style: textTheme.labelLarge?.copyWith(
                color: colors.onSecondaryContainer,
              ),
            ),
          ),
          const SizedBox(width: UxnanSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: textTheme.titleSmall),
                const SizedBox(height: UxnanSpacing.xs),
                Text(
                  body,
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
                if (action != null) ...[
                  const SizedBox(height: UxnanSpacing.xs),
                  Align(alignment: Alignment.centerLeft, child: action),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
