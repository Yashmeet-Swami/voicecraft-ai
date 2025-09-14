"use server";

import getDbConnection from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fetch, { Blob } from "node-fetch";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

type TranscriptionResponse = { text: string };
type ChatCompletionResponse = {
  choices?: { message?: { content?: string } }[];
};

// Transcribe uploaded file using Gemini API
export async function transcribeUploadedFile(
  resp: { userId: string; fileUrl: string; fileName?: string }[]
) {
  if (!resp || resp.length === 0) {
    return { success: false, message: "File upload failed", data: null };
  }

  const { userId, fileUrl, fileName = "uploaded-file" } = resp[0];

  if (!fileUrl || !fileName) {
    return { success: false, message: "File upload failed", data: null };
  }

  try {
    const fileResponse = await fetch(fileUrl);
    const fileBlob: Blob = await fileResponse.blob();

    const transcriptionResponse = await fetch("https://api.gemini.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}` },
      body: Buffer.from(await fileBlob.arrayBuffer()), // Node-fetch expects Buffer
    });

    const rawData = (await transcriptionResponse.json()) as unknown;

    // Runtime type check
    if (
      typeof rawData !== "object" ||
      rawData === null ||
      !("text" in rawData) ||
      typeof (rawData as { text: unknown }).text !== "string"
    ) {
      throw new Error("Invalid transcription response from Gemini API");
    }

    const transcriptionData: TranscriptionResponse = {
      text: (rawData as { text: string }).text,
    };

    return {
      success: true,
      message: "Transcription complete",
      data: { transcription: transcriptionData.text, userId },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error transcribing file";
    console.error(error);
    return { success: false, message, data: null };
  }
}


// Save blog post
async function saveBlogPost(userId: string, title: string, content: string) {
  try {
    const sql = await getDbConnection();
    const [insertedPost] = await sql`
    INSERT INTO posts (user_id, title, content)
    VALUES (${userId}, ${title}, ${content})
    RETURNING id
    `;
    return insertedPost.id;
  } catch (error) {
    console.error("Error saving blog post", error);
    throw error;
  }
}

// Fetch previous posts
async function getUserBlogPosts(userId: string) {
  try {
    const sql = await getDbConnection();
    const posts = await sql`
    SELECT content FROM posts 
    WHERE user_id = ${userId} 
    ORDER BY created_at DESC 
    LIMIT 3
  `;
    return posts.map((post) => post.content).join("\n\n");
  } catch (error) {
    console.error("Error getting user blog posts", error);
    throw error;
  }
}

// Generate blog via Gemini API
async function generateBlogPost(transcription: string, userPosts: string): Promise<string> {
  const response = await fetch("https://api.gemini.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GEMINI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gemini-1",
      messages: [
        {
          role: "system",
          content:
            "You are a content writer. Convert audio transcriptions into structured Markdown blog posts. Emulate user's writing style from previous posts.",
        },
        {
          role: "user",
          content: `Previous posts: ${userPosts}\n\nTranscription: ${transcription}`,
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    }),
  });

  const rawData = (await response.json()) as unknown;

  // Runtime type check
  if (
    typeof rawData !== "object" ||
    rawData === null ||
    !("choices" in rawData) ||
    !Array.isArray((rawData as ChatCompletionResponse).choices) ||
    typeof ((rawData as ChatCompletionResponse).choices?.[0]?.message?.content) !== "string"
  ) {
    throw new Error("Invalid chat completion response from Gemini API");
  }

  return (rawData as ChatCompletionResponse).choices?.[0]?.message?.content ?? "";
}

// Main server action
export async function generateBlogPostAction({
  transcriptions,
  userId,
}: {
  transcriptions: { text: string };
  userId: string;
}) {
  const userPosts = await getUserBlogPosts(userId);

  let postId = null;

  if (transcriptions) {
    const blogPost = await generateBlogPost(transcriptions.text, userPosts);

    if (!blogPost) {
      return {
        success: false,
        message: "Blog post generation failed, please try again...",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [title, ...contentParts] = blogPost?.split("\n\n") || [];

    //database connection

    if (blogPost) {
      postId = await saveBlogPost(userId, title, blogPost);
    }
  }

  //navigate
  revalidatePath(`/posts/${postId}`);
  redirect(`/posts/${postId}`);
}