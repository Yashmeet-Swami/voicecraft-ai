import { auth, currentUser } from "@clerk/nextjs/server";
import getDbConnection from "@/lib/db";
import { NextResponse } from "next/server";

export async function doesUserExist(userId: string, email: string) {
  const sql = await getDbConnection();
  const rows = await sql`
    SELECT * FROM users 
    WHERE user_id = ${userId} OR email = ${email}
  `;
  return rows.length > 0 ? rows[0] : null;
}

export async function updateUser(userId: string, fullName: string, email: string) {
  const sql = await getDbConnection();
  await sql`
    UPDATE users
    SET full_name = ${fullName}, email = ${email}
    WHERE user_id = ${userId}
  `;
}

export async function POST() {
  const { userId } = await auth(); // Clerk userId
  const user = await currentUser(); // Clerk full user object

  if (!userId || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const email = user.emailAddresses[0].emailAddress; // ✅ extract email safely
  const fullName = user.fullName || "";

  const existingUser = await doesUserExist(userId, email);

  if (!existingUser) {
    const sql = await getDbConnection();
    await sql`
      INSERT INTO users (user_id, full_name, email)
      VALUES (${userId}, ${fullName}, ${email})
    `;
  } else {
    await updateUser(userId, fullName, email);
  }

  return NextResponse.json({ success: true });
}
