"use server";

import getDbConnection from "@/lib/db";
import {
  transcribeUploadedFile,
  transcribeMeetingSegments,
  cleanTranscript,
  type TranscriptSegmentResult,
} from "@/actions/upload-actions";
import { retrieveContext, ingestMeetingSegments } from "@/actions/knowledge-actions";
import { extractMeetingIntelligence } from "@/actions/meeting-extraction";
import { formatTimestamp } from "@/lib/utils";
import { logUsageEvent } from "@/lib/usage-tracking";

export interface ProcessJobResult {
  processed: boolean;
  meetingId?: number;
  status?: "ready" | "failed";
  message?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDueDate(value: string | null): string | null {
  if (!value || !ISO_DATE_RE.test(value)) return null;
  return value;
}

function resolveSegmentId(segmentIds: number[], index: number | null): number | null {
  if (index == null || !Number.isInteger(index) || index < 0 || index >= segmentIds.length) {
    return null;
  }
  return segmentIds[index];
}

interface OwnerCandidate {
  user_id: string;
  full_name: string;
}

// Matches an extracted owner name (e.g. "Rahul") against registered users
// who actually have access to this meeting (the owner + its collaborators -
// see meeting_collaborators, Phase 4). Deliberately scoped to that small set
// rather than every user in the app: matching against everyone risks
// silently assigning/notifying a random stranger who happens to share a
// first name.
function matchOwnerName(ownerName: string, candidates: OwnerCandidate[]): string | null {
  const normalized = ownerName.trim().toLowerCase();
  if (!normalized) return null;

  for (const candidate of candidates) {
    const fullName = (candidate.full_name || "").trim().toLowerCase();
    if (!fullName) continue;
    const firstName = fullName.split(/\s+/)[0];
    if (
      fullName === normalized ||
      firstName === normalized ||
      fullName.includes(normalized) ||
      normalized.includes(fullName)
    ) {
      return candidate.user_id;
    }
  }

  return null;
}

// Runs diarized/timestamped transcription; falls back to plain transcription
// wrapped as a single untimestamped segment if the model can't produce
// usable segments (see docs/meeting-intelligence-pivot-plan.md §3.1.2, §7 -
// diarization is not a hard requirement, degraded output is acceptable).
async function getMeetingSegments(
  userId: string,
  audioUrl: string,
  fileName: string
): Promise<TranscriptSegmentResult[]> {
  const segmentedResult = await transcribeMeetingSegments(audioUrl, fileName);

  if (segmentedResult.success && segmentedResult.segments.length > 0) {
    return segmentedResult.segments;
  }

  console.warn(
    `Segmented transcription unusable, falling back to plain transcription. Reason: ${segmentedResult.message}`
  );

  const plainResult = await transcribeUploadedFile([{ userId, fileUrl: audioUrl, fileName }]);
  if (!plainResult.success || !plainResult.data) {
    throw new Error(plainResult.message || "Transcription failed");
  }

  return [{ speaker: null, start: 0, end: 0, text: plainResult.data.transcription }];
}

// Claims exactly one queued job (atomic, safe under concurrent pollers via
// FOR UPDATE SKIP LOCKED) and runs it end-to-end: transcribe (diarized) ->
// clean -> extract structured intelligence, grounded to source segments ->
// persist -> mark done/failed. Designed to be triggered repeatedly by a lazy
// client-side poller (see components/meetings/job-poller.tsx) rather than a
// cron job - see docs/meeting-intelligence-pivot-plan.md §5.
export async function processNextJob(): Promise<ProcessJobResult> {
  const sql = await getDbConnection();

  const claimed = await sql`
    UPDATE processing_jobs
    SET status = 'running', started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM processing_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;

  if (!claimed || claimed.length === 0) {
    return { processed: false };
  }

  const job = claimed[0];
  const meetingId = job.meeting_id as number;

  try {
    const [meeting] = await sql`SELECT * FROM meetings WHERE id = ${meetingId}`;
    if (!meeting) {
      throw new Error(`Meeting ${meetingId} not found`);
    }
    if (!meeting.audio_url) {
      throw new Error("Meeting has no audio_url to transcribe");
    }

    await sql`UPDATE meetings SET status = 'processing' WHERE id = ${meetingId}`;

    // Clear any partial/previous results so a retry (see retryMeetingAction)
    // doesn't accumulate duplicate rows alongside the fresh run.
    await sql`DELETE FROM transcripts WHERE meeting_id = ${meetingId}`;
    await sql`DELETE FROM decisions WHERE meeting_id = ${meetingId}`;
    await sql`DELETE FROM action_items WHERE meeting_id = ${meetingId}`;
    await sql`DELETE FROM open_questions WHERE meeting_id = ${meetingId}`;
    await sql`DELETE FROM document_chunks WHERE meeting_id = ${meetingId}`;
    await sql`DELETE FROM meeting_segments WHERE meeting_id = ${meetingId}`;

    const fileName = (meeting.file_name as string | null) || (meeting.title as string);
    const segments = await getMeetingSegments(
      meeting.user_id as string,
      meeting.audio_url as string,
      fileName
    );

    const rawText = segments.map((s) => s.text).join("\n");
    const cleanedText = await cleanTranscript(rawText);

    await sql`
      INSERT INTO transcripts (meeting_id, raw_text, cleaned_text)
      VALUES (${meetingId}, ${rawText}, ${cleanedText})
    `;

    const segmentIds: number[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const [inserted] = await sql`
        INSERT INTO meeting_segments (meeting_id, speaker_label, start_seconds, end_seconds, text, segment_index)
        VALUES (${meetingId}, ${seg.speaker}, ${seg.start}, ${seg.end}, ${seg.text}, ${i})
        RETURNING id
      `;
      segmentIds.push(inserted.id as number);
    }

    // Index this meeting into the RAG store for "Ask this meeting" / "Ask
    // across meetings" (Phase 3) - best-effort, doesn't block the pipeline.
    try {
      await ingestMeetingSegments(
        meetingId,
        segments.map((seg, i) => ({ id: segmentIds[i], text: seg.text }))
      );
    } catch (ingestError) {
      console.error(`Knowledge ingestion failed for meeting ${meetingId}, proceeding anyway.`, ingestError);
    }

    const numberedTranscript = segments
      .map((s, i) => {
        const speakerPrefix = s.speaker ? `${s.speaker}: ` : "";
        return `[${i}] (${formatTimestamp(s.start)}-${formatTimestamp(s.end)}) ${speakerPrefix}${s.text}`;
      })
      .join("\n");

    // Conservative Flow-A retrieval (see docs §6) - best-effort context only,
    // never blocks extraction if it fails or finds nothing.
    const context = await retrieveContext(cleanedText, 3, meeting.user_id as string);
    const extraction = await extractMeetingIntelligence(numberedTranscript, context);

    for (const decision of extraction.decisions) {
      const sourceSegmentId = resolveSegmentId(segmentIds, decision.segment_index);
      await sql`
        INSERT INTO decisions (meeting_id, text, source_segment_id)
        VALUES (${meetingId}, ${decision.text}, ${sourceSegmentId})
      `;
    }

    // Candidates for owner-name resolution: the meeting owner + anyone
    // it's been shared with (Phase 4). Fetched once, reused per item.
    const ownerCandidates = (await sql`
      SELECT u.user_id, u.full_name
      FROM users u
      WHERE u.user_id = ${meeting.user_id}
         OR u.user_id IN (SELECT user_id FROM meeting_collaborators WHERE meeting_id = ${meetingId})
    `) as unknown as OwnerCandidate[];

    for (const item of extraction.action_items) {
      const sourceSegmentId = resolveSegmentId(segmentIds, item.segment_index);
      const resolvedOwnerUserId = item.owner ? matchOwnerName(item.owner, ownerCandidates) : null;

      const [insertedItem] = await sql`
        INSERT INTO action_items (meeting_id, task, owner_name, owner_user_id, due_date, source_segment_id)
        VALUES (${meetingId}, ${item.task}, ${item.owner}, ${resolvedOwnerUserId}, ${normalizeDueDate(item.due_date)}, ${sourceSegmentId})
        RETURNING id
      `;

      // Notify the assignee, unless they're the meeting owner (who will see
      // it immediately on their own meeting page anyway).
      if (resolvedOwnerUserId && resolvedOwnerUserId !== meeting.user_id) {
        await sql`
          INSERT INTO notifications (user_id, meeting_id, action_item_id, message)
          VALUES (
            ${resolvedOwnerUserId},
            ${meetingId},
            ${insertedItem.id},
            ${`You were assigned "${item.task}" in "${meeting.title}"`}
          )
        `;
      }
    }

    for (const question of extraction.open_questions) {
      const sourceSegmentId = resolveSegmentId(segmentIds, question.segment_index);
      await sql`
        INSERT INTO open_questions (meeting_id, text, source_segment_id)
        VALUES (${meetingId}, ${question.text}, ${sourceSegmentId})
      `;
    }

    const maxEnd = Math.max(0, ...segments.map((s) => s.end));
    const durationSeconds = maxEnd > 0 ? Math.round(maxEnd) : null;

    await sql`
      UPDATE meetings
      SET status = 'ready', summary = ${extraction.summary}, duration_seconds = ${durationSeconds}, completed_at = now()
      WHERE id = ${meetingId}
    `;

    await sql`
      UPDATE processing_jobs SET status = 'done', completed_at = now()
      WHERE id = ${job.id}
    `;

    await logUsageEvent(meeting.user_id as string, "meeting_processing_succeeded", null, null);
    return { processed: true, meetingId, status: "ready" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    console.error(`Job ${job.id} for meeting ${meetingId} failed:`, message);

    await sql`
      UPDATE processing_jobs SET status = 'failed', error = ${message}, completed_at = now()
      WHERE id = ${job.id}
    `;
    await sql`UPDATE meetings SET status = 'failed' WHERE id = ${meetingId}`;

    return { processed: true, meetingId, status: "failed", message };
  }
}
