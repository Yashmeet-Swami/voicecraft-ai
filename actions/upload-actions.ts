"use server";

import getDbConnection from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Prefer stable models in production; can be overridden via env
const GEMINI_TRANSCRIBE_MODEL =
  process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-2.0-flash";
const GEMINI_BLOG_MODEL =
  process.env.GEMINI_BLOG_MODEL || "gemini-2.0-flash";

// ==== Types for Gemini API responses ====
interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  parts?: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  [key: string]: unknown;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

interface TranscriptionResult {
  success: boolean;
  message: string;
  data: {
    transcription: string;
    userId: string;
    fileInfo: {
      fileName: string;
      fileSize: string;
      mimeType: string;
      type: string;
    };
  } | null;
}

interface BlogPostActionParams {
  transcriptions: { text: string };
  userId: string;
}

interface BlogPostActionResult {
  success: boolean;
  message: string;
}

// Retry configuration
const RETRY_CONFIG: RetryConfig = {
  maxRetries: 6,          // increased for transient 5xx/UNAVAILABLE
  baseDelay: 1000,        // 1 second
  maxDelay: 30000,        // 30 seconds
  backoffFactor: 2
};

// Helper function to sleep
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate delay with exponential backoff + jitter
function getRetryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffFactor, attempt - 1);
  const jitter = Math.random() * 300; // small jitter to avoid thundering herd
  return Math.min(delay + jitter, RETRY_CONFIG.maxDelay);
}

// Helper function to determine MIME type from file name
function getMimeType(fileName: string): string {
  const extension = fileName?.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Audio formats
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'wma': 'audio/x-ms-wma',
    // Video formats
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'webm': 'video/webm',
    'mkv': 'video/x-matroska',
    'flv': 'video/x-flv'
  };
  return mimeTypes[extension || ''] || 'application/octet-stream';
}

// Helper function to safely extract text from Gemini response
function extractTextFromGeminiResponse(rawData: GeminiResponse): string {
  try {
    const candidates = rawData?.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("No candidates in Gemini response");
    }

    const candidate = candidates[0];

    const standardText = candidate?.content?.parts?.[0]?.text;
    if (standardText && typeof standardText === 'string' && standardText.trim().length > 0) {
      return standardText;
    }

    const directText = (candidate as Record<string, unknown>)['text'];
    if (typeof directText === 'string' && directText.trim().length > 0) {
      return directText;
    }

    const outputObj = (candidate as Record<string, unknown>)['output'] as Record<string, unknown> | undefined;
    if (outputObj && typeof outputObj === 'object') {
      const outputText = outputObj['text'] as unknown;
      if (typeof outputText === 'string' && outputText.trim().length > 0) {
        return outputText;
      }
    }

    if (candidate?.content?.parts && Array.isArray(candidate.content.parts)) {
      const allTexts = candidate.content.parts
        .map(part => part.text)
        .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
        .join(' ');
      if (allTexts.trim().length > 0) return allTexts;
    }

    throw new Error("No text content found in Gemini response structure");
  } catch (error) {
    console.error("Error extracting text from Gemini response:", error);
    throw new Error("Failed to extract text from Gemini response");
  }
}

// Robust API call function with retry logic
async function callGeminiAPIWithRetry(
  requestBody: Record<string, unknown>,
  operationType: string = "transcription",
  modelName?: string
): Promise<GeminiResponse> {
  let lastError: Error | null = null;

  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  const model = modelName || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`🤖 Sending ${operationType} request to Gemini (attempt ${attempt}/${RETRY_CONFIG.maxRetries}) using model "${model}"...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60s per attempt

      const response = await fetch(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        }
      ).finally(() => clearTimeout(timeoutId));

      if (response.ok) {
        console.log(`✅ ${operationType} request successful on attempt ${attempt}`);
        const result = await response.json() as GeminiResponse;
        return result;
      }

      const status = response.status;
      const statusText = response.statusText;
      let errorDetails = "";
      try {
        errorDetails = await response.text();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        errorDetails = "Could not read error response";
      }

      console.error(`❌ Gemini API error (attempt ${attempt}):`, {
        status,
        statusText,
        details: errorDetails
      });

      const shouldRetry = shouldRetryError(status, attempt);
      if (shouldRetry && attempt < RETRY_CONFIG.maxRetries) {
        const delay = getRetryDelay(attempt);
        console.log(`⏳ Retrying in ${Math.round(delay)/1000} seconds due to ${getErrorDescription(status)}...`);
        await sleep(delay);
        continue;
      } else {
        throw new Error(getUserFriendlyError(status, statusText, errorDetails));
      }

    } catch (error) {
      const errObj = error instanceof Error ? error : new Error(String(error));
      lastError = errObj;

      if (attempt < RETRY_CONFIG.maxRetries && isNetworkError(errObj)) {
        const delay = getRetryDelay(attempt);
        console.log(`⏳ Network error, retrying in ${Math.round(delay)/1000} seconds...`);
        await sleep(delay);
        continue;
      }

      if (attempt === RETRY_CONFIG.maxRetries) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error("Unknown error during API call");
}

// Helper functions for error handling
function shouldRetryError(status: number, attempt: number): boolean {
  const retryableStatuses = [503, 502, 504, 429, 500];
  return retryableStatuses.includes(status) && attempt < RETRY_CONFIG.maxRetries;
}

function isNetworkError(error: Error): boolean {
  const networkErrorMessages = [
    'fetch failed',
    'network error',
    'connection error',
    'timeout',
    'ECONNRESET',
    'ENOTFOUND',
    'ETIMEDOUT',
    'aborted',
    'AbortError'
  ];
  return networkErrorMessages.some(msg =>
    error.message.toLowerCase().includes(msg.toLowerCase())
  );
}

function getErrorDescription(status: number): string {
  const descriptions: Record<number, string> = {
    429: "rate limiting",
    500: "internal server error",
    502: "bad gateway",
    503: "service unavailable",
    504: "gateway timeout"
  };
  return descriptions[status] || `HTTP ${status}`;
}

function getUserFriendlyError(status: number, statusText: string, details: string): string {
  switch (status) {
    case 401:
      return "Invalid API key. Please check your Gemini API configuration.";
    case 403:
      return "Access forbidden. Your API key may not have the required permissions.";
    case 429:
      return "Too many requests. Please wait a moment before trying again.";
    case 500:
    case 502:
    case 503:
    case 504:
      return "Gemini service is temporarily unavailable. Please try again in a few minutes.";
    case 400:
      if (details.toLowerCase().includes('file') || details.toLowerCase().includes('audio')) {
        return "The uploaded file format is not supported or the file may be corrupted.";
      }
      return "Invalid request. Please check your file and try again.";
    default:
      return `Transcription service error: ${status} ${statusText}. Please try again.`;
  }
}

// Transcribe uploaded file using Gemini API with retry logic
export async function transcribeUploadedFile(
  resp: { userId: string; fileUrl: string; fileName?: string }[]
): Promise<TranscriptionResult> {
  if (!resp || resp.length === 0) {
    return { success: false, message: "File upload failed", data: null };
  }

  const { userId, fileUrl, fileName } = resp[0];
  if (!fileUrl) {
    return { success: false, message: "No file URL", data: null };
  }

  try {
    console.log("🎬 Starting transcription process...");
    console.log("📁 File URL:", fileUrl);
    console.log("📝 File Name:", fileName || "Unknown");

    // Step 1: Detect MIME type correctly using fileName
    const mimeType = getMimeType(fileName || "");
    const isAudio = mimeType.startsWith('audio/');
    const isVideo = mimeType.startsWith('video/');

    console.log(`🎵 Detected MIME type: ${mimeType} (${isAudio ? 'Audio' : isVideo ? 'Video' : 'Unknown'} file)`);

    // Step 2: Download file from UploadThing with retry logic
    console.log("⬇️ Downloading file from UploadThing...");
    let fileResponse: Response | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        fileResponse = await fetch(fileUrl);
        if (fileResponse.ok) break;
        if (attempt < 3) {
          console.log(`⚠️ Download attempt ${attempt} failed, retrying...`);
          await sleep(1000 * attempt);
        }
      } catch (error) {
        if (attempt === 3) throw error;
        console.log(`⚠️ Download attempt ${attempt} failed, retrying...`);
        await sleep(1000 * attempt);
      }
    }

    if (!fileResponse || !fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse?.status} - ${fileResponse?.statusText}`);
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    const fileSizeMB = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`✅ File downloaded successfully: ${fileSizeMB}MB`);

    const fileSizeBytes = arrayBuffer.byteLength;
    const maxSizeBytes = 20 * 1024 * 1024;
    if (fileSizeBytes > maxSizeBytes) {
      throw new Error(`File too large (${fileSizeMB}MB). Please use files smaller than 20MB.`);
    }

    // Step 3: Convert to Base64 inline data
    console.log("🔄 Converting to Base64 for Gemini API...");
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    console.log(`✅ Base64 conversion complete: ${(base64Data.length / 1024).toFixed(0)}KB encoded`);

    // Step 4: Prepare request body
    const requestBody: Record<string, unknown> = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType
              }
            },
            {
              text: `Please carefully transcribe all spoken words from this ${isAudio ? 'audio' : 'video'} file.

Instructions:
- Extract ALL spoken words accurately
- Maintain the natural flow and timing of speech
- Include natural pauses and emphasis where appropriate
- If multiple speakers, try to distinguish them
- If there is background music or noise, focus only on the speech
- If there is absolutely NO speech content, respond with exactly: "NO_SPEECH_DETECTED"
- Do not add any commentary, just provide the raw transcription

Transcribe everything you hear:`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        topP: 0.8,
        topK: 40
      }
    };

    // Step 5: Call API with retry logic (stable model by default)
    const rawData = await callGeminiAPIWithRetry(requestBody, "transcription", GEMINI_TRANSCRIBE_MODEL);

    console.log("📋 Full Gemini API response:");
    console.log(JSON.stringify(rawData, null, 2));

    // Step 6: Extract transcription safely
    const transcriptionText = extractTextFromGeminiResponse(rawData);

    console.log(`📝 Raw transcription length: ${transcriptionText.length} characters`);
    console.log("📄 Transcription preview:", transcriptionText.substring(0, 200) + "...");

    if (!transcriptionText || transcriptionText.trim() === "") {
      throw new Error("Empty transcription returned from Gemini API");
    }

    if (transcriptionText.trim().toUpperCase().includes("NO_SPEECH_DETECTED")) {
      throw new Error("No speech detected in the uploaded file. Please upload a file with clear spoken content.");
    }

    if (transcriptionText.trim().length < 10) {
      console.warn("⚠️ Warning: Very short transcription received. This might indicate poor audio quality or processing issues.");
    }

    console.log("🎉 Transcription completed successfully!");

    return {
      success: true,
      message: "Transcription completed successfully",
      data: {
        transcription: transcriptionText.trim(),
        userId,
        fileInfo: {
          fileName: fileName || "Unknown",
          fileSize: fileSizeMB + "MB",
          mimeType: mimeType,
          type: isAudio ? 'audio' : 'video'
        }
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error occurred during transcription";
    console.error("❌ Transcription failed:", message);
    console.error("🔍 Error details:", error);

    return {
      success: false,
      message: `Transcription failed: ${message}`,
      data: null
    };
  }
}

// Save blog post
async function saveBlogPost(userId: string, title: string, content: string): Promise<number> {
  try {
    const sql = await getDbConnection();
    const [insertedPost] = await sql`
      INSERT INTO posts (user_id, title, content)
      VALUES (${userId}, ${title}, ${content})
      RETURNING id
    `;
    return insertedPost.id as number;
  } catch (error) {
    console.error("Error saving blog post", error);
    throw error;
  }
}

// Fetch previous posts
async function getUserBlogPosts(userId: string): Promise<string> {
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

// Generate blog via Gemini API (fixed for gemini-2.0-flash; no model fallback, no responseMimeType)
async function generateBlogPost(
  transcription: string,
  userPosts: string
): Promise<string> {
  const prompt = `
You are a skilled content writer who converts audio transcriptions into engaging blog posts using Markdown only.

Style reference (analyze and emulate voice, vocabulary, pacing, and formatting):
${userPosts || "No previous posts"}

Write a blog post based on the transcript below. Follow these hard rules:
1) First line must be an SEO-friendly H1 title: "# Your Title".
2) Then add exactly two newlines.
3) Write an engaging introduction (2–4 sentences).
4) Organize the body into 3–5 sections with clear H2 headings (##). Use H3 (###) for sub-points if helpful.
5) Use bullet or numbered lists where it improves readability.
6) Include a "Key Takeaways" section with 3–5 concise bullets near the end.
7) End with a brief conclusion and an optional call to action relevant to the content.
8) Keep the tone casual-professional and consistent with the style reference.
9) Do not invent facts beyond the transcript; you may generalize prudently. No external links or citations unless present in the transcript.
10) Output pure Markdown—no code fences, no front matter, no preamble like "Here is your post".

Length guidance:
- Aim for ~600–900 words. If the transcript is short or fragmented, write a compact but coherent post (~300–600 words) that synthesizes the main ideas.

If the transcript mentions specific terms, quotes, or phrases worth highlighting, consider using:
- Blockquotes for notable lines.
- Short lists for steps, tips, or examples.

Transcript:
${transcription}
`.trim();

  const requestBody: Record<string, unknown> = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048
      // Note: Do NOT set responseMimeType here for gemini-2.0-flash,
      // as the API only allows text/plain, json, xml, yaml, x.enum.
      // We'll just instruct Markdown via the prompt.
    },
  };

  const rawData = await callGeminiAPIWithRetry(requestBody, "blog generation", GEMINI_BLOG_MODEL);
  const blogPost = rawData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (!blogPost) {
    throw new Error("Invalid blog response from Gemini API");
  }

  return blogPost;
}

// Helper to avoid logging/handling internal Next.js redirect as an error
function getErrorDigest(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    const d = obj.digest;
    if (typeof d === "string") return d;
  }
  return undefined;
}

// Main server action
export async function generateBlogPostAction({
  transcriptions,
  userId,
}: BlogPostActionParams): Promise<BlogPostActionResult | never> {
  try {
    const transcriptText = transcriptions?.text?.trim();
    if (!transcriptText) {
      return {
        success: false,
        message: "No transcription text provided",
      };
    }

    const userPosts = await getUserBlogPosts(userId);

    const blogPost = await generateBlogPost(transcriptText, userPosts);

    if (!blogPost) {
      return {
        success: false,
        message: "Blog post generation failed, please try again...",
      };
    }

    const lines = blogPost.split('\n').filter(line => line.trim());
    const title = lines[0]?.replace(/^#+\s*/, '') || "Generated Blog Post";
    const content = blogPost;

    const postId = await saveBlogPost(userId, title, content);

    revalidatePath(`/posts/${postId}`);
    redirect(`/posts/${postId}`);
  } catch (error) {
    // Let Next.js handle the redirect error without logging
    const digest = getErrorDigest(error);
    if (digest?.startsWith("NEXT_REDIRECT;")) {
      throw error;
    }

    console.error("Error in generateBlogPostAction:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      message: `Blog generation failed: ${message}`,
    };
  }
}