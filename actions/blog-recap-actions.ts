"use server";

import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { callGeminiAPIWithRetry, extractTextFromGeminiResponse } from "@/lib/gemini";
import { userHasMeetingAccess } from "@/lib/meeting-access";
import { logUsageEvent, checkRateLimit } from "@/lib/usage-tracking";

const GEMINI_BLOG_MODEL = process.env.GEMINI_BLOG_MODEL || "gemini-2.5-flash";

export interface GenerateBlogRecapResult {
  success: boolean;
  message: string;
  postId?: number;
}

// Resolves the Phase 5 "keep the blog feature or retire it?" question by
// keeping it, demoted to a secondary export generated FROM meeting
// intelligence rather than a parallel transcription pipeline - see
// docs/meeting-intelligence-pivot-plan.md §8/§10.
export async function generateBlogRecapAction(meetingId: number): Promise<GenerateBlogRecapResult> {
  const user = await currentUser();
  if (!user) {
    return { success: false, message: "Unauthorized. Please sign in." };
  }

  const hasAccess = await userHasMeetingAccess(meetingId, user.id);
  if (!hasAccess) {
    return { success: false, message: "Meeting not found or you do not have access to it." };
  }

  const rateLimit = await checkRateLimit(user.id, "blog_recap_generated", 10, 60);
  if (!rateLimit.allowed) {
    return {
      success: false,
      message: `You've generated ${rateLimit.count} recaps in the last hour (limit ${rateLimit.limit}). Please wait a bit before generating more.`,
    };
  }

  try {
    const sql = await getDbConnection();

    const [meeting] = await sql`SELECT title, summary, status FROM meetings WHERE id = ${meetingId}`;
    if (!meeting) {
      return { success: false, message: "Meeting not found." };
    }
    if (meeting.status !== "ready") {
      return { success: false, message: "This meeting hasn't finished processing yet." };
    }

    const decisions = await sql`SELECT text FROM decisions WHERE meeting_id = ${meetingId} ORDER BY id ASC`;
    const actionItems = await sql`SELECT task, owner_name FROM action_items WHERE meeting_id = ${meetingId} ORDER BY id ASC`;
    const questions = await sql`SELECT text FROM open_questions WHERE meeting_id = ${meetingId} ORDER BY id ASC`;

    const decisionsList = decisions.map((d) => `- ${d.text}`).join("\n") || "- None recorded.";
    const actionItemsList =
      actionItems.map((a) => `- ${a.task}${a.owner_name ? ` (Owner: ${a.owner_name})` : ""}`).join("\n") ||
      "- None recorded.";
    const questionsList = questions.map((q) => `- ${q.text}`).join("\n") || "- None recorded.";

    const prompt = `
You are an expert content writer. Write an engaging, well-structured blog-style recap of the meeting below, suitable for sharing with people who weren't in the room.

Meeting title: ${meeting.title}

Summary:
${meeting.summary || "No summary available."}

Decisions made:
${decisionsList}

Action items:
${actionItemsList}

Open questions:
${questionsList}

Format as Markdown with this structure:

# [An engaging title for this recap, not necessarily the raw meeting title]

## Overview
[2-3 sentence engaging intro to what this meeting was about]

## Key Decisions
[Expand on the decisions above in prose, not just a repeated list]

## Action Items
[Present the action items clearly, who owns what]

## Open Questions
[Only include this section if there are open questions]

## What's Next
[A brief closing thought on what happens next]

Output pure Markdown - no code fences, no front matter, no preamble like "Here is your recap".
`.trim();

    const requestBody: Record<string, unknown> = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
    };

    const rawData = await callGeminiAPIWithRetry(requestBody, "blog recap generation", GEMINI_BLOG_MODEL);
    await logUsageEvent(user.id, "blog_recap_generated", GEMINI_BLOG_MODEL, rawData.usageMetadata?.totalTokenCount ?? null);

    const recapMarkdown = extractTextFromGeminiResponse(rawData);
    if (!recapMarkdown) {
      return { success: false, message: "Failed to generate a recap, please try again." };
    }

    const lines = recapMarkdown.split("\n").filter((line) => line.trim());
    const title = lines[0]?.replace(/^#+\s*/, "") || `${meeting.title} - Recap`;

    const [insertedPost] = await sql`
      INSERT INTO posts (user_id, title, content)
      VALUES (${user.id}, ${title}, ${recapMarkdown})
      RETURNING id
    `;

    return { success: true, message: "Recap generated.", postId: insertedPost.id as number };
  } catch (error) {
    console.error("Error generating blog recap:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { success: false, message: `Failed to generate recap: ${message}` };
  }
}
