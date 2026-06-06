import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/presentation/theme/colors.dart';
import 'package:uxnan/presentation/theme/uxnan_theme.dart';

void main() {
  test('buildUxnanTheme returns a light color scheme', () {
    final theme = buildUxnanTheme(brightness: Brightness.light);

    expect(theme.brightness, Brightness.light);
    expect(theme.colorScheme.surface, UxnanColors.lightSurface);
    expect(theme.colorScheme.onSurface, UxnanColors.lightOnSurface);
    expect(theme.colorScheme.primary, UxnanColors.lightPrimary);
    expect(theme.colorScheme.secondary, UxnanColors.lightSecondary);
    expect(theme.colorScheme.onSurfaceVariant, UxnanColors.lightOnSurfaceMuted);
  });

  test('buildUxnanTheme returns a dark color scheme', () {
    final theme = buildUxnanTheme();

    expect(theme.brightness, Brightness.dark);
    expect(theme.colorScheme.surface, UxnanColors.surface);
    expect(theme.colorScheme.onSurface, UxnanColors.onSurface);
    expect(theme.colorScheme.primary, UxnanColors.primary);
    expect(theme.colorScheme.secondary, UxnanColors.secondary);
    expect(theme.colorScheme.onSurfaceVariant, UxnanColors.onSurfaceMuted);
  });
}
