"use server";

import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";

export interface NotificationView {
  id: number;
  meetingId: number | null;
  meetingTitle: string | null;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface GetNotificationsResult {
  success: boolean;
  notifications: NotificationView[];
  unreadCount: number;
}

export async function getNotificationsAction(limit: number = 10): Promise<GetNotificationsResult> {
  const user = await currentUser();
  if (!user) {
    return { success: false, notifications: [], unreadCount: 0 };
  }

  const sql = await getDbConnection();

  const rows = await sql`
    SELECT n.id, n.meeting_id, m.title AS meeting_title, n.message, n.is_read, n.created_at
    FROM notifications n
    LEFT JOIN meetings m ON m.id = n.meeting_id
    WHERE n.user_id = ${user.id}
    ORDER BY n.created_at DESC
    LIMIT ${limit}
  `;

  const [countRow] = await sql`
    SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = ${user.id} AND is_read = false
  `;

  return {
    success: true,
    notifications: rows.map((r) => ({
      id: r.id as number,
      meetingId: r.meeting_id as number | null,
      meetingTitle: r.meeting_title as string | null,
      message: r.message as string,
      isRead: r.is_read as boolean,
      createdAt: r.created_at as string,
    })),
    unreadCount: (countRow?.count as number) ?? 0,
  };
}

export async function markNotificationReadAction(notificationId: number) {
  const user = await currentUser();
  if (!user) return { success: false, message: "Unauthorized." };

  const sql = await getDbConnection();
  await sql`UPDATE notifications SET is_read = true WHERE id = ${notificationId} AND user_id = ${user.id}`;
  return { success: true, message: "OK" };
}

export async function markAllNotificationsReadAction() {
  const user = await currentUser();
  if (!user) return { success: false, message: "Unauthorized." };

  const sql = await getDbConnection();
  await sql`UPDATE notifications SET is_read = true WHERE user_id = ${user.id} AND is_read = false`;
  return { success: true, message: "OK" };
}
