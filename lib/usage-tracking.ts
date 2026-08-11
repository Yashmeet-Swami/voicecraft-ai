import getDbConnection from "@/lib/db";

// Best-effort usage logging for the /usage observability page and for
// rate limiting (see checkRateLimit below). Never throws - a logging
// failure should never break the calling flow (see docs/
// meeting-intelligence-pivot-plan.md §8, Phase 5).
export async function logUsageEvent(
  userId: string,
  eventType: string,
  model: string | null,
  totalTokens: number | null
): Promise<void> {
  try {
    const sql = await getDbConnection();
    await sql`
      INSERT INTO usage_events (user_id, event_type, model, total_tokens)
      VALUES (${userId}, ${eventType}, ${model}, ${totalTokens})
    `;
  } catch (error) {
    console.error("Failed to log usage event:", error);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

// Counts this user's events of `eventType` in the trailing `windowMinutes`
// and compares against `maxCalls`. Protects the shared Gemini free-tier
// quota from a single user's rapid-fire clicking/scripting - not a
// substitute for a real per-project rate limiter, just a guard against the
// realistic failure mode at this app's scale.
export async function checkRateLimit(
  userId: string,
  eventType: string,
  maxCalls: number,
  windowMinutes: number
): Promise<RateLimitResult> {
  const sql = await getDbConnection();
  const [row] = await sql`
    SELECT COUNT(*)::int AS count
    FROM usage_events
    WHERE user_id = ${userId}
      AND event_type = ${eventType}
      AND created_at > now() - (${windowMinutes} * interval '1 minute')
  `;
  const count = (row?.count as number) ?? 0;
  return { allowed: count < maxCalls, count, limit: maxCalls };
}
