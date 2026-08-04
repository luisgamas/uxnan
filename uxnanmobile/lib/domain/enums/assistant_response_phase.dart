/// The role a native assistant message plays inside one agent turn.
enum AssistantResponsePhase { commentary, finalAnswer, unknown }

/// Decodes the bridge wire value without rejecting newer phases.
AssistantResponsePhase assistantResponsePhaseFromWire(Object? value) =>
    switch (value) {
      'commentary' => AssistantResponsePhase.commentary,
      'final_answer' => AssistantResponsePhase.finalAnswer,
      _ => AssistantResponsePhase.unknown,
    };

/// Encodes the phase using the shared bridge contract.
String assistantResponsePhaseToWire(AssistantResponsePhase phase) =>
    switch (phase) {
      AssistantResponsePhase.commentary => 'commentary',
      AssistantResponsePhase.finalAnswer => 'final_answer',
      AssistantResponsePhase.unknown => 'unknown',
    };
