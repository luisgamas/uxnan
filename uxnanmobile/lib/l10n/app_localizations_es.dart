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
  String get connectionRelay => 'Relay';

  @override
  String get connectionDirect => 'Directa';

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
  String get deviceRemove => 'Eliminar dispositivo';

  @override
  String deviceRemoveTitle(String device) {
    return '¿Eliminar $device?';
  }

  @override
  String get deviceRemoveBody =>
      'Elimina esta PC y sus conversaciones de tu teléfono. Puedes volver a vincularla cuando quieras.';

  @override
  String get deviceRemoveConfirm => 'Eliminar';

  @override
  String get actionSave => 'Guardar';

  @override
  String get actionCancel => 'Cancelar';

  @override
  String get threadsTitle => 'Conversaciones';

  @override
  String get threadsFilterAll => 'Todos';

  @override
  String get threadsViewOptions => 'Opciones de vista';

  @override
  String get threadsSortBy => 'Ordenar por';

  @override
  String get threadsSortCreated => 'Fecha de creación';

  @override
  String get threadsSortName => 'Nombre';

  @override
  String get threadsSortFolder => 'Carpeta';

  @override
  String get threadsCompact => 'Lista compacta';

  @override
  String get threadsMore => 'Más opciones';

  @override
  String get threadsSearch => 'Buscar conversaciones';

  @override
  String get threadsSearchHint => 'Busca por nombre, ID, agente o carpeta';

  @override
  String get threadsSearchEmpty => 'Ninguna conversación coincide';

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
  String get conversationThinking => 'Razonamiento';

  @override
  String get conversationWorkLog => 'Registro de actividad';

  @override
  String get conversationChangedFiles => 'Archivos modificados';

  @override
  String get conversationCopyResponse => 'Copiar respuesta';

  @override
  String get conversationResponseCopied => 'Respuesta copiada';

  @override
  String get conversationCopyMessage => 'Copiar mensaje';

  @override
  String get conversationMessageCopied => 'Mensaje copiado';

  @override
  String get conversationLastEdits => 'Últimos cambios';

  @override
  String conversationFilesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count archivos',
      one: '1 archivo',
    );
    return '$_temp0';
  }

  @override
  String get composerHint => 'Mensaje…';

  @override
  String get composerSend => 'Enviar';

  @override
  String get composerAttach => 'Adjuntar';

  @override
  String get composerAttachGallery => 'Galería de fotos';

  @override
  String get composerAttachCamera => 'Tomar una foto';

  @override
  String get composerAttachFailed => 'No se pudo adjuntar esa imagen';

  @override
  String get composerStop => 'Detener';

  @override
  String get composerVoice => 'Entrada de voz';

  @override
  String get composerVoiceStop => 'Detener dictado';

  @override
  String get composerVoiceUnavailable =>
      'La entrada de voz no está disponible en este dispositivo.';

  @override
  String get composerOptionsShow => 'Mostrar opciones';

  @override
  String get composerOptionsHide => 'Ocultar opciones';

  @override
  String get composerTools => 'Opciones del turno';

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
  String get workspaceBrowseUp => 'Subir un nivel';

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
  String get newThreadCapabilities => 'Capacidades';

  @override
  String get newThreadWorktree => 'Usar un worktree';

  @override
  String get newThreadWorktreeDesc =>
      'Crea un checkout aislado en una rama para que esta conversación no toque tu árbol de trabajo actual.';

  @override
  String get newThreadWorktreeBranchHint => 'Nombre de la rama';

  @override
  String get newThreadWorktreeManaged => 'Que el bridge elija la ubicación';

  @override
  String get newThreadWorktreeFailed => 'No se pudo crear el worktree';

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
  String get approvalNeedsApproval => 'Requiere aprobación';

  @override
  String get approvalActionFallback => 'Acción en espera de aprobación';

  @override
  String get approvalApprove => 'Aprobar';

  @override
  String get approvalReject => 'Rechazar';

  @override
  String get approvalAllowSession => 'Permitir siempre esta sesión';

  @override
  String get approvalApproved => 'Aprobado';

  @override
  String get approvalRejected => 'Rechazado';

  @override
  String get approvalAllowedSession => 'Permitido en esta sesión';

  @override
  String get approvalFailed => 'No se pudo enviar tu respuesta; reintenta';

  @override
  String get approvalRiskLow => 'Riesgo bajo';

  @override
  String get approvalRiskMedium => 'Riesgo medio';

  @override
  String get approvalRiskHigh => 'Riesgo alto';

  @override
  String get approvalRiskUnknown => 'Riesgo desconocido';

  @override
  String get runOptionAuto => 'Automático';

  @override
  String get authRequiresLoginTitle => 'Agente sin sesión iniciada';

  @override
  String get authRequiresLoginBody =>
      'Inicia sesión en la CLI de este agente en tu PC para empezar a enviar mensajes.';

  @override
  String get authLoginInProgress => 'Iniciando sesión en tu PC…';

  @override
  String get agentSignInRequired => 'Falta iniciar sesión';

  @override
  String get agentCheckSignIn => 'Comprobar sesión';

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
  String get gitSelectAll => 'Seleccionar todo';

  @override
  String get gitDeselectAll => 'Deseleccionar todo';

  @override
  String gitSelectedCount(int count, int total) {
    return '$count de $total seleccionados';
  }

  @override
  String get gitExpandAll => 'Expandir todo';

  @override
  String get gitCollapseAll => 'Contraer todo';

  @override
  String get gitDiffEmpty => 'Sin cambios de texto para mostrar.';

  @override
  String get gitDiffError => 'No se pudo cargar el diff de este archivo.';

  @override
  String get gitCommitMessageLabel => 'Título del commit';

  @override
  String get gitCommitDescriptionLabel => 'Descripción (opcional)';

  @override
  String get gitCommitDescriptionHint =>
      'Agrega más detalle sobre estos cambios…';

  @override
  String get gitCommitTitleRequired => 'Escribe un título de commit';

  @override
  String get gitCommitScopeAll => 'Confirmando todos los cambios';

  @override
  String gitCommitScopeSelected(int count) {
    return 'Confirmando $count archivo(s) seleccionado(s)';
  }

  @override
  String get gitCoAuthorAdd => 'Agregar Co-autor';

  @override
  String get gitCoAuthorLabel => 'Co-autor';

  @override
  String get gitCoAuthorHint => 'Nombre <correo>';

  @override
  String get gitCoAuthorInvalid => 'Usa el formato: Nombre <correo>';

  @override
  String get gitDiscard => 'Descartar';

  @override
  String get gitDiscardSelected => 'Descartar seleccionados';

  @override
  String get gitDiscardAll => 'Descartar todo';

  @override
  String get gitDiscardConfirmTitle => '¿Descartar cambios?';

  @override
  String gitDiscardConfirmBody(int count) {
    return '$count archivo(s) volverán al último commit y los archivos nuevos se eliminarán. Esto no se puede deshacer.';
  }

  @override
  String get gitDiscardSuccess => 'Cambios descartados';

  @override
  String get gitCreatePr => 'Crear PR';

  @override
  String get gitPrDialogTitle => 'Abrir pull request';

  @override
  String get gitPrTitleLabel => 'Título';

  @override
  String get gitPrBodyLabel => 'Descripción (opcional)';

  @override
  String get gitPrBaseLabel => 'Rama destino (base)';

  @override
  String get gitPrHeadLabel => 'Rama origen (head)';

  @override
  String get gitPrPushNote =>
      'La rama origen se sube al remoto antes de abrir el PR.';

  @override
  String get gitPrTitleRequired => 'Escribe un título de PR';

  @override
  String get gitPrCreate => 'Crear';

  @override
  String get gitPrSuccess => 'Pull request abierto';

  @override
  String get gitPrViewAction => 'Ver';

  @override
  String get gitCancel => 'Cancelar';

  @override
  String get gitSelectFilesFirst => 'Selecciona al menos un archivo';

  @override
  String get gitNothingToCommit => 'No hay cambios para confirmar';

  @override
  String get gitRefresh => 'Actualizar';

  @override
  String get gitUndoCommit => 'Deshacer último commit';

  @override
  String get gitUndoCommitConfirmTitle => '¿Deshacer último commit?';

  @override
  String get gitUndoCommitConfirmBody =>
      'Se deshace el último commit pero se conservan sus cambios, para que puedas ajustar y volver a confirmar antes de subir.';

  @override
  String get gitUndoCommitSuccess => 'Último commit deshecho';

  @override
  String get gitPushConfirmTitle => '¿Subir commits?';

  @override
  String get gitPushConfirmBody =>
      'Esto publica tus commits en el remoto y no se puede deshacer.';

  @override
  String get gitPrConfirmTitle => '¿Abrir pull request?';

  @override
  String get gitPrConfirmBody =>
      'Un pull request no se puede eliminar del repositorio, pero puedes cerrarlo después desde la app o el sitio de GitHub.';

  @override
  String get gitPrFailed => 'No se pudo abrir el pull request';

  @override
  String get gitSwitchBranch => 'Cambiar de rama';

  @override
  String get gitPull => 'Traer (pull)';

  @override
  String get gitPullSuccess => 'Traído del remoto';

  @override
  String get gitNewBranch => 'Nueva rama';

  @override
  String get gitNewBranchHint => 'Nombre de la rama';

  @override
  String get gitNewBranchSuccess => 'Rama creada y activada';

  @override
  String get gitNewWorktree => 'Nuevo worktree';

  @override
  String get gitNewWorktreeSuccess => 'Worktree creado';

  @override
  String get gitSwitchBranchTitle => 'Cambiar de rama';

  @override
  String gitSwitchBranchCurrent(String branch) {
    return 'En $branch';
  }

  @override
  String get gitSwitchCarryTitle => '¿Mover tus cambios?';

  @override
  String gitSwitchCarryBody(String target, String current) {
    return 'Tienes cambios sin confirmar. ¿Llevarlos a $target o dejarlos en $current? Los cambios que dejes se guardan y se restauran al volver.';
  }

  @override
  String get gitSwitchCarry => 'Llevar cambios';

  @override
  String get gitSwitchLeave => 'Dejar en la actual';

  @override
  String gitSwitchSuccess(String branch) {
    return 'Cambiado a $branch';
  }

  @override
  String get pushChannelName => 'Actividad del agente';

  @override
  String get pushChannelDescription =>
      'Turnos completados y errores de tus agentes de código.';

  @override
  String get pushFallbackTitle => 'Uxnan';

  @override
  String pushTurnCompletedBody(String agent) {
    return '$agent te respondió';
  }

  @override
  String pushTurnErrorBody(String agent) {
    return '$agent reportó un error';
  }

  @override
  String get settingsTitle => 'Ajustes';

  @override
  String get settingsNotificationsSection => 'Notificaciones';

  @override
  String get settingsNotificationsHint =>
      'Elige qué eventos del agente te notifican. Aplica a las notificaciones push en segundo plano y a las del dispositivo.';

  @override
  String get settingsTurnCompletedTitle => 'Respuestas';

  @override
  String get settingsTurnCompletedSubtitle =>
      'Notificarme cuando un agente termina de responder.';

  @override
  String get settingsTurnErrorTitle => 'Errores';

  @override
  String get settingsTurnErrorSubtitle =>
      'Notificarme cuando falla la ejecución de un agente.';

  @override
  String get settingsConversationSection => 'Conversación';

  @override
  String get settingsShowThinkingTitle => 'Mostrar el razonamiento del agente';

  @override
  String get settingsShowThinkingSubtitle =>
      'Muestra el razonamiento del agente en una sección colapsable.';

  @override
  String get settingsScrollOnSendTitle => 'Ir al final al enviar';

  @override
  String get settingsScrollOnSendSubtitle =>
      'Salta a tu mensaje al enviarlo, aunque hayas subido el scroll.';

  @override
  String get settingsGitSection => 'Control de versiones';

  @override
  String get settingsConfirmPushTitle => 'Confirmar antes de subir (push)';

  @override
  String get settingsConfirmPushSubtitle =>
      'Preguntar antes de hacer push — un push no se puede deshacer.';

  @override
  String get settingsConfirmPrTitle => 'Confirmar antes de pull request';

  @override
  String get settingsConfirmPrSubtitle =>
      'Preguntar antes de abrir un pull request.';

  @override
  String get settingsAppearanceSection => 'Apariencia';

  @override
  String get settingsPersonalizationTitle => 'Personalización';

  @override
  String get settingsPersonalizationSubtitle =>
      'Tema, color de acento e idioma';

  @override
  String get personalizationTitle => 'Personalización';

  @override
  String get personalizationThemeSection => 'Tema';

  @override
  String get themeSystem => 'Sistema';

  @override
  String get themeLight => 'Claro';

  @override
  String get themeDark => 'Oscuro';

  @override
  String get personalizationAccentSection => 'Color de acento';

  @override
  String get personalizationAccentComingSoon => 'Próximamente';

  @override
  String get personalizationAccentComingSoonBody =>
      'Los colores de acento personalizados están en diseño — llegarán cuando se mantengan coherentes en toda la app.';

  @override
  String get personalizationLanguageSection => 'Idioma';

  @override
  String get languageSystemDefault => 'Predeterminado del sistema';

  @override
  String get appTitleMobile => 'Uxnan Móvil';

  @override
  String get appVersionStage => 'ALPHA';
}
