"use server";

import getDbConnection from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { callGeminiAPIWithRetry, extractTextFromGeminiResponse } from "@/lib/gemini";
import { formatTimestamp } from "@/lib/utils";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const GEMINI_QA_MODEL = process.env.GEMINI_BLOG_MODEL || "gemini-2.5-flash";

// ==== Types ====
interface IngestResult {
    success: boolean;
    message: string;
    chunksAdded?: number;
}

export interface AskSource {
    meetingId: number;
    meetingTitle: string;
    segmentId: number | null;
    startSeconds: number | null;
    snippet: string;
}

export interface AskResult {
    success: boolean;
    message: string;
    answer?: string;
    sources?: AskSource[];
}

// ==== Text Chunking ====
function chunkText(text: string, maxWords: number = 600): string[] {
    // Split by paragraphs first
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = "";
    let currentWordCount = 0;

    for (const para of paragraphs) {
        const words = para.trim().split(/\s+/);
        const wordCount = words.length;

        if (wordCount === 0) continue;

        if (currentWordCount + wordCount > maxWords && currentWordCount > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = para;
            currentWordCount = wordCount;
        } else {
            currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
            currentWordCount += wordCount;
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

interface SegmentInput {
    id: number;
    text: string;
}

interface SegmentChunk {
    text: string;
    // First segment covered by this chunk - used as the citation anchor
    // since a chunk usually spans several short meeting segments.
    anchorSegmentId: number;
}

// Like chunkText, but groups consecutive meeting segments (rather than
// paragraphs) so each chunk can still be traced back to roughly where it
// starts in the recording.
function chunkSegments(segments: SegmentInput[], maxWords: number = 300): SegmentChunk[] {
    const chunks: SegmentChunk[] = [];
    let currentText = "";
    let currentWordCount = 0;
    let anchorSegmentId: number | null = null;

    for (const seg of segments) {
        const words = seg.text.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) continue;

        if (currentWordCount + words.length > maxWords && currentWordCount > 0) {
            chunks.push({ text: currentText.trim(), anchorSegmentId: anchorSegmentId as number });
            currentText = seg.text;
            currentWordCount = words.length;
            anchorSegmentId = seg.id;
        } else {
            if (anchorSegmentId === null) anchorSegmentId = seg.id;
            currentText = currentText ? currentText + " " + seg.text : seg.text;
            currentWordCount += words.length;
        }
    }

    if (currentText.trim()) {
        chunks.push({ text: currentText.trim(), anchorSegmentId: anchorSegmentId as number });
    }

    return chunks;
}

// ==== Gemini Embedding Helper ====
async function generateEmbedding(text: string): Promise<number[]> {
    if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY environment variable is not set");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            content: {
                parts: [{ text }]
            }
        }),
    });

    if (!response.ok) {
        const errorDetails = await response.text();
        console.error("Gemini Embedding Error:", errorDetails);
        throw new Error(`Failed to generate embedding: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const embedding = data?.embedding?.values;

    if (!embedding || !Array.isArray(embedding)) {
        throw new Error("Invalid embedding structure returned from Gemini API");
    }

    return embedding;
}

// ==== Ingest Document Action ====
export async function ingestTextDocument(title: string, content: string): Promise<IngestResult> {
    try {
        console.log(`Knowledge Ingestion: Processing document "${title}"`);
        const chunks = chunkText(content);
        console.log(`Knowledge Ingestion: Split into ${chunks.length} chunks`);

        const sql = await getDbConnection();

        // 1. Save document metadata
        const [insertedDoc] = await sql`
      INSERT INTO documents (title, content)
      VALUES (${title}, ${content})
      RETURNING id
    `;
        const documentId = insertedDoc.id as number;

        // 2. Generate embeddings and insert chunks
        let chunksAdded = 0;
        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            if (!chunkText) continue;

            console.log(`Generating embedding for chunk ${i + 1}/${chunks.length}...`);
            const embeddingData = await generateEmbedding(chunkText);

            // Format the pgvector string representation: '[1.1, 2.2, 3.3]'
            const embeddingString = `[${embeddingData.join(',')}]`;

            await sql`
          INSERT INTO document_chunks (document_id, chunk_index, text, embedding)
          VALUES (${documentId}, ${i}, ${chunkText}, ${embeddingString}::vector)
        `;
            chunksAdded++;
        }

        console.log(`✅ Ingested ${chunksAdded} chunks for document "${title}"`);
        return { success: true, message: `Successfully ingested document and generated embeddings.`, chunksAdded };

    } catch (error) {
        console.error("Knowledge Ingestion Error:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Failed to ingest document"
        };
    }
}

// ==== Similarity Search Helper ====
// When userId is provided, meeting-derived chunks (meeting_id set) from
// other users are excluded. Generic ingested documents (meeting_id null,
// e.g. blog transcripts) stay visible either way - unchanged legacy
// behavior, not a new leak. This matters more now that meeting-derived
// chunks can contain full, potentially sensitive transcripts.
export async function retrieveContext(
    query: string,
    limit: number = 3,
    userId?: string
): Promise<string> {
    try {
        console.log("Retrieving context for query...");
        const queryEmbedding = await generateEmbedding(query);
        const embeddingString = `[${queryEmbedding.join(',')}]`;

        const sql = await getDbConnection();

        // Use vector_cosine_ops (<=>) for cosine distance
        const chunks = userId
            ? await sql`
                SELECT dc.id, dc.text, dc.embedding <=> ${embeddingString}::vector AS distance
                FROM document_chunks dc
                LEFT JOIN meetings m ON m.id = dc.meeting_id
                WHERE dc.meeting_id IS NULL OR m.user_id = ${userId}
                ORDER BY distance ASC
                LIMIT ${limit}
            `
            : await sql`
                SELECT id, text, embedding <=> ${embeddingString}::vector AS distance
                FROM document_chunks
                ORDER BY distance ASC
                LIMIT ${limit}
            `;

        if (!chunks || chunks.length === 0) {
            console.log("No relevant context found.");
            return "";
        }

        console.log(`Found ${chunks.length} relevant chunks (top distance: ${chunks[0].distance})`);

        // Concatenate retrieved chunks with delimiters
        const contextText = chunks.map((c, i) => `--- Context Document ${i + 1} ---\n${c.text}\n`).join("\n");
        return contextText;

    } catch (error) {
        console.error("Error retrieving context:", error);
        // Fail gracefully; don't break the main flow if context fails
        return "";
    }
}

// ==== Meeting Knowledge Base (Phase 3) ====

// Ingests a processed meeting's segments into the RAG store, linked back to
// the meeting/segment for citation. Called once per successful processing
// run from actions/job-actions.ts.
export async function ingestMeetingSegments(
    meetingId: number,
    segments: SegmentInput[]
): Promise<IngestResult> {
    try {
        const chunks = chunkSegments(segments);
        const sql = await getDbConnection();

        let chunksAdded = 0;
        for (let i = 0; i < chunks.length; i++) {
            const { text, anchorSegmentId } = chunks[i];
            const embeddingData = await generateEmbedding(text);
            const embeddingString = `[${embeddingData.join(',')}]`;

            await sql`
                INSERT INTO document_chunks (meeting_id, segment_id, chunk_index, text, embedding)
                VALUES (${meetingId}, ${anchorSegmentId}, ${i}, ${text}, ${embeddingString}::vector)
            `;
            chunksAdded++;
        }

        console.log(`✅ Ingested ${chunksAdded} chunks for meeting ${meetingId} into knowledge base`);
        return { success: true, message: "Meeting ingested into knowledge base", chunksAdded };
    } catch (error) {
        console.error("Meeting knowledge ingestion error:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Failed to ingest meeting",
        };
    }
}

interface ChunkForAnswer {
    meetingTitle: string;
    startSeconds: number | null;
    text: string;
}

async function answerFromChunks(question: string, chunks: ChunkForAnswer[]): Promise<string> {
    if (chunks.length === 0) {
        return "I couldn't find anything relevant in your meetings to answer that.";
    }

    const contextBlock = chunks
        .map((c, i) => {
            const timeLabel = c.startSeconds != null ? `, ${formatTimestamp(c.startSeconds)}` : "";
            return `[${i + 1}] (Meeting: "${c.meetingTitle}"${timeLabel})\n${c.text}`;
        })
        .join("\n\n");

    const prompt = `
You are answering a question using only the excerpts from past meetings below. Cite which excerpt number(s) support each part of your answer using [1], [2], etc. If the excerpts don't contain the answer, say so plainly instead of guessing.

Excerpts:
${contextBlock}

Question: ${question}
`.trim();

    const requestBody: Record<string, unknown> = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    };

    const rawData = await callGeminiAPIWithRetry(requestBody, "meeting Q&A", GEMINI_QA_MODEL);
    return extractTextFromGeminiResponse(rawData);
}

// "Ask this meeting" - answers a question grounded only in one meeting's
// content, with clickable timestamp citations.
export async function askMeeting(meetingId: number, question: string): Promise<AskResult> {
    const user = await currentUser();
    if (!user) {
        return { success: false, message: "Unauthorized. Please sign in." };
    }
    if (!question.trim()) {
        return { success: false, message: "Please enter a question." };
    }

    try {
        const sql = await getDbConnection();
        const [meeting] = await sql`
            SELECT id, title FROM meetings WHERE id = ${meetingId} AND user_id = ${user.id}
        `;
        if (!meeting) {
            return { success: false, message: "Meeting not found." };
        }

        const queryEmbedding = await generateEmbedding(question);
        const embeddingString = `[${queryEmbedding.join(',')}]`;

        const rows = await sql`
            SELECT dc.text, dc.segment_id, ms.start_seconds,
                   dc.embedding <=> ${embeddingString}::vector AS distance
            FROM document_chunks dc
            LEFT JOIN meeting_segments ms ON ms.id = dc.segment_id
            WHERE dc.meeting_id = ${meetingId}
            ORDER BY distance ASC
            LIMIT 5
        `;

        const sources: AskSource[] = rows.map((r) => ({
            meetingId,
            meetingTitle: meeting.title as string,
            segmentId: r.segment_id as number | null,
            startSeconds: r.start_seconds as number | null,
            snippet: r.text as string,
        }));

        const answer = await answerFromChunks(
            question,
            rows.map((r) => ({
                meetingTitle: meeting.title as string,
                startSeconds: r.start_seconds as number | null,
                text: r.text as string,
            }))
        );

        return { success: true, message: "OK", answer, sources };
    } catch (error) {
        console.error("askMeeting error:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Failed to answer question",
        };
    }
}

// "Ask across meetings" - answers a question grounded in every meeting the
// current user owns, citing which meeting/timestamp each part came from.
export async function askAcrossMeetings(question: string): Promise<AskResult> {
    const user = await currentUser();
    if (!user) {
        return { success: false, message: "Unauthorized. Please sign in." };
    }
    if (!question.trim()) {
        return { success: false, message: "Please enter a question." };
    }

    try {
        const sql = await getDbConnection();
        const queryEmbedding = await generateEmbedding(question);
        const embeddingString = `[${queryEmbedding.join(',')}]`;

        const rows = await sql`
            SELECT dc.text, dc.segment_id, dc.meeting_id, m.title AS meeting_title, ms.start_seconds,
                   dc.embedding <=> ${embeddingString}::vector AS distance
            FROM document_chunks dc
            JOIN meetings m ON m.id = dc.meeting_id
            LEFT JOIN meeting_segments ms ON ms.id = dc.segment_id
            WHERE m.user_id = ${user.id}
            ORDER BY distance ASC
            LIMIT 6
        `;

        const sources: AskSource[] = rows.map((r) => ({
            meetingId: r.meeting_id as number,
            meetingTitle: r.meeting_title as string,
            segmentId: r.segment_id as number | null,
            startSeconds: r.start_seconds as number | null,
            snippet: r.text as string,
        }));

        const answer = await answerFromChunks(
            question,
            rows.map((r) => ({
                meetingTitle: r.meeting_title as string,
                startSeconds: r.start_seconds as number | null,
                text: r.text as string,
            }))
        );

        return { success: true, message: "OK", answer, sources };
    } catch (error) {
        console.error("askAcrossMeetings error:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Failed to answer question",
        };
    }
}
