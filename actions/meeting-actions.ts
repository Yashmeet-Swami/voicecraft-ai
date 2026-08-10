"use server";

import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { inngest } from "@/lib/inngest/client";

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
