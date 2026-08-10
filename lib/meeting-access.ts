import getDbConnection from "@/lib/db";

// A user can access a meeting if they own it or were added as a
// collaborator (Phase 4 - see docs/meeting-intelligence-pivot-plan.md §8).
export async function userHasMeetingAccess(meetingId: number, userId: string): Promise<boolean> {
  const sql = await getDbConnection();
  const [row] = await sql`
    SELECT 1
    FROM meetings m
    WHERE m.id = ${meetingId}
      AND (
        m.user_id = ${userId}
        OR EXISTS (
          SELECT 1 FROM meeting_collaborators mc
          WHERE mc.meeting_id = m.id AND mc.user_id = ${userId}
        )
      )
  `;
  return !!row;
}
