"use server";

import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { userHasMeetingAccess } from "@/lib/meeting-access";

const VALID_STATUSES = ["open", "in_progress", "done"];

// Any collaborator with access to the meeting can update any action item's
// status - not just the person it's assigned to. Small-team collaboration,
// not strict per-assignee locking (see docs/meeting-intelligence-pivot-plan.md §8).
export async function updateActionItemStatusAction(actionItemId: number, status: string) {
  try {
    const user = await currentUser();
    if (!user) {
      return { success: false, message: "Unauthorized. Please sign in." };
    }

    if (!VALID_STATUSES.includes(status)) {
      return { success: false, message: "Invalid status." };
    }

    const sql = await getDbConnection();
    const [item] = await sql`SELECT id, meeting_id FROM action_items WHERE id = ${actionItemId}`;
    if (!item) {
      return { success: false, message: "Action item not found." };
    }

    const hasAccess = await userHasMeetingAccess(item.meeting_id as number, user.id);
    if (!hasAccess) {
      return { success: false, message: "You do not have permission to update this action item." };
    }

    await sql`UPDATE action_items SET status = ${status} WHERE id = ${actionItemId}`;

    revalidatePath(`/meetings/${item.meeting_id}`);
    revalidatePath("/action-items");

    return { success: true, message: "Status updated." };
  } catch (error) {
    console.error("Error updating action item status:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, message: `Failed to update status: ${message}` };
  }
}
