// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Spanish Castilian (`es`).
class AppLocalizationsEs extends AppLocalizations {
  AppLocalizationsEs([String locale = 'es']) : super(locale);

  @override
  String get appTitle => 'Uxnan';

  @override
  String get homeEmptyTitle => 'Sin sesiones activas';

  @override
  String get homeEmptyBody =>
      'Vincula tu teléfono con una PC que ejecute el bridge de Uxnan para comenzar.';

  @override
  String get actionPairDevice => 'Vincular un dispositivo';

  @override
  String get connectionConnected => 'Conectado';

  @override
  String get connectionConnecting => 'Conectando…';

  @override
  String get connectionDisconnected => 'Desconectado';

  @override
  String get connectionReconnecting => 'Reconectando…';

  @override
  String get onboardingSkip => 'Omitir';

  @override
  String get onboardingNext => 'Siguiente';

  @override
  String get onboardingBack => 'Atrás';

  @override
  String get onboardingGetStarted => 'Comenzar';

  @override
  String get onboardingWelcomeTitle => 'Controla tus agentes desde donde sea';

  @override
  String get onboardingWelcomeBody =>
      'Uxnan es un control remoto seguro para los agentes de IA que corren en tu PC.';

  @override
  String get onboardingFeaturesTitle => 'Hecho para tu forma de trabajar';

  @override
  String get featureMultiAgentTitle => 'Multi-agente';

  @override
  String get featureMultiAgentBody =>
      'Funciona con Codex, Claude Code, Gemini CLI, OpenCode y más — sin lock-in.';

  @override
  String get featureE2eeTitle => 'Cifrado de extremo a extremo';

  @override
  String get featureE2eeBody =>
      'Los mensajes se cifran en tus dispositivos. El relay solo ve sobres opacos.';

  @override
  String get featureLocalFirstTitle => 'Local-first';

  @override
  String get featureLocalFirstBody =>
      'Tu código y conversaciones se quedan en tu máquina, nunca en un servidor de terceros.';

  @override
  String get onboardingInstallTitle => 'Instala el bridge en tu PC';

  @override
  String get onboardingInstallBody =>
      'Ejecuta esto en una terminal de la computadora donde viven tus agentes:';

  @override
  String get onboardingInstallHint =>
      'Deja la terminal abierta — ahí se muestra el QR de vinculación.';

  @override
  String get onboardingPairTitle => 'Vincula tu teléfono';

  @override
  String get onboardingPairBody =>
      'Escanea el código QR del bridge para establecer una sesión segura.';

  @override
  String get actionScanQr => 'Escanear código QR';

  @override
  String get commandCopied => 'Comando copiado al portapapeles';

  @override
  String get actionCopy => 'Copiar';

  @override
  String get qrScannerTitle => 'Escanear QR de vinculación';

  @override
  String get qrPermissionTitle => 'Se necesita acceso a la cámara';

  @override
  String get qrPermissionBody =>
      'Uxnan usa la cámara solo para escanear el código QR de vinculación del bridge.';

  @override
  String get actionAllowCamera => 'Permitir cámara';

  @override
  String get actionOpenSettings => 'Abrir ajustes';

  @override
  String get qrHint =>
      'Apunta la cámara al código QR en la terminal de tu bridge.';

  @override
  String get qrErrorExpired =>
      'Este código QR expiró. Genera uno nuevo en tu PC.';

  @override
  String get qrErrorMalformed =>
      'Este no es un código de vinculación de Uxnan válido.';

  @override
  String get pairingConnecting => 'Estableciendo una sesión segura…';

  @override
  String get updateRequiredTitle => 'Actualización requerida';

  @override
  String get updateRequiredBody =>
      'Este bridge usa un formato de vinculación más nuevo. Actualiza la app de Uxnan para continuar.';

  @override
  String get actionDismiss => 'Cerrar';

  @override
  String get conversationTitle => 'Conversación';

  @override
  String get conversationEmpty => 'Aún no hay mensajes';

  @override
  String get conversationEmptyBody =>
      'Envía un mensaje para iniciar la conversación.';

  @override
  String get composerHint => 'Mensaje…';

  @override
  String get composerSend => 'Enviar';

  @override
  String get composerAttach => 'Adjuntar';

  @override
  String get composerVoice => 'Entrada de voz';

  @override
  String get conversationPreview => 'Vista previa de conversación (demo)';

  @override
  String get environmentTitle => 'Entorno';

  @override
  String get environmentModel => 'Modelo';

  @override
  String get environmentContext => 'Contexto';

  @override
  String get environmentApprovalMode => 'Modo de aprobación';

  @override
  String get environmentGit => 'Git';

  @override
  String get environmentBranch => 'Rama';

  @override
  String get environmentLocal => 'Local';

  @override
  String get environmentCommitOrPush => 'Hacer commit o push';

  @override
  String get approvalQuestion => '¿Cómo se deben aprobar las acciones?';

  @override
  String get approvalRequestTitle => 'Solicitar aprobación';

  @override
  String get approvalRequestBody =>
      'Preguntar siempre antes de editar archivos externos o usar internet.';

  @override
  String get approvalAutoTitle => 'Aprobar por mí';

  @override
  String get approvalAutoBody =>
      'Solicitar aprobación solo para acciones detectadas como potencialmente riesgosas.';

  @override
  String get approvalFullTitle => 'Acceso completo';

  @override
  String get approvalFullBody =>
      'Acceso sin restricciones a internet y a cualquier archivo.';
}
