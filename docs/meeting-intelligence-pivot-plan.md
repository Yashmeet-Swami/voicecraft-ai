# VoiceCraftAI → AI Meeting Intelligence Platform: Pivot Plan

**Status:** Phases 1–3 implemented and shipped. This doc (v3) records the decisions made along the way and what's next.
**Date:** 2026-08-10

## 1. Why this direction

VoiceCraftAI already has most of the plumbing a meeting-intelligence product needs — it's currently pointed at "blog post generation" instead of "structured meeting output":

| Capability needed | Already exists as |
|---|---|
| Auth / per-user data | Clerk (`middleware.ts`, `currentUser()`) |
| File upload (audio/video) | UploadThing, 32MB cap (`app/api/uploadthing/core.ts`) |
| Transcription | Gemini 2.5 Flash inline-data transcription (`actions/upload-actions.ts:transcribeUploadedFile`) |
| Transcript cleanup | `cleanTranscript()` via Gemini |
| LLM structured generation | `generateBlogPost()` prompt → Markdown (to be replaced with structured JSON) |
| Vector store / RAG | Neon Postgres + `pgvector`, `document_chunks` table, cosine similarity search (`actions/knowledge-actions.ts`) |
| Persistence | Neon (`lib/db.ts`), `posts` table, `documents`/`document_chunks` tables |
| Content viewing/editing | MDX editor (`components/content/*`), `app/posts/[id]/page.tsx` |
| Dashboard | `app/dashboard/page.tsx`, `app/posts/page.tsx` + delete action |

**Bottom line:** this is a pivot of the *output shape and schema*, not a rebuild of the ingestion pipeline. The riskiest gaps are architectural (reliable background processing, source grounding, no teams/orgs), not "start from scratch" gaps.

## 2. Target product shape

```
Meeting Recording (upload)
        ↓
Transcription (+ speaker labels, timestamps)
        ↓
LLM Structured Extraction
        ↓
 ┌───────────┬────────────┬───────────────┬────────────┐
 ▼           ▼            ▼               ▼            ▼
Summary   Decisions   Action Items    Open Questions  Timeline
                            │
                            ▼
                    Assign to person + due date
                            │
                            ▼
                     Track status (open/done)
```

Every AI-generated statement (decision, action item, question) should be traceable back to the transcript segment and timestamp it came from — grounding, not just generation. And beyond single-meeting extraction, the RAG store enables a second, distinct flow: asking questions *across* meetings ("what did we decide about payment retries over the last three meetings?") with cited sources. See §6 for why these are treated as two separate flows.

## 3. Gaps to close, ranked by risk

### 3.1 High risk / architectural
1. **Reliable background processing.** `transcribeUploadedFile` today runs as one synchronous Gemini call with a 60s timeout and a hard 20MB in-memory cap, inline in the request/response cycle. Real meetings (30–90 min) will blow both. This needs an explicit **job table + a trigger mechanism that survives the request lifecycle** (see §5) — not a fire-and-forget background promise, which serverless runtimes are free to kill once the response is sent.
2. **No speaker diarization or timestamps yet.** The current transcription prompt asks for plain text and only informally requests speaker distinction. Needed eventually for the timeline feature and for grounding (§3.1.3), but explicitly **not a Phase 1 blocker** — see §7. Getting diarization/timestamp accuracy right is its own research task and shouldn't gate shipping the core extraction loop.
3. **No source grounding.** Decisions/action items/questions need to be traceable to the transcript segment (and eventually timestamp) they came from — otherwise the product is a black box and harder to trust. This is a schema decision to make early (nullable FK from day one) even though it's only fully populated once diarization lands.
4. **No multi-user / team model.** Everything is scoped to a single Clerk `userId`. Action-item assignment ("assign to Rahul") requires a lightweight team/member concept even if it's just "invite by email, no real RBAC" for v1.

### 3.2 Medium risk / additive
5. **New data model** for meetings, transcripts, action items, decisions, questions, and jobs (see §4) — additive, doesn't break existing `posts`/`documents` tables.
6. **Structured LLM output** — replace the free-form Markdown prompt in `generateBlogPost()` with a JSON-schema-constrained prompt (Gemini supports `responseMimeType: application/json` / `responseSchema`). Needs validation + retry-on-malformed-JSON logic layered onto the existing `callGeminiAPIWithRetry`.
7. **Notifications** for assigned action items — start with in-app (a `notifications` table + dashboard badge); email/Slack can come later.
8. **RAG scoping during extraction.** Blindly pulling top-k chunks from *all* prior documents during single-meeting extraction risks bleeding unrelated content into a new meeting's decisions/action items — a real hallucination vector. See §6.

### 3.3 Low risk / UI only
9. New dashboard views: meeting detail page (summary/decisions/actions/timeline tabs), action-item tracker view, per-person "my action items" view.
10. Reuse the existing MDX editor for the "Summary" section only; action items/decisions render as structured tables/cards, not Markdown.

## 4. Data model changes

Keep `documents` / `document_chunks` (generic RAG store) untouched for now; meeting-derived chunks will need their own linkage (§6). Add:

```sql
-- Meeting metadata only — no large text blobs here, to keep list/dashboard
-- queries cheap (Postgres TOASTs large text automatically, but SELECTs
-- against this table shouldn't have to carry transcript payloads).
CREATE TABLE meetings (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,              -- Clerk userId of uploader/owner
  title TEXT NOT NULL,
  meeting_type TEXT NOT NULL DEFAULT 'general', -- general | engineering | sales | one_on_one | ...
  status TEXT NOT NULL DEFAULT 'uploaded', -- uploaded | processing | ready | failed
  audio_url TEXT,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Separated from `meetings` so listing/dashboard queries never need to
-- touch transcript text, and so transcript versions (raw vs. cleaned,
-- and later re-processing) don't require migrating the meetings row.
CREATE TABLE transcripts (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  cleaned_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Explicit, DB-backed job tracking instead of fire-and-forget. Rows are
-- inserted synchronously on upload; a separate trigger (§5) advances them.
CREATE TABLE processing_jobs (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Populated starting Phase 2 (diarization). Nullable/empty until then.
CREATE TABLE meeting_segments (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_label TEXT,                 -- "Speaker 1" until named
  start_seconds NUMERIC,
  end_seconds NUMERIC,
  text TEXT NOT NULL,
  segment_index INTEGER NOT NULL
);

CREATE TABLE decisions (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source_segment_id INTEGER REFERENCES meeting_segments(id), -- nullable until Phase 2
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE action_items (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  owner_name TEXT,                    -- free text initially; FK to members table later
  owner_user_id TEXT,                 -- Clerk userId if resolvable
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open', -- open | in_progress | done
  source_segment_id INTEGER REFERENCES meeting_segments(id), -- nullable until Phase 2
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE open_questions (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source_segment_id INTEGER REFERENCES meeting_segments(id) -- nullable until Phase 2
);
```

`posts` table stays for the existing blog feature if it's kept alongside; otherwise it can be deprecated once meetings ship (see §7, Phase 5).

`meeting_type` is added now as a cheap column (default `'general'`), but **type-specific extraction schemas (e.g. `risks`/`technical_topics` for engineering vs. `objections`/`competitors` for sales) are deferred** — branching prompts per type multiplies what has to be validated before the core loop is proven. Treat it as a Phase 3+ differentiator.

## 5. Processing pipeline changes

Current: `upload-form.tsx` → UploadThing `onUploadComplete` → client calls `transcribeUploadedFile` → client calls `generateBlogPostAction`, all inline in the request/response cycle of a couple of server actions.

Proposed for meetings — **explicit job table from Phase 1, not fire-and-forget:**

1. Upload completes → insert `meetings` row (`status = 'uploaded'`) and a `processing_jobs` row (`status = 'queued'`). Return immediately; dashboard shows a "Processing…" card.
2. A **trigger mechanism** advances queued jobs. A detached promise in the upload handler is not sufficient — serverless runtimes may terminate the container once the HTTP response is sent, silently dropping the work.
3. UI polls or revalidates the meeting detail page until `meetings.status = 'ready'`.

**Shipped (Phase 1):** *lazy client-triggered processing*. When the dashboard/meeting-list page loads (or on an interval while the tab is open), the client calls `/api/jobs/process`. The endpoint atomically claims one `queued` job (`UPDATE ... SET status = 'running' WHERE status = 'queued' ... RETURNING`, guarding against a second concurrent claim), runs the pipeline (download → transcribe → clean → extract → write results), and marks `done`/`failed` with `attempts` incremented on failure. $0, no new infra — but only advances while someone has the app open, which is a real limitation, not just a stepping stone we're pretending not to notice.

**Decision: the next step is a managed queue (Inngest), not external cron.** Two options were on the table for "make it advance without a tab open":
- *External cron* (GitHub Actions scheduled workflow, cron-job.org) hitting `/api/jobs/process` every 1–5 minutes — free, but it's a cron hack bolted onto a serverless app, not a real execution model. Rejected on those grounds, not on cost.
- *A managed queue* (Inngest, Trigger.dev, or QStash) — a genuine worker/executor model: jobs get pushed to the service, it invokes your endpoint reliably with retries/backoff built in. **Inngest specifically** is the pick: 50,000 executions/month free (see §9) is enormous headroom at this scale, and it has a first-class Next.js integration (a single `/api/inngest` route handler). This is what "real" background processing looks like, and it's still $0.

We're intentionally *not* implementing this yet — the lazy-trigger mechanism is working, tested, and nothing has hit its limits. When we do the swap, it's a trigger-mechanism replacement under an unchanged `processing_jobs` contract (`processNextJob()` becomes the Inngest function body), not a schema migration or pipeline rewrite. Rejected the earlier "external cron as an interim step" idea entirely — if we're going to move off lazy-trigger, go straight to the real thing.

(Vercel Cron itself was also considered and rejected outright, independent of the above: **Vercel's Hobby plan only permits cron schedules that run once per day** — anything more frequent fails at deploy time, and per-minute cron requires the paid Pro plan.)

## 6. RAG usage — two distinct flows

**Flow A — Processing a single meeting (extraction).** Retrieval here should be conservative: only pull context that's actually relevant (e.g. scoped by the same `meeting_type`, or only invoked when the transcript references something ambiguous), not a blind top-k across every past document. Unscoped retrieval risks a new meeting's decisions/action items being contaminated by unrelated prior content.

**Flow B — "Ask this meeting" / "Ask across meetings" (a first-class feature, not a side effect).** This is a separate, deliberate query path: user asks a question → embed → vector search over meeting-derived chunks → Gemini answer with cited sources (`Meeting #17, 00:31:22`). This is likely the single most differentiating feature of the product — it's what turns "AI meeting summarizer" into "AI meeting knowledge platform."

Flow B has a schema dependency worth calling out now: the existing `document_chunks` table only has `document_id`, with no link to a specific meeting or segment. To support per-meeting citations, meeting-derived chunks need `meeting_id` (and ideally `segment_id`) alongside their embedding — either as new columns on `document_chunks` or a parallel `meeting_chunks` table. Auto-ingestion of a meeting's transcript into the RAG store (as already happens today for blog transcripts) should populate this link at ingestion time.

## 7. Prompt changes

- **Transcription prompt (Phase 2):** request diarized, timestamped JSON segments instead of a single text blob. Fall back to plain text if the model can't provide timestamps reliably (Gemini's timestamp accuracy on audio should be validated empirically before committing to this UI feature).
- **Extraction prompt (Phase 1):** single Gemini call over the cleaned transcript (+ scoped RAG context per §6, Flow A), with `responseSchema` enforcing:
  ```json
  {
    "summary": "string",
    "decisions": ["string"],
    "action_items": [{"task": "string", "owner": "string|null", "due_date": "string|null"}],
    "open_questions": ["string"]
  }
  ```
- Keep `cleanTranscript()` as-is — still useful preprocessing.
- Keep auto-ingestion of the raw transcript into the RAG store, but extend it to record `meeting_id`/`segment_id` per §6.

## 8. Phased delivery plan

**Phase 1 — Core Meeting Intelligence ✅ Shipped**
Goal: one uploaded meeting reliably becomes structured intelligence, end to end, with no lost work.
- `meetings`, `transcripts`, `processing_jobs`, `decisions`, `action_items`, `open_questions` tables (with nullable `source_segment_id` columns already in place).
- Job-table + lazy client-triggered pipeline (§5) — no fire-and-forget, no paid cron.
- Rename upload flow's destination from "blog post" to "meeting"; reuse `transcribeUploadedFile`, add the structured-extraction call with `responseSchema`.
- Meeting detail page: Summary / Decisions / Action Items / Questions tabs (no timeline yet, no diarization yet — plain transcript).
- Explicit failure state surfaced in the UI (`meetings.status = 'failed'` with retry).
- Action items are read-only text (owner as free-text string, no assignment/notifications yet).

**Phase 2 — Source Grounding ✅ Shipped**
Goal: every AI result can be traced back to the meeting.
- Redesign transcription prompt for diarized+timestamped segments; populate `meeting_segments`.
- Populate `source_segment_id` on decisions/action_items/open_questions.
- Timeline UI + audio player with click-to-seek citations.

**Phase 3 — Meeting Knowledge Base ✅ Shipped**
Goal: meetings become a searchable organizational knowledge base.
- Extended RAG ingestion (`document_chunks.meeting_id`/`segment_id`) linking chunks back to a meeting/segment (§6).
- "Ask this meeting" and "Ask across meetings" with cited, clickable sources.
- Fixed a pre-existing gap along the way: `retrieveContext` had no per-user scoping; added it for the meeting pipeline so one user's meetings can't leak into another's extraction context.
- `meeting_type`-specific extraction schemas remain deferred (see §4) — not yet needed.

**Phase 3.5 — Real Background Worker (next up)**
Goal: meetings process without anyone needing the app open, using an actual worker model instead of a page-triggered poll.
- Swap the trigger in `/api/jobs/process` for an Inngest function — `processNextJob()`'s body doesn't change, only what calls it does (see §5's decision).
- No schema changes required; `processing_jobs` already models queued/running/done/failed.
- Not urgent — the lazy-trigger mechanism hasn't hit a real limit yet. Do this when it does, or when demoing the product to someone who won't have a tab open.

**Phase 4 — Collaboration**
Goal: convert meeting information into actual work.
- Minimal team concept: invite collaborators by email (Clerk organizations, or a simple `team_members` table).
- Resolve `owner_name` → `owner_user_id`, add status toggle (open/in_progress/done), "My Action Items" view, in-app notifications.
- Can proceed in parallel with Phase 3.5 if resourced — the two aren't dependent on each other.

**Phase 5 — Production Engineering**
Goal: make it defensible as a production system.
- Chunked upload/transcription for long meetings (>20MB / >~15min).
- Worker concurrency limits, rate limiting, LLM cost/usage tracking, observability.
- Reconsider `posts` (blog) feature: keep as secondary export ("turn this meeting into a blog recap") or retire.

**Explicitly out of scope until the core flow (Phases 1–4) is solid:** Slack, Jira, Zoom, Google Calendar, or email integrations. They inflate scope without validating the core product; add one (Jira or Slack) after, not before.

## 9. Cost — this plan is designed to run at $0

All services below have a permanent free tier (not a time-limited trial) that comfortably covers portfolio/personal-project scale. Verify current numbers in each dashboard before relying on them, since providers change quotas without much notice.

| Service | Free tier (as of Aug 2026) | Risk of accidental cost |
|---|---|---|
| Vercel hosting | Hobby plan, unlimited for this app's traffic | Only triggered by upgrading plans or exceeding Hobby's usage caps |
| Vercel Cron | **Hobby = once/day only** — anything more frequent fails to deploy, doesn't silently bill | Avoided entirely by using the lazy-trigger pattern (§5) instead of cron |
| Gemini API (AI Studio key) | Free, rate-limited (currently ~10 RPM, low hundreds–1500 requests/day depending on model/quota) — free tier throttles, it does not bill | Only if billing is explicitly enabled on the linked Google Cloud project; confirm the `GEMINI_API_KEY` project has no billing account attached |
| Neon Postgres | 0.5GB storage, limited monthly compute hours, autosuspend | Exceeding storage/compute caps at high usage — unlikely at this scale |
| UploadThing | A few GB storage on free tier | Exceeding storage with many large test uploads left undeleted |
| Clerk | Up to 10,000 MAU free | Not a realistic risk for a personal project |

**Net effect on the plan:** no change to Phases 1–3.

Phase 3.5's managed-queue options all have permanent free tiers, not just trials — verified: **Inngest** (50,000 executions/month, 5 concurrent steps — the pick, see §5), **Upstash QStash** (1,000 messages/day, then $1/100K), **Trigger.dev** ($0/month plan with $5 of included compute credit, 20 concurrent runs). Each comfortably covers a solo/portfolio-scale meeting app — a handful of meetings a day uses a tiny fraction of any of these caps. Unlike Vercel Cron's flat "once/day on Hobby, no exceptions" limit, these are usage-metered: cost only becomes possible if usage grows to real multi-user traffic (hundreds of meetings/day), at which point revisiting cost is reasonable, not before.

## 10. Decisions made

- **Blog feature:** keep it, but demote it. It stays as-is for now; per Phase 5 it becomes a secondary export ("turn this meeting into a blog recap") generated *from* meeting intelligence rather than a parallel product. Don't maintain two separate generation pipelines long-term.
- **Diarization:** the Phase 1 → Phase 2 split (plain transcript first, speakers/timestamps after) was correct and is what shipped — diarization was real but never blocked the core loop.
- **Job runner:** lazy client-trigger shipped for Phase 1 and stays until it's actually a problem. The next step, when needed, is Inngest (Phase 3.5) — not external cron. See §5 for the full reasoning; external cron was considered and rejected as a workaround rather than a real execution model.
- **`meeting_type`-adaptive extraction:** yes, eventually (engineering/sales/1:1-specific fields are a genuine differentiator), but explicitly after the uniform schema is proven — tracked as an enhancement under Phase 3, not started.
