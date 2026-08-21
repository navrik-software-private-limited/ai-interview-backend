// docFiles/L3-05 §1. Rule: "the report must preserve the original event
// timestamps and evidence — never collapse proctoring data into a single
// pass/fail flag." Pure JS grouping over already-persisted
// dbo.proctoring_events rows (proctoring/proctoringEventRepository.js) — no
// summarization of any kind exists anywhere else in the codebase today (the
// live scoreTracker.js is Redis-only/ephemeral, never persisted), so this is
// built fresh at report-generation time, not reused from elsewhere.
function summarizeProctoring(proctoringEvents) {
  const bySeverity = {};
  for (const event of proctoringEvents) {
    if (!bySeverity[event.severity]) bySeverity[event.severity] = [];
    bySeverity[event.severity].push({
      eventType: event.eventType,
      timestamp: event.timestamp,
      durationMs: event.durationMs,
      evidence: event.evidence,
    });
  }

  return {
    totalEvents: proctoringEvents.length,
    bySeverity: Object.fromEntries(
      Object.entries(bySeverity).map(([severity, events]) => [severity, { count: events.length, events }])
    ),
  };
}

module.exports = { summarizeProctoring };
