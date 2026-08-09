// Shared Gemini API call helpers used by server actions (transcription, blog
// generation, meeting extraction). Kept out of any "use server" file because
// it exports synchronous helpers and plain types, which "use server" files
// are not allowed to export.

export interface GeminiPart {
  text?: string;
}

export interface GeminiContent {
  parts?: GeminiPart[];
}

export interface GeminiCandidate {
  content?: GeminiContent;
  [key: string]: unknown;
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const RETRY_CONFIG: RetryConfig = {
  maxRetries: 6, // increased for transient 5xx/UNAVAILABLE
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffFactor: 2,
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffFactor, attempt - 1);
  const jitter = Math.random() * 300; // small jitter to avoid thundering herd
  return Math.min(delay + jitter, RETRY_CONFIG.maxDelay);
}

function shouldRetryError(status: number, attempt: number): boolean {
  const retryableStatuses = [503, 502, 504, 429, 500];
  return retryableStatuses.includes(status) && attempt < RETRY_CONFIG.maxRetries;
}

function isNetworkError(error: Error): boolean {
  const networkErrorMessages = [
    "fetch failed",
    "network error",
    "connection error",
    "timeout",
    "ECONNRESET",
    "ENOTFOUND",
    "ETIMEDOUT",
    "aborted",
    "AbortError",
  ];
  return networkErrorMessages.some((msg) =>
    error.message.toLowerCase().includes(msg.toLowerCase())
  );
}

function getErrorDescription(status: number): string {
  const descriptions: Record<number, string> = {
    429: "rate limiting",
    500: "internal server error",
    502: "bad gateway",
    503: "service unavailable",
    504: "gateway timeout",
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
      if (details.toLowerCase().includes("file") || details.toLowerCase().includes("audio")) {
        return "The uploaded file format is not supported or the file may be corrupted.";
      }
      return "Invalid request. Please check your file and try again.";
    default:
      return `Transcription service error: ${status} ${statusText}. Please try again.`;
  }
}

// Safely extract text from a Gemini response, trying a few known shapes.
export function extractTextFromGeminiResponse(rawData: GeminiResponse): string {
  try {
    const candidates = rawData?.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error("No candidates in Gemini response");
    }

    const candidate = candidates[0];

    const standardText = candidate?.content?.parts?.[0]?.text;
    if (standardText && typeof standardText === "string" && standardText.trim().length > 0) {
      return standardText;
    }

    const directText = (candidate as Record<string, unknown>)["text"];
    if (typeof directText === "string" && directText.trim().length > 0) {
      return directText;
    }

    const outputObj = (candidate as Record<string, unknown>)["output"] as
      | Record<string, unknown>
      | undefined;
    if (outputObj && typeof outputObj === "object") {
      const outputText = outputObj["text"] as unknown;
      if (typeof outputText === "string" && outputText.trim().length > 0) {
        return outputText;
      }
    }

    if (candidate?.content?.parts && Array.isArray(candidate.content.parts)) {
      const allTexts = candidate.content.parts
        .map((part) => part.text)
        .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
        .join(" ");
      if (allTexts.trim().length > 0) return allTexts;
    }

    throw new Error("No text content found in Gemini response structure");
  } catch (error) {
    console.error("Error extracting text from Gemini response:", error);
    throw new Error("Failed to extract text from Gemini response");
  }
}

// Robust Gemini generateContent call with retry/backoff for transient errors.
export async function callGeminiAPIWithRetry(
  requestBody: Record<string, unknown>,
  operationType: string = "generation",
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

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      if (response.ok) {
        console.log(`✅ ${operationType} request successful on attempt ${attempt}`);
        const result = (await response.json()) as GeminiResponse;
        return result;
      }

      const status = response.status;
      const statusText = response.statusText;
      let errorDetails = "";
      try {
        errorDetails = await response.text();
      } catch {
        errorDetails = "Could not read error response";
      }

      console.error(`❌ Gemini API error (attempt ${attempt}):`, {
        status,
        statusText,
        details: errorDetails,
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
