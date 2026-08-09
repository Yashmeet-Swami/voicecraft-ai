"use server";

import { callGeminiAPIWithRetry, extractTextFromGeminiResponse } from "@/lib/gemini";

const GEMINI_EXTRACTION_MODEL = process.env.GEMINI_BLOG_MODEL || "gemini-2.5-flash";

export interface ExtractedDecision {
  text: string;
  segment_index: number | null;
}

export interface ExtractedActionItem {
  task: string;
  owner: string | null;
  due_date: string | null;
  segment_index: number | null;
}

export interface ExtractedQuestion {
  text: string;
  segment_index: number | null;
}

export interface MeetingExtraction {
  summary: string;
  decisions: ExtractedDecision[];
  action_items: ExtractedActionItem[];
  open_questions: ExtractedQuestion[];
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          segment_index: { type: "integer", nullable: true },
        },
        required: ["text"],
      },
    },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string" },
          owner: { type: "string", nullable: true },
          due_date: { type: "string", nullable: true },
          segment_index: { type: "integer", nullable: true },
        },
        required: ["task"],
      },
    },
    open_questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          segment_index: { type: "integer", nullable: true },
        },
        required: ["text"],
      },
    },
  },
  required: ["summary", "decisions", "action_items", "open_questions"],
};

function toNullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

// Turns a numbered, timestamped transcript into structured meeting
// intelligence: summary, decisions, action items, and open questions - each
// grounded (where identifiable) to the transcript segment it came from via
// segment_index. `context` is optional RAG context from prior
// documents/meetings (kept conservative - see docs/
// meeting-intelligence-pivot-plan.md §6 on scoping retrieval for extraction).
export async function extractMeetingIntelligence(
  numberedTranscript: string,
  context: string = ""
): Promise<MeetingExtraction> {
  const prompt = `
You are an expert meeting analyst. Below is a meeting transcript broken into numbered segments, formatted as:
[index] (start-end) Speaker: text

Read it and extract structured intelligence:

1. Write a concise 2-4 paragraph summary of what was discussed.
2. List every concrete decision that was made (empty array if none were made).
3. List every action item mentioned, with an owner if one was named and a due date if one was mentioned (ISO format YYYY-MM-DD, or null if not mentioned).
4. List every open or unresolved question raised during the meeting (empty array if none).
5. For each decision, action item, and open question, include "segment_index": the number in brackets of the segment where it was most clearly stated. Use null only if you truly cannot identify a specific segment.
6. Base your answer only on the transcript and the optional context below; do not invent information that isn't there.

Context Information (may be empty; use only to clarify terminology, do not treat it as part of this meeting):
${context || "No additional context available."}

Meeting Transcript:
${numberedTranscript}
`.trim();

  const requestBody: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const rawData = await callGeminiAPIWithRetry(
    requestBody,
    "meeting extraction",
    GEMINI_EXTRACTION_MODEL
  );
  const jsonText = extractTextFromGeminiResponse(rawData);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error("Failed to parse meeting extraction JSON:", error, jsonText);
    throw new Error("Failed to parse structured extraction from Gemini response");
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;

  const decisions = Array.isArray(obj.decisions)
    ? obj.decisions
        .filter(
          (d): d is Record<string, unknown> =>
            !!d && typeof d === "object" && typeof (d as Record<string, unknown>).text === "string"
        )
        .map((d) => ({
          text: d.text as string,
          segment_index: toNullableInt(d.segment_index),
        }))
    : [];

  const actionItems = Array.isArray(obj.action_items)
    ? obj.action_items
        .filter(
          (a): a is Record<string, unknown> =>
            !!a && typeof a === "object" && typeof (a as Record<string, unknown>).task === "string"
        )
        .map((a) => ({
          task: a.task as string,
          owner: typeof a.owner === "string" ? a.owner : null,
          due_date: typeof a.due_date === "string" ? a.due_date : null,
          segment_index: toNullableInt(a.segment_index),
        }))
    : [];

  const openQuestions = Array.isArray(obj.open_questions)
    ? obj.open_questions
        .filter(
          (q): q is Record<string, unknown> =>
            !!q && typeof q === "object" && typeof (q as Record<string, unknown>).text === "string"
        )
        .map((q) => ({
          text: q.text as string,
          segment_index: toNullableInt(q.segment_index),
        }))
    : [];

  return {
    summary: typeof obj.summary === "string" ? obj.summary : "",
    decisions,
    action_items: actionItems,
    open_questions: openQuestions,
  };
}
