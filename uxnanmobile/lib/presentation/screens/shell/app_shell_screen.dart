import 'package:flutter/material.dart';

/// Root scaffold that hosts the app's primary navigation surface.
///
/// In the full design (spec 02a section 5.4.2) this shell owns the sidebar,
/// connection status chrome and the active conversation. For now it renders the
/// routed [child] so the navigation skeleton compiles and can be extended.
class AppShellScreen extends StatelessWidget {
  /// Creates the app shell hosting the given [child].
  const AppShellScreen({required this.child, super.key});

  /// The currently routed screen rendered inside the shell.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(body: child);
  }
}
