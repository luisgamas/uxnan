import 'package:logger/logger.dart' as pkg;
import 'package:uxnan/core/constants/app_constants.dart';

/// Structured application logger.
///
/// Wraps the `logger` package so the rest of the codebase depends on a single
/// stable surface. Output is suppressed entirely unless
/// [AppConstants.enableLogging] is set, keeping production builds silent.
class AppLogger {
  const AppLogger._();

  static final pkg.Logger _logger = pkg.Logger(
    filter: _UxnanLogFilter(),
    printer: pkg.PrettyPrinter(
      methodCount: 0,
      errorMethodCount: 6,
      lineLength: 100,
    ),
  );

  /// Logs a verbose/trace [message].
  static void trace(String message) => _logger.t(message);

  /// Logs a debug [message].
  static void debug(String message) => _logger.d(message);

  /// Logs an informational [message].
  static void info(String message) => _logger.i(message);

  /// Logs a warning [message] with an optional [error] and [stackTrace].
  static void warn(String message, [Object? error, StackTrace? stackTrace]) =>
      _logger.w(message, error: error, stackTrace: stackTrace);

  /// Logs an error [message] with an optional [error] and [stackTrace].
  static void error(String message, [Object? error, StackTrace? stackTrace]) =>
      _logger.e(message, error: error, stackTrace: stackTrace);
}

class _UxnanLogFilter extends pkg.LogFilter {
  @override
  bool shouldLog(pkg.LogEvent event) => AppConstants.enableLogging;
}
