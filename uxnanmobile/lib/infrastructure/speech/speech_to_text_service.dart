import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:uxnan/core/utils/logger.dart';

/// A partial or final speech-recognition result.
class SpeechResult {
  /// Creates a [SpeechResult].
  const SpeechResult({required this.text, required this.isFinal});

  /// The recognized words so far (cumulative for the active utterance).
  final String text;

  /// Whether this is the final result of the utterance (recognition settled).
  final bool isFinal;
}

/// On-device speech-to-text for composer dictation (spec: *Voice → text*).
///
/// Fully guarded — like the push notification service — so the app builds and
/// the tests run without microphone hardware or the native plugin: every plugin
/// call is wrapped, and a missing/denied capability leaves recognition simply
/// `unavailable` instead of throwing. Methods are overridable so tests inject a
/// fake without touching the platform. On-device verification is deferred (it
/// needs a real mic).
class SpeechToTextService {
  /// Creates a [SpeechToTextService], optionally injecting the plugin (tests).
  SpeechToTextService([stt.SpeechToText? speech])
      : _speech = speech ?? stt.SpeechToText();

  final stt.SpeechToText _speech;
  bool _initialized = false;
  bool _available = false;

  /// Whether recognition is usable (initialized and supported on this device).
  bool get isAvailable => _available;

  /// Whether a dictation session is currently active.
  bool get isListening => _speech.isListening;

  /// Initializes the plugin once, prompting for the mic/recognition permission
  /// on first use. Returns whether recognition is available; any failure leaves
  /// it unavailable rather than throwing.
  Future<bool> initialize() async {
    if (_initialized) return _available;
    _initialized = true;
    try {
      _available = await _speech.initialize(
        onError: (error) =>
            AppLogger.warn('Speech recognition error: ${error.errorMsg}'),
      );
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Speech recognition unavailable', error, stackTrace);
      _available = false;
    }
    return _available;
  }

  /// Starts a dictation session; [onResult] fires for each partial result and
  /// the final one. [localeId] (e.g. `es_ES`) picks the recognition language;
  /// null uses the device default. No-op when recognition is unavailable.
  Future<void> start({
    required void Function(SpeechResult result) onResult,
    String? localeId,
  }) async {
    if (!_available) return;
    try {
      await _speech.listen(
        onResult: (result) => onResult(
          SpeechResult(
            text: result.recognizedWords,
            isFinal: result.finalResult,
          ),
        ),
        listenOptions: stt.SpeechListenOptions(localeId: localeId),
      );
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Speech listen failed', error, stackTrace);
    }
  }

  /// Stops the active session, keeping the recognized text. No-op if idle.
  Future<void> stop() async {
    try {
      await _speech.stop();
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Speech stop failed', error, stackTrace);
    }
  }

  /// Cancels the active session, discarding any in-progress recognition.
  Future<void> cancel() async {
    try {
      await _speech.cancel();
    } on Object catch (error, stackTrace) {
      AppLogger.warn('Speech cancel failed', error, stackTrace);
    }
  }
}
