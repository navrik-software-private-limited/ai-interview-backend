-- AI Interview Engine — Phase 1/2 schema
-- Run manually against the same MSSQL server/database practywiz-backend uses.
-- This repo has no migration tooling; tables are created out-of-band by design.
-- Only adds new interview_* tables — nothing existing is touched.

IF OBJECT_ID('dbo.interview_profiles', 'U') IS NULL
CREATE TABLE dbo.interview_profiles (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_profiles_id DEFAULT NEWID() PRIMARY KEY,
    name        NVARCHAR(150) NOT NULL,
    slug        NVARCHAR(150) NOT NULL,
    description NVARCHAR(MAX) NULL,
    status      VARCHAR(20)   NOT NULL CONSTRAINT DF_interview_profiles_status DEFAULT 'active',
    created_at  DATETIME2     NOT NULL CONSTRAINT DF_interview_profiles_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2     NOT NULL CONSTRAINT DF_interview_profiles_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_interview_profiles_slug UNIQUE (slug)
);
GO

IF OBJECT_ID('dbo.interview_cases', 'U') IS NULL
CREATE TABLE dbo.interview_cases (
    id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_cases_id DEFAULT NEWID() PRIMARY KEY,
    profile_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_cases_profile FOREIGN KEY REFERENCES dbo.interview_profiles(id),
    title             NVARCHAR(200) NOT NULL,
    slug              NVARCHAR(200) NOT NULL,
    description       NVARCHAR(MAX) NULL,
    difficulty        VARCHAR(20)   NULL,
    estimated_minutes INT           NULL,
    case_content      NVARCHAR(MAX) NULL, -- JSON text
    status            VARCHAR(20)   NOT NULL CONSTRAINT DF_interview_cases_status DEFAULT 'active',
    version           INT           NOT NULL CONSTRAINT DF_interview_cases_version DEFAULT 1,
    created_at        DATETIME2     NOT NULL CONSTRAINT DF_interview_cases_created_at DEFAULT SYSUTCDATETIME(),
    updated_at        DATETIME2     NOT NULL CONSTRAINT DF_interview_cases_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_interview_cases_slug UNIQUE (slug)
);
GO
CREATE INDEX IX_interview_cases_profile_id ON dbo.interview_cases(profile_id);
GO

IF OBJECT_ID('dbo.interview_plans', 'U') IS NULL
CREATE TABLE dbo.interview_plans (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_plans_id DEFAULT NEWID() PRIMARY KEY,
    profile_id    UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_plans_profile FOREIGN KEY REFERENCES dbo.interview_profiles(id),
    name          NVARCHAR(150) NOT NULL,
    configuration NVARCHAR(MAX) NOT NULL, -- JSON, e.g. {"sections":[{"name":"JD_RESUME","targetQuestions":8}]}
    version       INT           NOT NULL CONSTRAINT DF_interview_plans_version DEFAULT 1,
    status        VARCHAR(20)   NOT NULL CONSTRAINT DF_interview_plans_status DEFAULT 'active',
    created_at    DATETIME2     NOT NULL CONSTRAINT DF_interview_plans_created_at DEFAULT SYSUTCDATETIME(),
    updated_at    DATETIME2     NOT NULL CONSTRAINT DF_interview_plans_updated_at DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_interview_plans_profile_id ON dbo.interview_plans(profile_id);
GO

-- NOTE: candidate_id assumes dbo.users_dtls.user_dtls_id is INT IDENTITY
-- (this codebase's universal *_dtls_id convention). Verify before running.
IF OBJECT_ID('dbo.interview_sessions', 'U') IS NULL
CREATE TABLE dbo.interview_sessions (
    id                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_sessions_id DEFAULT NEWID() PRIMARY KEY,
    candidate_id        INT              NOT NULL, -- references practywiz-backend dbo.users_dtls.user_dtls_id; not an enforced cross-db FK
    interview_id        UNIQUEIDENTIFIER NOT NULL,
    profile_id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_sessions_profile FOREIGN KEY REFERENCES dbo.interview_profiles(id),
    case_id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_sessions_case FOREIGN KEY REFERENCES dbo.interview_cases(id),
    status              VARCHAR(20)      NOT NULL CONSTRAINT DF_interview_sessions_status DEFAULT 'CREATED', -- CREATED|ACTIVE|COMPLETED|FAILED|ABANDONED
    current_section     VARCHAR(30)      NOT NULL CONSTRAINT DF_interview_sessions_section DEFAULT 'INTRO',
    current_question_id UNIQUEIDENTIFIER NULL,
    started_at          DATETIME2        NOT NULL CONSTRAINT DF_interview_sessions_started_at DEFAULT SYSUTCDATETIME(),
    ended_at            DATETIME2        NULL,
    completion_reason   VARCHAR(50)      NULL,
    created_at          DATETIME2        NOT NULL CONSTRAINT DF_interview_sessions_created_at DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2        NOT NULL CONSTRAINT DF_interview_sessions_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_interview_sessions_interview_id UNIQUE (interview_id)
);
GO
CREATE INDEX IX_interview_sessions_candidate_id ON dbo.interview_sessions(candidate_id);
GO

IF OBJECT_ID('dbo.interview_session_context', 'U') IS NULL
CREATE TABLE dbo.interview_session_context (
    id                       UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_session_context_id DEFAULT NEWID() PRIMARY KEY,
    session_id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_session_context_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    resume_reference         NVARCHAR(200) NULL,
    jd_reference              NVARCHAR(200) NULL,
    interview_plan_version    INT           NULL,
    ai_configuration_version  VARCHAR(30)   NULL,
    context_snapshot          NVARCHAR(MAX) NULL, -- JSON
    created_at                DATETIME2     NOT NULL CONSTRAINT DF_interview_session_context_created_at DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_interview_session_context_session_id ON dbo.interview_session_context(session_id);
GO

IF OBJECT_ID('dbo.interview_transcripts', 'U') IS NULL
CREATE TABLE dbo.interview_transcripts (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_transcripts_id DEFAULT NEWID() PRIMARY KEY,
    session_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_transcripts_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    speaker     VARCHAR(20)   NOT NULL, -- 'candidate' | 'ai'
    sequence    BIGINT        NOT NULL,
    transcript  NVARCHAR(MAX) NOT NULL,
    is_final    BIT           NOT NULL CONSTRAINT DF_interview_transcripts_is_final DEFAULT 1,
    [timestamp] DATETIME2     NOT NULL CONSTRAINT DF_interview_transcripts_timestamp DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_interview_transcripts_session_id_sequence ON dbo.interview_transcripts(session_id, sequence);
GO

IF OBJECT_ID('dbo.interview_session_events', 'U') IS NULL
CREATE TABLE dbo.interview_session_events (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_session_events_id DEFAULT NEWID() PRIMARY KEY,
    session_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_session_events_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    event_id    UNIQUEIDENTIFIER NOT NULL,
    sequence    BIGINT        NOT NULL,
    event_type  VARCHAR(60)   NOT NULL,
    source      VARCHAR(20)   NOT NULL, -- 'server' | 'client'
    payload     NVARCHAR(MAX) NULL, -- JSON
    occurred_at DATETIME2     NOT NULL,
    created_at  DATETIME2     NOT NULL CONSTRAINT DF_interview_session_events_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_interview_session_events_event_id UNIQUE (event_id)
);
GO
CREATE INDEX IX_interview_session_events_session_sequence ON dbo.interview_session_events(session_id, sequence);
CREATE INDEX IX_interview_session_events_session_occurred ON dbo.interview_session_events(session_id, occurred_at);
CREATE INDEX IX_interview_session_events_event_type ON dbo.interview_session_events(event_type);
GO

-- ============================================================================
-- Scoped login for ai-interview-backend (run separately, as sysadmin, once).
-- Grant the SAME rights to whatever login practywiz-backend's app already
-- uses, since its new InterviewEngine controller reads/writes these tables too.
-- ============================================================================
-- CREATE LOGIN interview_engine_svc WITH PASSWORD = '<STRONG_PASSWORD>';
-- CREATE USER interview_engine_svc FOR LOGIN interview_engine_svc;
-- GRANT SELECT, INSERT, UPDATE ON dbo.interview_profiles       TO interview_engine_svc;
-- GRANT SELECT, INSERT, UPDATE ON dbo.interview_cases           TO interview_engine_svc;
-- GRANT SELECT, INSERT, UPDATE ON dbo.interview_plans           TO interview_engine_svc;
-- GRANT SELECT, INSERT, UPDATE ON dbo.interview_sessions        TO interview_engine_svc;
-- GRANT SELECT, INSERT, UPDATE ON dbo.interview_session_context TO interview_engine_svc;
-- GRANT SELECT, INSERT, UPDATE ON dbo.interview_transcripts     TO interview_engine_svc;
-- doc 04 §12: "Logs should be immutable/auditable" — SELECT+INSERT only, no
-- UPDATE. Nothing in the codebase ever updates an interview_session_events
-- row (unlike interview_questions_asked/interview_sessions, which do), so
-- this is enforced at the DB grant level, not just by convention.
-- GRANT SELECT, INSERT ON dbo.interview_session_events  TO interview_engine_svc;

-- ============================================================================
-- Addition: allow an interview session to be created directly from a REAL,
-- already-purchased case study (dbo.case_study_dtls / dbo.News_CaseStudies_dtls,
-- via dbo.vw_case_study_active_purchases) instead of requiring the separate
-- interview_profiles/interview_cases catalog above. profile_id/case_id become
-- optional so both integration paths can coexist.
-- ============================================================================

IF COL_LENGTH('dbo.interview_sessions', 'case_study_id') IS NULL
  ALTER TABLE dbo.interview_sessions ADD case_study_id INT NULL;
GO
IF COL_LENGTH('dbo.interview_sessions', 'case_study_purchase_id') IS NULL
  ALTER TABLE dbo.interview_sessions ADD case_study_purchase_id INT NULL;
GO

ALTER TABLE dbo.interview_sessions ALTER COLUMN profile_id UNIQUEIDENTIFIER NULL;
GO
ALTER TABLE dbo.interview_sessions ALTER COLUMN case_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interview_sessions_case_study_purchase_id')
  CREATE INDEX IX_interview_sessions_case_study_purchase_id ON dbo.interview_sessions(case_study_purchase_id);
GO

-- ============================================================================
-- AI Interviewer / Question Engine (doc 04 §2) — records every question asked
-- (LLM-generated, no question bank yet, so question_id stays NULL) for audit
-- and future Report/Session-Logs modules.
-- ============================================================================

IF OBJECT_ID('dbo.interview_questions_asked', 'U') IS NULL
CREATE TABLE dbo.interview_questions_asked (
    id                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_questions_asked_id DEFAULT NEWID() PRIMARY KEY,
    session_id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_questions_asked_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    question_id         UNIQUEIDENTIFIER NULL, -- no question bank yet; questions are LLM-generated
    section             VARCHAR(30)      NOT NULL,
    sequence            INT              NOT NULL,
    question_text       NVARCHAR(MAX)    NOT NULL,
    is_followup         BIT              NOT NULL CONSTRAINT DF_interview_questions_asked_is_followup DEFAULT 0,
    parent_question_id  UNIQUEIDENTIFIER NULL,
    asked_at            DATETIME2        NOT NULL CONSTRAINT DF_interview_questions_asked_asked_at DEFAULT SYSUTCDATETIME(),
    completed_at        DATETIME2        NULL
);
GO
CREATE INDEX IX_interview_questions_asked_session_sequence ON dbo.interview_questions_asked(session_id, sequence);
GO

-- ============================================================================
-- Face Tracking Module (doc 04 §4) — continuous face-presence/framing signals,
-- distinct from the one-time identity check. Column shapes match
-- doc/06_DATA_SCHEMA_MASTER_TABLES_AND_TESTING.md §5 (face_events/proctoring_events).
-- proctoring_events here is only the escalation-hook target (severity >= WARNING
-- face events land here) — the full Proctoring Module (doc 04 §5: combining
-- camera/browser/coding signals into proctoring.summary) is a separate,
-- not-yet-built module this table is ready for.
-- ============================================================================

IF OBJECT_ID('dbo.face_events', 'U') IS NULL
CREATE TABLE dbo.face_events (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_face_events_id DEFAULT NEWID() PRIMARY KEY,
    session_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_face_events_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    event_type  VARCHAR(30)      NOT NULL, -- FACE_PRESENT|FACE_NOT_DETECTED|MULTIPLE_FACES|FACE_POSITION_CHANGED|CAMERA_BLOCKED
    severity    VARCHAR(20)      NOT NULL, -- INFORMATIONAL|WARNING|SUSPICIOUS|CRITICAL
    confidence  DECIMAL(4,3)     NULL,
    duration_ms INT              NULL,
    metadata    NVARCHAR(MAX)    NULL, -- JSON
    [timestamp] DATETIME2        NOT NULL CONSTRAINT DF_face_events_timestamp DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_face_events_session_id ON dbo.face_events(session_id, [timestamp]);
GO

IF OBJECT_ID('dbo.proctoring_events', 'U') IS NULL
CREATE TABLE dbo.proctoring_events (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_proctoring_events_id DEFAULT NEWID() PRIMARY KEY,
    session_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_proctoring_events_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    event_type  VARCHAR(30)      NOT NULL,
    severity    VARCHAR(20)      NOT NULL,
    confidence  DECIMAL(4,3)     NULL,
    duration_ms INT              NULL,
    evidence    NVARCHAR(MAX)    NULL, -- JSON
    [timestamp] DATETIME2        NOT NULL CONSTRAINT DF_proctoring_events_timestamp DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_proctoring_events_session_id ON dbo.proctoring_events(session_id, [timestamp]);
GO

-- ============================================================================
-- 03-LIVE-INTERVIEW-MODULE.md §8 (Case Study read-then-answer gate) — records
-- when the candidate explicitly acknowledged the case presentation. NULL
-- until case.acknowledged arrives; the gate itself is enforced in Redis
-- session state (session/sessionStore.js's awaitingCaseAcknowledgement), this
-- column is just the durable audit record of when it happened.
-- ============================================================================

IF COL_LENGTH('dbo.interview_sessions', 'case_acknowledged_at') IS NULL
  ALTER TABLE dbo.interview_sessions ADD case_acknowledged_at DATETIME2 NULL;
GO

-- ============================================================================
-- 03-LIVE-INTERVIEW-MODULE.md §9 (Coding Section) — code submissions are
-- LLM-analyzed, not sandbox-executed (no test-case runner exists), so
-- `evaluation` holds an LLM-judged assessment, not an execution-verified result.
-- ============================================================================

-- ============================================================================
-- 00-MASTER-ARCHITECTURE.md §2: "a lightweight local Candidate reference
-- (id, name, email) populated at session-creation time — not a live join
-- into Practywiz's user table." Populated by
-- session/candidateRepository.js's upsertCandidateReference, called from the
-- new POST /api/sessions (session/sessionCreationController.js).
-- ============================================================================

IF OBJECT_ID('dbo.interview_candidates', 'U') IS NULL
CREATE TABLE dbo.interview_candidates (
    id          INT           NOT NULL PRIMARY KEY, -- matches practywiz-backend dbo.users_dtls.user_dtls_id; not an enforced cross-db FK
    name        NVARCHAR(200) NULL,
    email       NVARCHAR(200) NULL,
    created_at  DATETIME2     NOT NULL CONSTRAINT DF_interview_candidates_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2     NOT NULL CONSTRAINT DF_interview_candidates_updated_at DEFAULT SYSUTCDATETIME()
);
GO

-- ============================================================================
-- 06-READINESS-CHECK-MODULE.md (this repo's readiness/ module) +
-- 03-LIVE-INTERVIEW-MODULE.md §2.5: interview_sessions.status now also takes
-- READY_CHECK and READY, ahead of the existing CREATED|ACTIVE|COMPLETING|
-- COMPLETED|ABANDONED. No enum constraint exists on this column (VARCHAR(20)
-- free text, same as every other status write in this file) — this is a
-- documentation-only note, not a migration.
-- ============================================================================

IF OBJECT_ID('dbo.interview_coding_submissions', 'U') IS NULL
CREATE TABLE dbo.interview_coding_submissions (
    id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_coding_submissions_id DEFAULT NEWID() PRIMARY KEY,
    session_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_coding_submissions_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    sequence          INT              NOT NULL,
    problem_statement NVARCHAR(MAX)    NOT NULL,
    language          VARCHAR(30)      NULL,
    code              NVARCHAR(MAX)    NOT NULL,
    evaluation        NVARCHAR(MAX)    NULL, -- JSON, LLM-judged (not execution-verified)
    submitted_at      DATETIME2        NOT NULL CONSTRAINT DF_interview_coding_submissions_submitted_at DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_interview_coding_submissions_session_id ON dbo.interview_coding_submissions(session_id, sequence);
GO

-- ============================================================================
-- Interview Module – Bug, Gap & UI/UX Improvements.md §1: admin-configurable
-- interview structure (section order + per-section question counts),
-- system-wide and versioned — not per-profile like the legacy, unused
-- dbo.interview_plans (that table is scoped to profile_id, which only the
-- catalog-dashboard flow ever populates; the real case-study-purchase flow
-- has no profile concept at all, so this is a new table rather than a
-- force-fit reuse). Only one row has is_active = 1 at a time; admin/adminConfigRepository.js
-- enforces that. question-engine/sectionPlan.js's hardcoded SECTION_ORDER/
-- SECTION_TARGETS remain the fallback whenever this table is empty.
-- ============================================================================

IF OBJECT_ID('dbo.interview_configurations', 'U') IS NULL
CREATE TABLE dbo.interview_configurations (
    id                          UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_configurations_id DEFAULT NEWID() PRIMARY KEY,
    name                        NVARCHAR(150)     NOT NULL,
    configuration               NVARCHAR(MAX)     NOT NULL, -- JSON: {"sections":[{"name":"JD_RESUME","label":"Background & Resume","targetQuestions":8}, ...], "evaluation_criteria": {"weights": {"technical": 1, ...}}?}
    estimated_duration_minutes  INT               NULL,
    is_active                   BIT               NOT NULL CONSTRAINT DF_interview_configurations_is_active DEFAULT 0,
    version                     INT               NOT NULL CONSTRAINT DF_interview_configurations_version DEFAULT 1,
    created_at                  DATETIME2         NOT NULL CONSTRAINT DF_interview_configurations_created_at DEFAULT SYSUTCDATETIME(),
    updated_at                  DATETIME2         NOT NULL CONSTRAINT DF_interview_configurations_updated_at DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_interview_configurations_is_active ON dbo.interview_configurations(is_active);
GO

-- ============================================================================
-- Phase 4 (Layer 3 — Evaluation & Report), per docFiles/L3-01..L3-05: scoring,
-- strengths/weaknesses, language/soft-skills profiling, technical/theoretical
-- question-level evaluation, better-answer suggestions, proctoring summary,
-- preparation notes, final recommendation, and the assembled Report. Reads
-- ONLY from tables above (interview_transcripts, interview_questions_asked,
-- interview_coding_submissions, proctoring_events) — never from live Redis
-- session state. No question<->answer FK exists anywhere in this schema, so
-- evaluation/transcriptAssembler.js reconstructs Q&A pairing from
-- interview_questions_asked.asked_at/completed_at windows against
-- interview_transcripts rows — that reconstruction is not persisted here,
-- only its output (question_text/answer_text) is, on interview_question_evaluations.
-- ============================================================================

IF OBJECT_ID('dbo.interview_evaluations', 'U') IS NULL
CREATE TABLE dbo.interview_evaluations (
    id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_evaluations_id DEFAULT NEWID() PRIMARY KEY,
    session_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_evaluations_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    overall_score     DECIMAL(5,2)     NULL,
    category_scores   NVARCHAR(MAX)    NULL, -- JSON: {technical, problem_solving, case_analysis, communication, soft_skills, theoretical, language_profile, coding}
    skill_results     NVARCHAR(MAX)    NULL, -- JSON: {[skill]: "strong|good|moderate|weak"}
    evidence_trace    NVARCHAR(MAX)    NULL, -- JSON: {[category]: [questionAskedId, ...]}
    strengths         NVARCHAR(MAX)    NULL, -- JSON array of strings
    weaknesses        NVARCHAR(MAX)    NULL, -- JSON array of strings
    language_profile  NVARCHAR(MAX)    NULL, -- JSON
    soft_skills       NVARCHAR(MAX)    NULL, -- JSON
    created_at        DATETIME2        NOT NULL CONSTRAINT DF_interview_evaluations_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_interview_evaluations_session_id UNIQUE (session_id)
);
GO

IF OBJECT_ID('dbo.interview_question_evaluations', 'U') IS NULL
CREATE TABLE dbo.interview_question_evaluations (
    id                    UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_question_evaluations_id DEFAULT NEWID() PRIMARY KEY,
    session_id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_question_evaluations_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    question_asked_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_question_evaluations_question FOREIGN KEY REFERENCES dbo.interview_questions_asked(id),
    section               VARCHAR(30)      NOT NULL,
    question_text         NVARCHAR(MAX)    NOT NULL,
    answer_text           NVARCHAR(MAX)    NULL, -- reconstructed from interview_transcripts, not a stored FK
    score                 DECIMAL(4,2)     NULL, -- 0-10, NULL if the LLM call failed (never fabricated)
    understanding_level   VARCHAR(50)      NULL,
    what_was_good         NVARCHAR(MAX)    NULL, -- JSON array
    what_could_improve    NVARCHAR(MAX)    NULL, -- JSON array
    improvement_suggestion NVARCHAR(MAX)   NULL,
    better_answer         NVARCHAR(MAX)    NULL, -- filled only for below-threshold scores (L3-04)
    created_at            DATETIME2        NOT NULL CONSTRAINT DF_interview_question_evaluations_created_at DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX IX_interview_question_evaluations_session_id ON dbo.interview_question_evaluations(session_id);
GO

-- ============================================================================
-- Interview Room MCQ interaction type ("Interview Room – Complete Interview
-- Flow & Implementation Requirements.md"): additive columns on the existing
-- dbo.interview_questions_asked table rather than a new table, per that
-- doc's own §17 rule to follow existing architecture instead of duplicating
-- it. interaction_type defaults to VOICE_QA so every already-persisted row —
-- and any session whose active configuration doesn't opt into MCQ — is
-- completely unaffected.
-- ============================================================================

IF COL_LENGTH('dbo.interview_questions_asked', 'interaction_type') IS NULL
  ALTER TABLE dbo.interview_questions_asked ADD interaction_type VARCHAR(20) NOT NULL CONSTRAINT DF_interview_questions_asked_interaction_type DEFAULT 'VOICE_QA';
GO
IF COL_LENGTH('dbo.interview_questions_asked', 'options') IS NULL
  ALTER TABLE dbo.interview_questions_asked ADD options NVARCHAR(MAX) NULL; -- JSON: [{"key":"A","text":"..."}, ...]
GO
IF COL_LENGTH('dbo.interview_questions_asked', 'correct_option') IS NULL
  ALTER TABLE dbo.interview_questions_asked ADD correct_option VARCHAR(10) NULL; -- never sent to the client
GO
IF COL_LENGTH('dbo.interview_questions_asked', 'selected_option') IS NULL
  ALTER TABLE dbo.interview_questions_asked ADD selected_option VARCHAR(10) NULL;
GO

IF OBJECT_ID('dbo.interview_reports', 'U') IS NULL
CREATE TABLE dbo.interview_reports (
    id                   UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_interview_reports_id DEFAULT NEWID() PRIMARY KEY,
    session_id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_interview_reports_session FOREIGN KEY REFERENCES dbo.interview_sessions(id),
    status               VARCHAR(20)      NOT NULL CONSTRAINT DF_interview_reports_status DEFAULT 'GENERATING', -- GENERATING|COMPLETED|FAILED
    report               NVARCHAR(MAX)    NULL, -- JSON, the full 19-section assembled Report (L3-05 §4)
    final_recommendation VARCHAR(50)      NULL, -- READY|NEEDS_IMPROVEMENT|SIGNIFICANT_PREPARATION_REQUIRED
    error_message        NVARCHAR(500)    NULL,
    generated_at         DATETIME2        NULL,
    created_at           DATETIME2        NOT NULL CONSTRAINT DF_interview_reports_created_at DEFAULT SYSUTCDATETIME(),
    updated_at           DATETIME2        NOT NULL CONSTRAINT DF_interview_reports_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_interview_reports_session_id UNIQUE (session_id)
);
GO
