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
      'Funciona con Claude Code, Codex, Gemini, OpenCode y Pi — y se están añadiendo más agentes. Sin lock-in.';

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
      'En la computadora donde viven tus agentes, instala el bridge una vez y luego inícialo:';

  @override
  String get onboardingInstallStepInstall => '1. Instala (una vez)';

  @override
  String get onboardingInstallStepStart => '2. Inicia el bridge';

  @override
  String get onboardingInstallRootNote =>
      'La carpeta donde inicies el bridge será su raíz. Desde tu teléfono verás todas las carpetas y repos que estén dentro de ella — así inicias el bridge una sola vez, no por cada proyecto.';

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
  String get qrCameraErrorTitle => 'Cámara no disponible';

  @override
  String get qrCameraErrorBody =>
      'No se pudo iniciar la cámara para escanear. Puedes emparejar con un código o intentar de nuevo.';

  @override
  String get actionRetry => 'Reintentar';

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
  String get actionApply => 'Aplicar';

  @override
  String get threadsTitle => 'Conversaciones';

  @override
  String get threadsFilterAll => 'Todos';

  @override
  String get threadsFilterByAgent => 'Agente';

  @override
  String get threadsFilterByProject => 'Proyecto';

  @override
  String get threadsFilterScopeTooltip => 'Alcance del filtro';

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
  String get threadActionFork => 'Bifurcar conversación';

  @override
  String get threadForkFailed => 'No se pudo bifurcar esta conversación';

  @override
  String get conversationLoadEarlier => 'Mostrar mensajes anteriores';

  @override
  String get conversationScrollToBottom => 'Ir al final';

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
  String get threadActionSessionInfo => 'Información de sesión';

  @override
  String get sessionInfoTitle => 'Información de sesión';

  @override
  String get sessionInfoAgentSessionLabel => 'ID de sesión del agente';

  @override
  String get sessionInfoUnavailable => 'Aún no disponible';

  @override
  String get sessionInfoResumeHint =>
      'Reanuda esta conversación desde la CLI del agente en tu PC.';

  @override
  String get sessionInfoCopied => 'Copiado al portapapeles';

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
  String get composerMentionFilesTitle => 'Archivos y carpetas';

  @override
  String get composerMentionLoading => 'Listando…';

  @override
  String get composerMentionEmpty => 'Ningún archivo coincide';

  @override
  String get composerMentionMore => 'Sigue escribiendo para acotar…';

  @override
  String get composerMentionNoWorkspace =>
      'No hay carpeta para esta conversación';

  @override
  String get composerMentionError => 'No se pudo listar esta carpeta';

  @override
  String get composerCommandsTitle => 'Comandos';

  @override
  String get composerCommandsEmpty => 'Ningún comando coincide';

  @override
  String get composerCmdFilesLabel => 'Adjuntar archivo o carpeta';

  @override
  String get composerCmdFilesDesc =>
      'Inserta una referencia con @ a un archivo o carpeta';

  @override
  String get composerCmdExplainLabel => 'Explicar';

  @override
  String get composerCmdExplainTemplate => 'Explica cómo funciona esto: ';

  @override
  String get composerCmdReviewLabel => 'Revisar';

  @override
  String get composerCmdReviewTemplate =>
      'Revisa esto en busca de errores y mejoras: ';

  @override
  String get composerCmdFixLabel => 'Corregir';

  @override
  String get composerCmdFixTemplate => 'Encuentra y corrige el error en: ';

  @override
  String get composerCmdTestsLabel => 'Pruebas';

  @override
  String get composerCmdTestsTemplate => 'Escribe pruebas para: ';

  @override
  String get settingsPromptTemplatesTitle => 'Plantillas de prompt';

  @override
  String get settingsPromptTemplatesSubtitle =>
      'Edita los atajos del palette de /';

  @override
  String get promptTemplatesTitle => 'Plantillas de prompt';

  @override
  String get promptTemplatesAdd => 'Nueva plantilla';

  @override
  String get promptTemplatesReset => 'Restaurar predeterminadas';

  @override
  String get promptTemplatesEmpty => 'Sin plantillas';

  @override
  String get promptTemplatesEmptyBody =>
      'Crea atajos que puedes insertar en un mensaje desde el palette de / del composer.';

  @override
  String get promptTemplatesNewTitle => 'Nueva plantilla';

  @override
  String get promptTemplatesEditTitle => 'Editar plantilla';

  @override
  String get promptTemplatesLabelField => 'Nombre';

  @override
  String get promptTemplatesLabelHint => 'p. ej. Revisar';

  @override
  String get promptTemplatesBodyField => 'Texto';

  @override
  String get promptTemplatesBodyHint => 'El texto que se inserta en el mensaje';

  @override
  String get promptTemplatesDeleteTitle => '¿Eliminar plantilla?';

  @override
  String promptTemplatesDeleteBody(String label) {
    return 'Se eliminará \"$label\".';
  }

  @override
  String get promptTemplatesDeleteConfirm => 'Eliminar';

  @override
  String get promptTemplatesResetTitle => '¿Restaurar plantillas?';

  @override
  String get promptTemplatesResetBody =>
      'Esto restaura las plantillas predeterminadas y descarta tus ediciones.';

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
  String get modelPickerRefresh => 'Actualizar modelos';

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
  String get newThreadCapAutonomous => 'Modo autónomo';

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
  String get approvalDecidedTitle => 'Decisión registrada';

  @override
  String get approvalAnsweredAt => 'Respondido';

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
  String get gitHistoryTitle => 'Historial';

  @override
  String get gitHistoryButton => 'Ver historial';

  @override
  String get gitHistoryListView => 'Lista';

  @override
  String get gitHistoryGraphView => 'Grafo';

  @override
  String get gitHistoryViewTooltip => 'Cambiar vista';

  @override
  String get gitHistoryCompact => 'Vista compacta';

  @override
  String get gitHistoryComfortable => 'Vista cómoda';

  @override
  String get gitHistoryShowGraph => 'Mostrar líneas del grafo';

  @override
  String get gitHistoryHideGraph => 'Ocultar líneas del grafo';

  @override
  String get gitHistoryBackToTop => 'Volver arriba';

  @override
  String get gitHistorySearch => 'Buscar commits';

  @override
  String get gitHistorySearchHint => 'Busca por mensaje, SHA o autor';

  @override
  String get gitHistorySearchEmpty => 'Ningún commit coincide';

  @override
  String get gitHistoryViewBranch => 'Ver rama o ref';

  @override
  String get gitHistoryPickBranchTitle => 'Ver historial de…';

  @override
  String get gitHistoryHeadOption => 'Rama actual (HEAD)';

  @override
  String get gitHistoryLocalSection => 'Ramas locales';

  @override
  String get gitHistoryRemoteSection => 'Ramas remotas';

  @override
  String gitHistoryViewingRef(String ref) {
    return 'Viendo $ref';
  }

  @override
  String get gitHistoryDiffSection => 'Diff';

  @override
  String get gitHistoryDiffTruncated =>
      'Diff truncado — demasiado grande para mostrarlo completo.';

  @override
  String get gitHistoryNoFileChanges => 'Este commit no cambió archivos.';

  @override
  String get gitHistoryNoTextDiff => 'Sin cambios de texto.';

  @override
  String get gitHistoryBinaryDiff => 'Archivo binario — sin diff de texto.';

  @override
  String gitHistoryRenamedFrom(String oldPath) {
    return 'desde $oldPath';
  }

  @override
  String get gitHistoryDetailLoadFailed => 'No se pudo cargar este commit';

  @override
  String get gitHistoryEmpty => 'Aún no hay commits';

  @override
  String get gitHistoryEmptyBody => 'Cuando confirmes cambios aparecerán aquí.';

  @override
  String get gitHistoryLoadMore => 'Cargar más antiguos';

  @override
  String get gitHistoryLoadingMore => 'Cargando…';

  @override
  String get gitHistoryErrorTitle => 'No se pudo cargar el historial';

  @override
  String get gitHistoryRetry => 'Reintentar';

  @override
  String get gitHistoryMergeBadge => 'Merge';

  @override
  String gitHistoryCommitBy(String name) {
    return 'por $name';
  }

  @override
  String get gitHistoryParentsLabel => 'Padres';

  @override
  String get gitHistoryDetailsTitle => 'Detalle del commit';

  @override
  String get gitHistoryDetailsMessage => 'Mensaje completo';

  @override
  String get gitHistoryDetailsAuthor => 'Autor';

  @override
  String get gitHistoryDetailsCommitter => 'Committer';

  @override
  String get gitHistoryDetailsDate => 'Fecha';

  @override
  String get gitHistoryDetailsStats => 'Cambios';

  @override
  String gitHistoryDetailsFiles(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count archivos modificados',
      one: '1 archivo modificado',
    );
    return '$_temp0';
  }

  @override
  String gitHistoryDetailsParents(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count padres',
      one: '1 padre',
    );
    return '$_temp0';
  }

  @override
  String get gitHistoryCopySha => 'Copiar SHA';

  @override
  String get gitHistoryCopiedSha => 'SHA copiado';

  @override
  String get gitHistoryCopyMessage => 'Copiar mensaje';

  @override
  String get gitHistoryCopiedMessage => 'Mensaje copiado';

  @override
  String gitHistoryFilesTouched(int additions, int deletions, int files) {
    return '$additions adiciones, $deletions eliminaciones, $files archivos';
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
  String get settingsContextIndicatorTitle => 'Indicador de contexto';

  @override
  String get settingsContextIndicatorSubtitle =>
      'Muestra el porcentaje de la ventana de contexto, el conteo de tokens, o ambos.';

  @override
  String get settingsContextIndicatorPercentage => 'Porcentaje';

  @override
  String get settingsContextIndicatorTokens => 'Tokens';

  @override
  String get settingsContextIndicatorBoth => 'Ambos';

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
  String get settingsModelsSection => 'Modelos';

  @override
  String get settingsClaudeLatestTitle =>
      'Mostrar modelos «latest» de Claude Code';

  @override
  String get settingsClaudeLatestSubtitle =>
      'Muestra los alias «(latest)» de Opus, Sonnet y Haiku en el selector de modelos.';

  @override
  String get settingsClaudeLatestHint =>
      'Los alias «(latest)» siempre usan la versión más reciente de cada nivel que tu cuenta puede utilizar, así no tienes que elegir una exacta. Desactívalo para ocultarlos y elegir solo versiones fijas y exactas. Las conversaciones que ya usan un alias siguen funcionando.';

  @override
  String get settingsAppearanceSection => 'Apariencia';

  @override
  String get settingsPersonalizationTitle => 'Personalización';

  @override
  String get settingsPersonalizationSubtitle =>
      'Tema, temas personalizados e idioma';

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
  String get themeCustom => 'Personalizado';

  @override
  String get personalizationCustomThemeSection => 'Tema personalizado';

  @override
  String get personalizationCustomThemeDescription =>
      'Diseña cada rol de color de Material 3, exporta a JSON o importa un tema compartido.';

  @override
  String get personalizationCustomThemeAuthor => 'Nuevo tema';

  @override
  String get personalizationCustomThemeAuthorSubtitle =>
      'Empieza desde un color semilla y ajusta cada rol';

  @override
  String get personalizationCustomThemeEdit => 'Editar tema actual';

  @override
  String get personalizationCustomThemeEditSubtitle =>
      'Ajusta los roles de color de claro y oscuro';

  @override
  String get personalizationCustomThemeReset => 'Usar el tema predeterminado';

  @override
  String get personalizationCustomThemeResetSubtitle =>
      'Descarta el tema personalizado y vuelve al tema base';

  @override
  String get customThemeEditorTitle => 'Tema personalizado';

  @override
  String get customThemeEditorLight => 'Claro';

  @override
  String get customThemeEditorDark => 'Oscuro';

  @override
  String get customThemeEditorName => 'Nombre';

  @override
  String get customThemeEditorDescription => 'Descripción';

  @override
  String get customThemeEditorNameHint => 'p. ej. Púrpura medianoche';

  @override
  String get customThemeEditorDescriptionHint => 'Opcional';

  @override
  String get customThemeEditorDeriveFromSeed => 'Derivar desde semilla';

  @override
  String get customThemeEditorSeedHint => 'Color semilla';

  @override
  String get customThemeEditorRole => 'Rol';

  @override
  String get customThemeEditorResetRole => 'Restablecer rol';

  @override
  String get customThemeEditorResetBrightness => 'Restablecer modo';

  @override
  String get customThemeEditorExport => 'Exportar';

  @override
  String get customThemeEditorImport => 'Importar';

  @override
  String get customThemeEditorSave => 'Guardar';

  @override
  String get customThemeEditorExportDialogTitle => 'JSON del tema';

  @override
  String get customThemeEditorExportDialogBody =>
      'Comparte el siguiente JSON — pégalo en cualquier dispositivo con tu cuenta para recrear el tema.';

  @override
  String get customThemeEditorImportDialogTitle => 'Importar tema';

  @override
  String get customThemeEditorImportDialogBody =>
      'Pega un JSON de tema exportado desde otro dispositivo.';

  @override
  String get customThemeEditorImportFieldHint => 'Pega aquí el JSON del tema';

  @override
  String get customThemeEditorCopied => 'JSON del tema copiado al portapapeles';

  @override
  String get customThemeEditorImported => 'Tema importado';

  @override
  String get customThemeEditorImportFailed =>
      'No se pudo importar el tema — revisa el JSON.';

  @override
  String get customThemeEditorResetConfirmTitle => '¿Restablecer tema?';

  @override
  String get customThemeEditorResetConfirmBody =>
      'Se descartará el tema personalizado actual y la app volverá al tema base.';

  @override
  String get customThemeEditorResetConfirmAction => 'Restablecer';

  @override
  String get customThemeEditorDeriveSeedTitle => 'Derivar desde semilla';

  @override
  String get customThemeEditorDeriveSeedBody =>
      'Elige un color semilla; todos los roles del modo seleccionado se regenerarán con Material 3.';

  @override
  String get customThemeEditorPickColorTitle => 'Elegir color';

  @override
  String get customThemeEditorResetRoleConfirm =>
      '¿Restablecer este rol a su valor derivado?';

  @override
  String get customThemeEditorDefaultName => 'Tema personalizado';

  @override
  String get customThemeEditorSaved => 'JSON del tema guardado';

  @override
  String get customThemeEditorSaveFailed =>
      'No se pudo guardar el JSON del tema';

  @override
  String get customThemeEditorShareFile => 'Compartir archivo';

  @override
  String get personalizationLanguageSection => 'Idioma';

  @override
  String get personalizationUseCustomThemeLabel => 'Usar tema personalizado';

  @override
  String get personalizationUseCustomThemeSubtitle =>
      'Sustituye Sistema/Claro/Oscuro por uno de tus temas guardados.';

  @override
  String get personalizationCustomThemesHeader => 'Temas personalizados';

  @override
  String get personalizationCustomThemeActiveBadge => 'Activo';

  @override
  String get personalizationCustomThemeBuiltInBadge => 'Integrado';

  @override
  String get personalizationCustomThemeExport => 'Exportar JSON';

  @override
  String get personalizationCustomThemeExportCopy => 'Copiar al portapapeles';

  @override
  String get personalizationCustomThemeExportFile => 'Guardar en archivo';

  @override
  String get personalizationCustomThemeNewDialogTitle =>
      'Nuevo tema personalizado';

  @override
  String get personalizationCustomThemeNewDialogBody =>
      'Elige un color semilla y el modo al que debe apuntar el nuevo tema.';

  @override
  String get personalizationCustomThemeDelete => 'Eliminar';

  @override
  String get personalizationCustomThemeDeleteConfirmTitle => '¿Eliminar tema?';

  @override
  String get personalizationCustomThemeDeleteConfirmBody =>
      'Esto eliminará el tema de tu biblioteca. No se puede deshacer.';

  @override
  String get personalizationCustomThemeDeleteConfirmAction => 'Eliminar';

  @override
  String get personalizationCustomThemeDeleteFailed =>
      'Los temas integrados no se pueden eliminar';

  @override
  String get personalizationCustomThemesImportAction => 'Importar tema';

  @override
  String get personalizationCustomThemesImportActionSubtitle =>
      'Pega un solo tema o una lista de temas como JSON';

  @override
  String get personalizationCustomThemesExportAllAction =>
      'Exportar todos los temas';

  @override
  String get personalizationCustomThemesExportAllActionSubtitle =>
      'Copia toda la biblioteca en un único documento JSON';

  @override
  String get personalizationCustomThemesResetAction => 'Restablecer biblioteca';

  @override
  String get personalizationCustomThemesResetActionSubtitle =>
      'Restaura los ejemplos integrados y descarta los temas creados';

  @override
  String get personalizationCustomThemesImportDialogTitle => 'Importar tema';

  @override
  String get personalizationCustomThemesImportDialogBody =>
      'Pega un JSON de tema exportado desde otro dispositivo. Puedes pegar un solo tema o un arreglo JSON para importar varios a la vez.';

  @override
  String get personalizationCustomThemesImportFieldHint =>
      'Pega aquí el JSON del tema';

  @override
  String get themeImportFromFile => 'Desde archivo';

  @override
  String get themeImportFromUrl => 'Desde URL';

  @override
  String get themeImportUrlTitle => 'Importar desde URL';

  @override
  String get themeImportUrlHint => 'https://…/tema.json';

  @override
  String get themeImportUrlFetch => 'Obtener';

  @override
  String get themeImportUrlInvalid => 'Ingresa una URL http(s):// válida.';

  @override
  String get themeImportUrlError => 'No se pudo obtener un tema de esa URL.';

  @override
  String get themeImportFileError => 'No se pudo leer ese archivo.';

  @override
  String get personalizationCustomThemesImportSuccess => 'Tema importado';

  @override
  String get personalizationCustomThemesImportPartial =>
      'Algunos temas no pudieron importarse';

  @override
  String get personalizationCustomThemesImportFailed =>
      'No se pudo importar — revisa el JSON';

  @override
  String get personalizationCustomThemesCopied =>
      'JSON del tema copiado al portapapeles';

  @override
  String get personalizationCustomThemesCopiedAll =>
      'JSON de la biblioteca copiado al portapapeles';

  @override
  String get personalizationCustomThemesSaved =>
      'JSON de la biblioteca guardado';

  @override
  String get personalizationCustomThemesSaveFailed =>
      'No se pudo guardar el JSON de la biblioteca';

  @override
  String get themeManagerTitle => 'Temas';

  @override
  String get themeManagerEmptyTitle => 'Aún no hay temas';

  @override
  String get themeManagerEmptyBody =>
      'Crea uno desde un color semilla o importa un JSON de tema.';

  @override
  String get themeBrightnessDual => 'Claro y oscuro';

  @override
  String get themeBrightnessLightOnly => 'Solo claro';

  @override
  String get themeBrightnessDarkOnly => 'Solo oscuro';

  @override
  String themeManagerSelectedCount(int count) {
    return '$count seleccionados';
  }

  @override
  String get themeManagerSelectAll => 'Seleccionar todo';

  @override
  String get themeManagerExitSelection => 'Cancelar selección';

  @override
  String get themeManagerDeleteSelectedTitle =>
      '¿Eliminar los temas seleccionados?';

  @override
  String themeManagerDeleteSelectedBody(int count) {
    return 'Esto elimina $count tema(s) de tu biblioteca. Los temas integrados se conservan y no se pueden eliminar. No se puede deshacer.';
  }

  @override
  String get themeManagerBuiltInsSkipped =>
      'Los temas integrados no se pueden eliminar y se conservaron.';

  @override
  String get themeNewSheetBody =>
      'Elige un color semilla. Generaremos un tema Material 3 completo (claro y oscuro) que podrás ajustar.';

  @override
  String get themeNewSheetCreate => 'Crear y editar';

  @override
  String get customThemeEditorAddDarkSide => 'Añadir lado oscuro';

  @override
  String get customThemeEditorAddLightSide => 'Añadir lado claro';

  @override
  String customThemeEditorSingleNote(String brightness) {
    return 'Solo está definido el lado $brightness; el otro se genera automáticamente.';
  }

  @override
  String personalizationManageThemesSubtitle(int count) {
    return '$count guardados';
  }

  @override
  String get languageSystemDefault => 'Predeterminado del sistema';

  @override
  String get appVersionStage => 'ALPHA';

  @override
  String get actionEnterCode => 'Ingresar un código';

  @override
  String get manualCodeTitle => 'Emparejar con código';

  @override
  String get manualCodeIntro =>
      'En tu PC, el bridge muestra un host y un código corto de emparejamiento. Ingrésalos aquí para emparejar sin escanear un QR.';

  @override
  String get manualCodeHostLabel => 'Host del bridge';

  @override
  String get manualCodeHostHint => '192.168.1.100:19850';

  @override
  String get manualCodeCodeLabel => 'Código de emparejamiento';

  @override
  String get manualCodeCodeHint => 'ej. 7Q4K2F9P';

  @override
  String get manualCodeConnect => 'Emparejar';

  @override
  String get manualCodeConnecting => 'Resolviendo código…';

  @override
  String get manualCodeFormTitle => 'Datos del bridge';

  @override
  String get manualCodeBrowse => 'Buscar bridges cercanos';

  @override
  String get manualCodeBrowseHint =>
      'Encuentra un bridge en tu Wi-Fi automáticamente';

  @override
  String get bridgeDiscoveryTitle => 'Bridges cercanos';

  @override
  String get bridgeDiscoverySearching => 'Buscando en tu red…';

  @override
  String get bridgeDiscoveryEmpty =>
      'Aún no se encontraron bridges. Asegúrate de que el bridge corre en la misma red Wi-Fi, o escribe el host abajo.';

  @override
  String get manualCodeErrorInvalidInput =>
      'Ingresa el host del bridge y el código de emparejamiento.';

  @override
  String get manualCodeErrorNetwork =>
      'No se pudo contactar al bridge. Revisa el host y que el bridge esté corriendo en la misma red.';

  @override
  String get manualCodeErrorInvalidCode =>
      'El código es incorrecto o expiró. Genera uno nuevo en tu PC.';

  @override
  String get manualCodeErrorRateLimited =>
      'Demasiados intentos. Espera un momento e inténtalo de nuevo.';

  @override
  String get manualCodeErrorServer =>
      'El bridge no pudo completar el emparejamiento. Inténtalo de nuevo.';

  @override
  String get manualCodeErrorPayload =>
      'El bridge envió una respuesta de emparejamiento inválida.';

  @override
  String get gitRevertLast => 'Revertir último commit';

  @override
  String get gitRevertConfirmTitle => '¿Revertir el último commit?';

  @override
  String get gitRevertConfirmBody =>
      'Crea un nuevo commit que deshace el último. Conserva el historial (a diferencia de Deshacer commit). Puedes empujarlo como cualquier commit.';

  @override
  String get gitRevertSuccess => 'Último commit revertido';

  @override
  String get gitRemoveWorktree => 'Eliminar worktree';

  @override
  String get gitRemoveWorktreeConfirmTitle => '¿Eliminar este worktree?';

  @override
  String get gitRemoveWorktreeConfirmBody =>
      'Borra la carpeta worktree que respalda esta conversación (la rama se conserva). El espacio de trabajo de la conversación dejará de existir.';

  @override
  String get gitRemoveWorktreeForceTitle => 'El worktree tiene cambios';

  @override
  String get gitRemoveWorktreeForceBody =>
      'El worktree tiene cambios sin confirmar o sin seguimiento. ¿Forzar la eliminación y perderlos?';

  @override
  String get gitForceRemove => 'Forzar eliminación';

  @override
  String get gitDeleteBranch => 'Eliminar rama';

  @override
  String get gitDeleteBranchConfirmTitle => '¿Eliminar rama?';

  @override
  String gitDeleteBranchConfirmBody(String branch) {
    return '¿Eliminar la rama local \"$branch\"?';
  }

  @override
  String get gitDeleteBranchForceTitle => 'Rama no fusionada';

  @override
  String gitDeleteBranchForceBody(String branch) {
    return '\"$branch\" no está completamente fusionada. ¿Forzar la eliminación y perder sus commits no fusionados?';
  }

  @override
  String get gitForceDelete => 'Forzar eliminación';

  @override
  String get conversationCwdMissing =>
      'La carpeta de esta conversación ya no existe. Reconéctate o elimínala.';

  @override
  String get conversationAutonomousMode =>
      'Este agente corre en modo autónomo: actúa y edita sin pedir aprobación primero.';

  @override
  String get fileBrowserTitle => 'Archivos';

  @override
  String get fileBrowserShowExtensions => 'Mostrar extensiones de archivo';

  @override
  String get fileBrowserShowHidden => 'Mostrar archivos ocultos';

  @override
  String get fileBrowserShowDetails => 'Mostrar detalles del archivo';

  @override
  String get fileBrowserCompactRows => 'Filas compactas';

  @override
  String get fileBrowserCollapseAll => 'Contraer todas las carpetas';

  @override
  String get fileBrowserCopyPath => 'Copiar ruta del workspace';

  @override
  String get fileBrowserPathCopied => 'Ruta del workspace copiada';

  @override
  String get fileBrowserEmpty => 'Esta carpeta está vacía';

  @override
  String get fileBrowserEmptyTitle => 'Nada por aquí';

  @override
  String get fileBrowserLoadFailed => 'No se pudo cargar el workspace';

  @override
  String get fileBrowserOpenTooltip => 'Explorar archivos';

  @override
  String get fileViewerViewSource => 'Ver código fuente';

  @override
  String get fileViewerViewPreview => 'Ver vista previa';

  @override
  String get fileViewerShowDiff => 'Mostrar diff';

  @override
  String get fileViewerHideDiff => 'Ocultar diff';

  @override
  String get fileViewerCopy => 'Copiar archivo';

  @override
  String get fileViewerCopied => 'Archivo copiado';

  @override
  String get fileViewerCopyFailed => 'No se pudo copiar este archivo';

  @override
  String fileViewerLinkCopied(String href) {
    return 'Enlace copiado: $href';
  }

  @override
  String get fileViewerBinaryTitle => 'Archivo binario';

  @override
  String get fileViewerBinaryBody =>
      'Los archivos binarios no se pueden previsualizar en el teléfono. Descárgalo a tu PC para inspeccionarlo.';

  @override
  String get fileViewerLoadFailed => 'No se pudo abrir este archivo';

  @override
  String get fileViewerModePreview => 'Vista previa';

  @override
  String get fileViewerModeSource => 'Fuente';

  @override
  String get fileViewerEdit => 'Editar archivo';

  @override
  String get fileViewerSave => 'Guardar';

  @override
  String get fileViewerSaved => 'Archivo guardado';

  @override
  String fileViewerSaveFailed(String error) {
    return 'No se pudo guardar este archivo: $error';
  }

  @override
  String get fileViewerDiscardTitle => '¿Descartar cambios?';

  @override
  String get fileViewerDiscardBody =>
      'Tus cambios en este archivo no se han guardado. ¿Descartarlos?';

  @override
  String get fileViewerDiscard => 'Descartar';

  @override
  String get fileViewerKeepEditing => 'Seguir editando';

  @override
  String get settingsUpdatesSection => 'Actualizaciones';

  @override
  String get updateCheckTitle => 'Buscar actualizaciones';

  @override
  String get updateCheckSubtitle =>
      'Comprueba si hay una versión más reciente de Uxnan.';

  @override
  String get updateCheckAction => 'Buscar ahora';

  @override
  String get updateStatusChecking => 'Buscando actualizaciones…';

  @override
  String get updateStatusUpToDate => 'Tienes la última versión.';

  @override
  String get updateStatusUnsupported =>
      'Las actualizaciones dentro de la app no están disponibles para esta versión.';

  @override
  String get updateStatusError =>
      'No se pudo buscar actualizaciones. Inténtalo más tarde.';

  @override
  String get updateAvailableTitle => 'Actualización disponible';

  @override
  String get updateAvailableBody =>
      'Hay una nueva versión de Uxnan lista para instalar.';

  @override
  String updateAvailableBodyVersion(String version) {
    return 'Uxnan $version está lista para instalar.';
  }

  @override
  String get updateAction => 'Actualizar';

  @override
  String get updateActionStarting => 'Iniciando…';

  @override
  String get updateDismissAction => 'Ahora no';

  @override
  String get bridgeUpdateTitle => 'Actualización del bridge disponible';

  @override
  String get bridgeUpdateBody =>
      'El bridge de Uxnan en tu PC está desactualizado. Actualízalo en tu computadora para obtener las últimas mejoras y correcciones.';

  @override
  String bridgeUpdateBodyVersion(String version) {
    return 'Hay un bridge más reciente ($version) disponible. Actualízalo en tu computadora para obtener las últimas mejoras y correcciones.';
  }

  @override
  String get bridgeUpdateDismiss => 'Descartar';

  @override
  String get updateWhatsNewLabel => 'Novedades';

  @override
  String get updateCurrentVersionTitle => 'Versión actual';

  @override
  String get updateDownloadAction => 'Descargar';

  @override
  String get updateInstallAction => 'Instalar ahora';

  @override
  String get updateStatusDownloading => 'Descargando actualización…';

  @override
  String updateStatusDownloadingPercent(int percent) {
    return 'Descargando actualización… $percent%';
  }

  @override
  String get updateStatusDownloaded =>
      'Actualización descargada — lista para instalar.';

  @override
  String get updateStatusInstalling => 'Instalando actualización…';

  @override
  String get updateIntervalSectionTitle => 'Buscar automáticamente';

  @override
  String get updateIntervalEveryLaunch => 'En cada inicio';

  @override
  String get updateIntervalEvery6h => 'Cada 6 horas';

  @override
  String get updateIntervalEvery12h => 'Cada 12 horas';

  @override
  String get updateIntervalEvery24h => 'Cada día';

  @override
  String get updateIntervalEvery48h => 'Cada 2 días';

  @override
  String get updateIntervalWeekly => 'Cada semana';

  @override
  String get updateIntervalMonthly => 'Cada mes';

  @override
  String get settingsNotificationsNavSubtitle =>
      'Respuestas, errores y entrega';

  @override
  String get settingsConversationNavSubtitle =>
      'Razonamiento, modelos, contexto y plantillas';

  @override
  String get settingsModelsNavSubtitle => 'Opciones del selector de modelos';

  @override
  String get settingsGitNavSubtitle => 'Confirmaciones de push y pull request';

  @override
  String get settingsUpdatesNavSubtitle =>
      'Versión, programación de búsqueda e instalación';

  @override
  String get settingsAboutSection => 'Acerca de';

  @override
  String get settingsAboutTitle => 'Acerca de Uxnan';

  @override
  String get settingsAboutSubtitle =>
      'Información de la app y del desarrollador';

  @override
  String get settingsLicensesTitle => 'Licencias de código abierto';

  @override
  String get settingsLicensesSubtitle => 'Paquetes de terceros que usa Uxnan';

  @override
  String get aboutDescription =>
      'Controla tus agentes de código de la PC desde tu teléfono, con cifrado de extremo a extremo.';

  @override
  String get aboutDeveloperSection => 'Desarrollador';

  @override
  String get aboutSourceCodeTitle => 'Código fuente';

  @override
  String get aboutSourceCodeSubtitle => 'Ver el proyecto en GitHub';

  @override
  String get aboutLegalSection => 'Legal';

  @override
  String aboutVersionLabel(String version) {
    return 'Versión $version';
  }

  @override
  String get licensesEmpty => 'No se encontraron licencias.';

  @override
  String licenseCountLabel(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count licencias',
      one: '1 licencia',
    );
    return '$_temp0';
  }

  @override
  String get settingsGeneralSection => 'General';

  @override
  String get settingsWorkspaceSection => 'Espacio de trabajo';

  @override
  String get settingsSystemSection => 'Sistema';

  @override
  String get settingsConversationAgentsGroup => 'Agentes';

  @override
  String get settingsConversationClaudeGroup => 'Claude';

  @override
  String get settingsConversationChatGroup => 'Conversación';

  @override
  String get settingsNotificationsEventsGroup => 'Eventos del agente';

  @override
  String get settingsGitConfirmationsGroup => 'Confirmaciones';

  @override
  String get settingsUpdatesVersionGroup => 'Versión';

  @override
  String get licensesError => 'No se pudieron cargar las licencias.';
}
