# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

This service does not exist yet: `index.js` is empty and `package.json` has no dependencies, no start script, and `"type": "commonjs"`. Nothing here should be assumed to work — check current contents before relying on anything below being implemented.

## What this service is for

This is the planned real-time backend for PractiWiz's AI mock-interview feature, separate from the existing `../practywiz-backend`. Full specs live in `../doc/` — read `01_MASTER_ARCHITECTURE_AND_APPLICATION_FLOW.md` first, then the module-specific files (`03_INTERVIEW_ROOM_WEBRTC_WEBSOCKET.md` for the realtime contract, `04_MODULE_WISE_DEVELOPMENT.md` for build order, `05_BACKEND_AI_INTERVIEW_INTEGRATION.md`, `06_DATA_SCHEMA_MASTER_TABLES_AND_TESTING.md`) before writing code here. Do not duplicate auth/user/entitlement logic — that stays owned by `../practywiz-backend`; this service only owns live-interview functionality (session lifecycle, WebSocket state/events, WebRTC signalling, AI interviewer/question sequencing, face tracking, proctoring, coding-round coordination, evaluation, and triggering report generation back on the main backend).

Per `../doc/01_MASTER_ARCHITECTURE_AND_APPLICATION_FLOW.md`, the target internal structure is:

```
session/  communication/  interviewer/  question-engine/  case-study/
coding/   proctoring/     evaluation/   reporting/         logs/
```

Documented build order (do not start with face tracking/proctoring/coding — get the connection foundation working first):
1. Session + WebSocket + WebRTC signalling + heartbeat/reconnect + basic audio/video + a basic AI greeting.
2. Then, independently: AI Interviewer/Question Engine → Device & Readiness → Face Tracking → Proctoring → JD/Resume intelligence → Case Study → Coding → Software Engineering Mindset → Evaluation → Reporting → Session Analytics/Audit.

Every module is expected to receive `session_id`/`candidate_id`/`interview_id`/`current_section`/`current_question_id` and publish structured events (e.g. `proctoring.event`, `coding.submitted`, `question.completed`) rather than reach into another module's internals directly.
