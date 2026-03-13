"use server";

import getDbConnection from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Prefer stable models in production; can be overridden via env
const GEMINI_TRANSCRIBE_MODEL =
  process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-2.5-flash";
const GEMINI_BLOG_MODEL =
  process.env.GEMINI_BLOG_MODEL || "gemini-2.5-flash";

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

  const model = modelName || "gemini-2.5-flash";
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
        console.log(`⏳ Retrying in ${Math.round(delay) / 1000} seconds due to ${getErrorDescription(status)}...`);
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
        console.log(`⏳ Network error, retrying in ${Math.round(delay) / 1000} seconds...`);
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

// Pre-process transcript to remove fillers and repeated sentences
async function cleanTranscript(rawTranscript: string): Promise<string> {
  const prompt = `
You are an expert editor. Please clean the following transcript.
Remove all filler words, repeated sentences, and casual conversational phrases.
Keep only the key ideas, professional tone, and core meaning.
Do NOT summarize it into a short paragraph; keep the full length of the core ideas, just remove the fluff.
Return ONLY the cleaned transcript with no preamble or commentary.

Raw Transcript:
${rawTranscript}
`.trim();

  const requestBody: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2, // Low temp for accurate cleaning
      maxOutputTokens: 2048,
    },
  };

  try {
    const rawData = await callGeminiAPIWithRetry(requestBody, "transcript cleaning", GEMINI_BLOG_MODEL);
    const cleaned = extractTextFromGeminiResponse(rawData);
    return cleaned || rawTranscript; // Fallback to raw if cleaning fails
  } catch (error) {
    console.warn("Failed to clean transcript, using raw version.", error);
    return rawTranscript;
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

// Generate blog via Gemini API (fixed for gemini-2.5-flash; no model fallback, no responseMimeType)
async function generateBlogPost(
  cleanedTranscription: string,
  userPosts: string,
  context: string = ""
): Promise<string> {
  const prompt = `
You are an expert content writer. Your task is to rewrite the provided transcript into a highly engaging, professional blog article.
Do NOT directly copy the transcript sentences. Instead, rewrite the content to improve readability, remove repetition, and ensure paragraphs are concise.

Style reference (analyze and emulate voice, vocabulary, pacing, and formatting):
${userPosts || "No previous posts. Adopt a professional, engaging tone."}

Enforce the following strict formatting rules using Markdown:

# [Title of the Blog]

## Introduction
[Write a short engaging paragraph introducing the topic]

## [Section 1 Heading]
[Content for section 1. Keep paragraphs short and readable.]

## [Section 2 Heading]
[Content for section 2. Include examples or explanations if applicable.]

## [Section 3 Heading]
[Content for section 3. Use bullet points if it improves readability.]

## Conclusion
[Summarize the key ideas and provide a brief closing thought or call to action.]

Important Instructions:
1. Use the "Cleaned Transcript" below as your main source of information.
2. Use the "Context Information" to enrich explanations, add specific facts, or clarify terminology not fully explained in the transcript.
3. Avoid repeating raw transcript sentences verbatim. Generate a well-written article rather than a transcript summary.
4. Output pure Markdown—no code fences, no front matter, no preamble like "Here is your post".

---

Context Information:
${context || "No additional background context available."}

Cleaned Transcript:
${cleanedTranscription}
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
function isRedirectError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;

  // Next.js 13+ throws an error with a specific digest for redirects
  const obj = e as Record<string, unknown>;
  if (typeof obj.digest === "string" && obj.digest.startsWith("NEXT_REDIRECT")) {
    return true;
  }

  // Sometimes NextJS throws an Error where the message contains NEXT_REDIRECT
  if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) {
    return true;
  }

  return false;
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

    // Retrieve context using RAG
    const { retrieveContext, ingestTextDocument } = await import("./knowledge-actions");
    const retrievedContext = await retrieveContext(transcriptText);

    // Clean the transcript before generation
    console.log("🧹 Cleaning transcript to remove filler words...");
    const cleanedTranscriptText = await cleanTranscript(transcriptText);

    // Generate Blog
    const blogPost = await generateBlogPost(cleanedTranscriptText, userPosts, retrievedContext);

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

    // Auto-ingest the ORIGINAL raw transcript into the RAG store for future reference
    // (Better to save raw keywords into vector space than the heavily summarized cleaned version)
    try {
      const docTitle = `Transcript Knowledge - ${new Date().toLocaleDateString()}`;
      // Fire and forget or await depending on strictness - we'll await to ensure it's logged
      await ingestTextDocument(docTitle, transcriptText);
    } catch (ingestError) {
      console.error("Auto-ingestion of transcript failed. Proceeding anyway.", ingestError);
    }

    // Return the URL instead of throwing a redirect from the server action
    return {
      success: true,
      message: `/posts/${postId}`,
    };
  } catch (error) {
    // Let Next.js handle the redirect error without logging
    if (isRedirectError(error)) {
      throw error;
    }

    console.error("Error in generateBlogPostAction:", error);
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return {
      success: false,
      message: `Blog generation failed: ${message}`,
      data: null // adding data to match expected return type
    } as unknown as BlogPostActionResult; // satisfy typescript if types mismatch
  }
}