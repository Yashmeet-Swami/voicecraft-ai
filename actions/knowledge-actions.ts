"use server";

import getDbConnection from "@/lib/db";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";

// ==== Types ====
interface IngestResult {
    success: boolean;
    message: string;
    chunksAdded?: number;
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
export async function retrieveContext(query: string, limit: number = 3): Promise<string> {
    try {
        console.log("Retrieving context for query...");
        const queryEmbedding = await generateEmbedding(query);
        const embeddingString = `[${queryEmbedding.join(',')}]`;

        const sql = await getDbConnection();

        // Use vector_cosine_ops (<=>) for cosine distance
        const chunks = await sql`
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
