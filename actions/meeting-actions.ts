"use server";

import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { inngest } from "@/lib/inngest/client";
import { logUsageEvent, checkRateLimit } from "@/lib/usage-tracking";

// Best-effort nudge to the real worker (Phase 3.5). If Inngest isn't
// reachable/configured, the lazy client-triggered poller (job-poller.tsx)
// still drains the queue - this is a latency optimization, not the only
// path to processing.
async function notifyMeetingProcessing(meetingId: number): Promise<void> {
  try {
    await inngest.send({ name: "meeting/processing.requested", data: { meetingId } });
  } catch (error) {
    console.error(`Failed to send Inngest event for meeting ${meetingId}, lazy poller will pick it up instead.`, error);
  }
}

export interface CreateMeetingInput {
  fileUrl: string;
  fileName: string;
  title: string;
}

export interface CreateMeetingResult {
  success: boolean;
  message: string;
  meetingId?: number;
}

export async function createMeetingAction(
  input: CreateMeetingInput
): Promise<CreateMeetingResult> {
  const user = await currentUser();
  if (!user) {
    return { success: false, message: "Unauthorized. Please sign in." };
  }

  if (!input.fileUrl) {
    return { success: false, message: "No file URL provided." };
  }

  // Each upload triggers a full transcription + extraction pipeline (several
  // Gemini calls) - cap how fast one user can queue those up, protecting the
  // shared free-tier quota from a runaway retry loop or accidental spam.
  const rateLimit = await checkRateLimit(user.id, "meeting_created", 10, 30);
  if (!rateLimit.allowed) {
    return {
      success: false,
      message: `You've uploaded ${rateLimit.count} meetings in the last 30 minutes (limit ${rateLimit.limit}). Please wait a bit before uploading more.`,
    };
  }

  try {
    const sql = await getDbConnection();

    const [meeting] = await sql`
      INSERT INTO meetings (user_id, title, file_name, audio_url, status)
      VALUES (${user.id}, ${input.title}, ${input.fileName}, ${input.fileUrl}, 'uploaded')
      RETURNING id
    `;

    const meetingId = meeting.id as number;

    await sql`
      INSERT INTO processing_jobs (meeting_id, status)
      VALUES (${meetingId}, 'queued')
    `;

    await logUsageEvent(user.id, "meeting_created", null, null);
    await notifyMeetingProcessing(meetingId);
    revalidatePath("/meetings");

    return {
      success: true,
      message: "Meeting created and queued for processing.",
      meetingId,
    };
  } catch (error) {
    console.error("Error creating meeting:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, message: `Failed to create meeting: ${message}` };
  }
}

export async function deleteMeetingAction(meetingId: number) {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, message: "Unauthorized. Please sign in." };
    }

    const sql = await getDbConnection();
    const result = await sql`
      DELETE FROM meetings
      WHERE id = ${meetingId} AND user_id = ${user.id}
      RETURNING id
    `;

    if (result.length === 0) {
      return {
        success: false,
        message: "Meeting not found or you do not have permission to delete it.",
      };
    }

    revalidatePath("/meetings");
    return { success: true, message: "Meeting deleted successfully" };
  } catch (error) {
    console.error("Error deleting meeting:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, message: `Failed to delete meeting: ${message}` };
  }
}

export async function retryMeetingAction(meetingId: number) {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, message: "Unauthorized. Please sign in." };
    }

    const sql = await getDbConnection();

    const [meeting] = await sql`
      SELECT id FROM meetings WHERE id = ${meetingId} AND user_id = ${user.id}
    `;
    if (!meeting) {
      return {
        success: false,
        message: "Meeting not found or you do not have permission to retry it.",
      };
    }

    await sql`UPDATE meetings SET status = 'uploaded' WHERE id = ${meetingId}`;
    await sql`
      INSERT INTO processing_jobs (meeting_id, status)
      VALUES (${meetingId}, 'queued')
    `;

    await notifyMeetingProcessing(meetingId);
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/meetings");

    return { success: true, message: "Meeting re-queued for processing." };
  } catch (error) {
    console.error("Error retrying meeting:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, message: `Failed to retry meeting: ${message}` };
  }
}

// Share a meeting with another registered user by email. Owner-only. No
// outbound email is sent - the collaborator must already have an account
// (i.e. have visited /dashboard at least once, which is when `users` gets
// populated). This is a deliberate v1 limitation, not an oversight - see
// docs/meeting-intelligence-pivot-plan.md §8, Phase 4.
export async function shareMeetingAction(meetingId: number, email: string) {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, message: "Unauthorized. Please sign in." };
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return { success: false, message: "Please enter an email address." };
    }

    const sql = await getDbConnection();

    const [meeting] = await sql`
      SELECT id FROM meetings WHERE id = ${meetingId} AND user_id = ${user.id}
    `;
    if (!meeting) {
      return {
        success: false,
        message: "Meeting not found or you do not have permission to share it.",
      };
    }

    const [collaborator] = await sql`
      SELECT user_id, full_name FROM users WHERE LOWER(email) = ${normalizedEmail}
    `;
    if (!collaborator) {
      return {
        success: false,
        message: "No VoiceCraft user found with that email yet. They need to sign in at least once first.",
      };
    }

    if (collaborator.user_id === user.id) {
      return { success: false, message: "You already own this meeting." };
    }

    await sql`
      INSERT INTO meeting_collaborators (meeting_id, user_id)
      VALUES (${meetingId}, ${collaborator.user_id})
      ON CONFLICT (meeting_id, user_id) DO NOTHING
    `;

    revalidatePath(`/meetings/${meetingId}`);

    return {
      success: true,
      message: `Shared with ${collaborator.full_name || normalizedEmail}.`,
    };
  } catch (error) {
    console.error("Error sharing meeting:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, message: `Failed to share meeting: ${message}` };
  }
}

export async function removeCollaboratorAction(meetingId: number, collaboratorUserId: string) {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, message: "Unauthorized. Please sign in." };
    }

    const sql = await getDbConnection();
    const [meeting] = await sql`
      SELECT id FROM meetings WHERE id = ${meetingId} AND user_id = ${user.id}
    `;
    if (!meeting) {
      return {
        success: false,
        message: "Meeting not found or you do not have permission to manage it.",
      };
    }

    await sql`
      DELETE FROM meeting_collaborators WHERE meeting_id = ${meetingId} AND user_id = ${collaboratorUserId}
    `;

    revalidatePath(`/meetings/${meetingId}`);
    return { success: true, message: "Collaborator removed." };
  } catch (error) {
    console.error("Error removing collaborator:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, message: `Failed to remove collaborator: ${message}` };
  }
}
