"use server";

import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

export async function deletePostAction(postId: number) {
    try {
        const user = await currentUser();

        if (!user) {
            return { success: false, message: "Unauthorized. Please sign in." };
        }

        const sql = await getDbConnection();

        // Ensure the post belongs to the current user before deleting
        const result = await sql`
      DELETE FROM posts 
      WHERE id = ${postId} AND user_id = ${user.id}
      RETURNING id
    `;

        if (result.length === 0) {
            return { success: false, message: "Post not found or you do not have permission to delete it." };
        }

        // Clear the Next.js cache so the list updates immediately
        revalidatePath("/posts");

        return { success: true, message: "Post deleted successfully" };
    } catch (error) {
        console.error("Error deleting post:", error);
        const message = error instanceof Error ? error.message : "Unknown error occurred";
        return { success: false, message: `Failed to delete post: ${message}` };
    }
}
