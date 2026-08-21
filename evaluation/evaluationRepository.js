const { getPool, sql } = require("../config/database");

// Same raw-parameterized-mssql/mapRow convention as admin/adminConfigRepository.js.
// Unlike the hot-path repositories elsewhere (session/sessionRepository.js,
// proctoring/proctoringEventRepository.js, coding/codingSubmissionRepository.js),
// which swallow write errors so a live interview is never broken by a logging
// failure, this repository lets errors propagate — it only ever runs after a
// session has ended, so there's no live loop to protect, and
// evaluationPipeline.js's single top-level catch is what turns a failure here
// into a `FAILED` report status instead of leaving nothing persisted at all.

function mapQuestionEvaluationRow(row) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    questionAskedId: row.questionAskedId,
    section: row.section,
    questionText: row.questionText,
    answerText: row.answerText,
    score: row.score,
    understandingLevel: row.understandingLevel,
    whatWasGood: row.whatWasGood ? JSON.parse(row.whatWasGood) : [],
    whatCouldImprove: row.whatCouldImprove ? JSON.parse(row.whatCouldImprove) : [],
    improvementSuggestion: row.improvementSuggestion,
    betterAnswer: row.betterAnswer,
    createdAt: row.createdAt,
  };
}

async function insertQuestionEvaluation(sessionId, questionAskedId, evaluation) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .input("questionAskedId", sql.UniqueIdentifier, questionAskedId)
    .input("section", sql.VarChar, evaluation.section)
    .input("questionText", sql.NVarChar, evaluation.questionText)
    .input("answerText", sql.NVarChar, evaluation.answerText || null)
    .input("score", sql.Decimal(4, 2), evaluation.score)
    .input("understandingLevel", sql.VarChar, evaluation.understandingLevel || null)
    .input("whatWasGood", sql.NVarChar, JSON.stringify(evaluation.whatWasGood || []))
    .input("whatCouldImprove", sql.NVarChar, JSON.stringify(evaluation.whatCouldImprove || []))
    .input("improvementSuggestion", sql.NVarChar, evaluation.improvementSuggestion || null)
    .query(`
      INSERT INTO dbo.interview_question_evaluations
        (id, session_id, question_asked_id, section, question_text, answer_text, score,
         understanding_level, what_was_good, what_could_improve, improvement_suggestion)
      OUTPUT INSERTED.id
      VALUES
        (NEWID(), @sessionId, @questionAskedId, @section, @questionText, @answerText, @score,
         @understandingLevel, @whatWasGood, @whatCouldImprove, @improvementSuggestion)
    `);
  return result.recordset[0].id;
}

async function updateBetterAnswer(questionEvaluationId, betterAnswer) {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.UniqueIdentifier, questionEvaluationId)
    .input("betterAnswer", sql.NVarChar, betterAnswer)
    .query(`UPDATE dbo.interview_question_evaluations SET better_answer = @betterAnswer WHERE id = @id`);
}

async function fetchQuestionEvaluations(sessionId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .query(`
      SELECT id, session_id AS sessionId, question_asked_id AS questionAskedId, section,
             question_text AS questionText, answer_text AS answerText, score,
             understanding_level AS understandingLevel, what_was_good AS whatWasGood,
             what_could_improve AS whatCouldImprove, improvement_suggestion AS improvementSuggestion,
             better_answer AS betterAnswer, created_at AS createdAt
      FROM dbo.interview_question_evaluations
      WHERE session_id = @sessionId
      ORDER BY created_at ASC
    `);
  return result.recordset.map(mapQuestionEvaluationRow);
}

// One row per session — upsert since evaluationPipeline.js only ever writes
// this once, at the end of the aggregation stage.
async function upsertEvaluation(sessionId, evaluation) {
  const pool = await getPool();
  await pool
    .request()
    .input("sessionId", sql.UniqueIdentifier, sessionId)
    .input("overallScore", sql.Decimal(5, 2), evaluation.overallScore)
    .input("categoryScores", sql.NVarChar, JSON.stringify(evaluation.categoryScores || {}))
    .input("skillResults", sql.NVarChar, JSON.stringify(evaluation.skillResults || {}))
    .input("evidenceTrace", sql.NVarChar, JSON.stringify(evaluation.evidenceTrace || {}))
    .input("strengths", sql.NVarChar, JSON.stringify(evaluation.strengths || []))
    .input("weaknesses", sql.NVarChar, JSON.stringify(evaluation.weaknesses || []))
    .input("languageProfile", sql.NVarChar, JSON.stringify(evaluation.languageProfile || {}))
    .input("softSkills", sql.NVarChar, JSON.stringify(evaluation.softSkills || {}))
    .query(`
      MERGE dbo.interview_evaluations AS target
      USING (SELECT @sessionId AS session_id) AS source
      ON target.session_id = source.session_id
      WHEN MATCHED THEN UPDATE SET
        overall_score = @overallScore, category_scores = @categoryScores, skill_results = @skillResults,
        evidence_trace = @evidenceTrace, strengths = @strengths, weaknesses = @weaknesses,
        language_profile = @languageProfile, soft_skills = @softSkills
      WHEN NOT MATCHED THEN INSERT
        (id, session_id, overall_score, category_scores, skill_results, evidence_trace, strengths, weaknesses, language_profile, soft_skills)
      VALUES
        (NEWID(), @sessionId, @overallScore, @categoryScores, @skillResults, @evidenceTrace, @strengths, @weaknesses, @languageProfile, @softSkills);
    `);
}

module.exports = {
  insertQuestionEvaluation,
  updateBetterAnswer,
  fetchQuestionEvaluations,
  upsertEvaluation,
};
