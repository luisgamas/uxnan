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
  String get devicesTitle => 'Mis PCs';

  @override
  String get deviceActive => 'Activa';

  @override
  String get deviceConnect => 'Conectar';

  @override
  String deviceConnectFailed(String device) {
    return 'No se pudo conectar con $device. Se mantiene la PC actual.';
  }

  @override
  String get deviceLastSeenLabel => 'Última conexión';

  @override
  String get deviceNeverConnected => 'Nunca conectado';

  @override
  String get devicePairedLabel => 'Pareado';

  @override
  String get deviceRename => 'Renombrar';

  @override
  String get deviceVerifyConnection => 'Verificar conexión';

  @override
  String get deviceVerifying => 'Comprobando el bridge…';

  @override
  String get deviceVerifyOk => 'El bridge responde.';

  @override
  String get deviceVerifyFailed => 'El bridge no respondió. Reconectando…';

  @override
  String get deviceNameTitle => 'Nombre del dispositivo';

  @override
  String get deviceNameHint => 'p. ej. MacBook del trabajo';

  @override
  String get actionSave => 'Guardar';

  @override
  String get actionCancel => 'Cancelar';

  @override
  String get threadsTitle => 'Conversaciones';

  @override
  String get threadsFilterAll => 'Todos';

  @override
  String get threadsEmpty => 'Aún no hay conversaciones';

  @override
  String get threadsNotConnected =>
      'Sin conexión con esta PC — vista en caché.';

  @override
  String get threadsEmptyBody =>
      'Las conversaciones de esta PC aparecerán aquí. Desliza para actualizar.';

  @override
  String get threadActionRename => 'Renombrar';

  @override
  String get threadActionCopyId => 'Copiar ID del hilo';

  @override
  String get threadActionArchive => 'Archivar';

  @override
  String get threadActionUnarchive => 'Desarchivar';

  @override
  String get threadActionDelete => 'Eliminar';

  @override
  String get archivedTitle => 'Archivados';

  @override
  String get archivedEmpty => 'No hay conversaciones archivadas';

  @override
  String get archivedEmptyBody =>
      'Las conversaciones que archivas se ocultan aquí, no se eliminan. Mantén pulsada una para desarchivarla.';

  @override
  String get threadRenameTitle => 'Renombrar hilo';

  @override
  String get threadRenameHint => 'Título del hilo';

  @override
  String get threadIdCopied => 'ID del hilo copiado';

  @override
  String get threadResponding => 'Respondiendo…';

  @override
  String get threadIdLabel => 'ID del hilo';

  @override
  String get threadDeleteTitle => '¿Eliminar hilo?';

  @override
  String get threadDeleteBody =>
      'Esto quita la conversación de este dispositivo.';

  @override
  String get threadDeleteConfirm => 'Eliminar';

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
  String get newThreadAction => 'Nueva conversación';

  @override
  String get newThreadTitle => 'Nueva conversación';

  @override
  String get newThreadProject => 'Proyecto';

  @override
  String get newThreadWorkingDir => 'Directorio de trabajo';

  @override
  String get newThreadBrowse => 'Examinar…';

  @override
  String get newThreadChangeFolder => 'Cambiar';

  @override
  String get newThreadFolderLabel => 'Carpeta';

  @override
  String get newThreadCapForking => 'Bifurcación';

  @override
  String get workspaceBrowseTitle => 'Elegir una carpeta';

  @override
  String get workspaceBrowseOpenHere => 'Abrir aquí';

  @override
  String get workspaceBrowseEmpty => 'No hay subcarpetas aquí';

  @override
  String get workspaceBrowseFailed => 'No se pudieron explorar las carpetas';

  @override
  String get workspaceBrowseGitRepo => 'Repositorio git';

  @override
  String get newThreadAgent => 'Agente';

  @override
  String get newThreadModel => 'Modelo (opcional)';

  @override
  String get newThreadModelHint => 'Modelo predeterminado';

  @override
  String get newThreadStart => 'Iniciar conversación';

  @override
  String get modelPickerTitle => 'Seleccionar modelo';

  @override
  String get modelPickerSearchHint => 'Buscar modelos';

  @override
  String get modelPickerLoadFailed => 'No se pudieron cargar los modelos';

  @override
  String get modelPickerEmpty => 'Sin modelos coincidentes';

  @override
  String get modelPickerDefault => 'Predeterminado';

  @override
  String get newThreadFailed => 'No se pudo iniciar la conversación';

  @override
  String get newThreadLoadFailed => 'No se pudo cargar desde el bridge';

  @override
  String get newThreadNoProjects => 'No hay proyectos disponibles en esta PC.';

  @override
  String get newThreadNoAgents => 'No hay agentes disponibles en esta PC.';

  @override
  String get newThreadAgentUnavailable => 'No disponible';

  @override
  String get newThreadCapStreaming => 'Streaming';

  @override
  String get newThreadCapPlan => 'Modo plan';

  @override
  String get newThreadCapApprovals => 'Aprobaciones';

  @override
  String get newThreadCapImages => 'Imágenes';

  @override
  String get environmentTitle => 'Entorno';

  @override
  String get environmentModel => 'Modelo';

  @override
  String get environmentActiveModel => 'Versión activa';

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

  @override
  String get gitActionsTitle => 'Control de versiones';

  @override
  String get gitCleanState => 'Árbol de trabajo limpio';

  @override
  String get gitDirtyState => 'Cambios sin confirmar';

  @override
  String get gitChangedFiles => 'Archivos modificados';

  @override
  String get gitCommitButton => 'Commit';

  @override
  String get gitPushButton => 'Push';

  @override
  String get gitCommitTitle => 'Confirmar cambios';

  @override
  String get gitCommitHint => 'Describe tus cambios…';

  @override
  String get gitNoRepository => 'Sin repositorio git';

  @override
  String get gitNoRepositoryBody =>
      'Abre un espacio de trabajo con un repositorio git para gestionar el control de versiones.';

  @override
  String get gitRecent => 'Actividad reciente';

  @override
  String get gitActionFailed => 'La acción de git falló';

  @override
  String get gitCommitSuccess => 'Cambios confirmados';

  @override
  String get gitPushSuccess => 'Push completado';

  @override
  String get gitStatusAdded => 'Añadido';

  @override
  String get gitStatusModified => 'Modificado';

  @override
  String get gitStatusDeleted => 'Eliminado';

  @override
  String get gitStatusRenamed => 'Renombrado';

  @override
  String get gitStatusUntracked => 'Sin seguimiento';

  @override
  String get pushChannelName => 'Actividad del agente';

  @override
  String get pushChannelDescription =>
      'Turnos completados y errores de tus agentes de código.';

  @override
  String get pushTurnCompletedTitle => 'Turno completado';

  @override
  String get pushTurnCompletedBody => 'Tu agente terminó un turno.';

  @override
  String get pushTurnErrorTitle => 'El turno falló';

  @override
  String get pushTurnErrorBody => 'Tu agente reportó un error.';
}
