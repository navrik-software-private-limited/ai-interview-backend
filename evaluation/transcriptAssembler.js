// docFiles/L3-04 §1: the full transcript, and the Q&A pairing every other
// evaluation/ module builds on. Pure data transform, no LLM call.
//
// There is no question<->answer FK anywhere in this schema (confirmed via
// database/schema.sql) — interview_questions_asked has no answer_text/answer
// column. Pairing is reconstructed by time-correlating each question's
// asked_at/completed_at window against interview_transcripts rows tagged
// speaker='candidate', both already ordered by `sequence`. CODING section
// questions never get interview_questions_asked rows (updateSessionSection
// is called with a null question id there) — coding submissions are handled
// entirely separately, via evaluation/sessionDataLoader.js's codingSubmissions.

function candidateAnswerFor(question, transcripts) {
  const askedAt = new Date(question.askedAt).getTime();
  // completed_at can be null in edge cases (e.g. the interview ended mid-answer)
  // — fall back to "no upper bound" rather than dropping the answer entirely.
  const completedAt = question.completedAt ? new Date(question.completedAt).getTime() : Infinity;

  const candidateTurns = transcripts.filter((t) => {
    if (t.speaker !== "candidate") return false;
    const ts = new Date(t.timestamp).getTime();
    return ts >= askedAt && ts <= completedAt;
  });

  return candidateTurns.map((t) => t.transcript).join(" ").trim();
}

// Interview Room MCQ interaction type: an MCQ answer is a selected option,
// never a spoken utterance — it produces no interview_transcripts row, so
// the time-correlation trick candidateAnswerFor relies on can't find it.
// Resolves the answer directly from the persisted options/selected_option
// instead. Returns "" (not a placeholder string) when nothing was selected
// (skipped question) — matches candidateAnswerFor's own "no answer" shape.
function mcqAnswerFor(question) {
  if (!question.selectedOption) return "";
  const options = Array.isArray(question.options) ? question.options : [];
  const selected = options.find((o) => o.key === question.selectedOption);
  return selected ? `${question.selectedOption}) ${selected.text}` : question.selectedOption;
}

function answerTextFor(question, transcripts) {
  return question.interactionType === "MCQ" ? mcqAnswerFor(question) : candidateAnswerFor(question, transcripts);
}

// Builds the nested Q&A tree: top-level questions (is_followup=false) each
// carry their own answer plus a `followUps[]` array of child question+answer
// pairs (docFiles/L3-04 §1.1: "follow-up chains must remain visually/
// structurally linked to their parent question").
function assembleQuestionAnswerTree(questionsAsked, transcripts) {
  const byId = new Map();
  for (const q of questionsAsked) {
    byId.set(q.id, {
      questionAskedId: q.id,
      section: q.section,
      sequence: q.sequence,
      questionText: q.questionText,
      interactionType: q.interactionType || "VOICE_QA",
      options: q.options || null,
      correctOption: q.correctOption || null,
      selectedOption: q.selectedOption || null,
      answerText: answerTextFor(q, transcripts),
      askedAt: q.askedAt,
      completedAt: q.completedAt,
      followUps: [],
    });
  }

  const roots = [];
  for (const q of questionsAsked) {
    const node = byId.get(q.id);
    if (q.isFollowUp && q.parentQuestionId && byId.has(q.parentQuestionId)) {
      byId.get(q.parentQuestionId).followUps.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// Flat chronological transcript for the report's "Candidate Transcripts"
// section (docFiles/L3-04 §1) — every turn, tagged with the question it
// falls under (nearest question whose asked_at/completed_at window contains
// it), speaker, and timestamp. Distinct from the nested tree above, which is
// for scoring; this is for display.
function assembleFlatTranscript(questionsAsked, transcripts) {
  const sorted = [...questionsAsked].sort((a, b) => new Date(a.askedAt) - new Date(b.askedAt));

  function questionIdFor(timestampMs) {
    let current = null;
    for (const q of sorted) {
      const askedAt = new Date(q.askedAt).getTime();
      if (askedAt > timestampMs) break;
      current = q.id;
    }
    return current;
  }

  return transcripts.map((t) => ({
    speaker: t.speaker === "ai" ? "Interviewer" : "Candidate",
    text: t.transcript,
    timestamp: t.timestamp,
    questionAskedId: questionIdFor(new Date(t.timestamp).getTime()),
  }));
}

function assembleTranscript({ questionsAsked, transcripts }) {
  return {
    questionAnswerTree: assembleQuestionAnswerTree(questionsAsked, transcripts),
    flatTranscript: assembleFlatTranscript(questionsAsked, transcripts),
  };
}

module.exports = { assembleTranscript };
