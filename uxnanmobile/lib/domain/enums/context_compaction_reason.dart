/// Why an agent compacted its conversation context.
enum ContextCompactionReason { manual, threshold, overflow, automatic, unknown }

/// Tolerant wire decoding for [ContextCompactionReason].
ContextCompactionReason contextCompactionReasonFromWire(Object? value) =>
    switch (value) {
      'manual' => ContextCompactionReason.manual,
      'threshold' => ContextCompactionReason.threshold,
      'overflow' => ContextCompactionReason.overflow,
      'automatic' => ContextCompactionReason.automatic,
      _ => ContextCompactionReason.unknown,
    };
