"use server";

import getDbConnection from "@/lib/db";

export async function setupDatabase() {
  try {
    const sql = await getDbConnection();

    console.log("Setting up database for vector search...");

    // Enable pgvector
    await sql`CREATE EXTENSION IF NOT EXISTS vector;`;
    console.log("✅ pgvector extension enabled");

    // Create documents table
    await sql`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("✅ documents table created");

    // Create document_chunks table with vector column (3072 for gemini-embedding-001)
    await sql`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id SERIAL PRIMARY KEY,
        document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding vector(3072) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("✅ document_chunks table created");

    // Optional: Create an index for faster similarity searches if needed in the future
    // await sql`CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON document_chunks USING hnsw (embedding vector_cosine_ops);`;

    console.log("🎉 Database setup complete!");
    return { success: true, message: "Database setup successfully" };
  } catch (error) {
    console.error("❌ Database setup failed:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error during setup"
    };
  }
}

// Meeting Intelligence schema (Phase 1). Additive — does not touch
// documents/document_chunks/posts.
export async function setupMeetingsSchema() {
  try {
    const sql = await getDbConnection();

    console.log("Setting up meeting intelligence schema...");

    await sql`
      CREATE TABLE IF NOT EXISTS meetings (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        meeting_type TEXT NOT NULL DEFAULT 'general',
        status TEXT NOT NULL DEFAULT 'uploaded',
        file_name TEXT,
        audio_url TEXT,
        duration_seconds INTEGER,
        summary TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        completed_at TIMESTAMPTZ
      );
    `;
    console.log("✅ meetings table created");

    await sql`
      CREATE TABLE IF NOT EXISTS transcripts (
        id SERIAL PRIMARY KEY,
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        raw_text TEXT NOT NULL,
        cleaned_text TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `;
    console.log("✅ transcripts table created");

    await sql`
      CREATE TABLE IF NOT EXISTS processing_jobs (
        id SERIAL PRIMARY KEY,
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `;
    console.log("✅ processing_jobs table created");

    // Populated starting Phase 2 (diarization). Created now so decisions/
    // action_items/open_questions can reference it from day one.
    await sql`
      CREATE TABLE IF NOT EXISTS meeting_segments (
        id SERIAL PRIMARY KEY,
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker_label TEXT,
        start_seconds NUMERIC,
        end_seconds NUMERIC,
        text TEXT NOT NULL,
        segment_index INTEGER NOT NULL
      );
    `;
    console.log("✅ meeting_segments table created");

    await sql`
      CREATE TABLE IF NOT EXISTS decisions (
        id SERIAL PRIMARY KEY,
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        source_segment_id INTEGER REFERENCES meeting_segments(id),
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `;
    console.log("✅ decisions table created");

    await sql`
      CREATE TABLE IF NOT EXISTS action_items (
        id SERIAL PRIMARY KEY,
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        task TEXT NOT NULL,
        owner_name TEXT,
        owner_user_id TEXT,
        due_date DATE,
        status TEXT NOT NULL DEFAULT 'open',
        source_segment_id INTEGER REFERENCES meeting_segments(id),
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `;
    console.log("✅ action_items table created");

    await sql`
      CREATE TABLE IF NOT EXISTS open_questions (
        id SERIAL PRIMARY KEY,
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        source_segment_id INTEGER REFERENCES meeting_segments(id)
      );
    `;
    console.log("✅ open_questions table created");

    // Phase 3: link meeting-derived RAG chunks back to their meeting/segment
    // so "Ask this meeting" / "Ask across meetings" can cite sources.
    // document_id stays nullable and unused for these rows - meeting chunks
    // aren't backed by a `documents` row.
    await sql`
      ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE;
    `;
    await sql`
      ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS segment_id INTEGER REFERENCES meeting_segments(id) ON DELETE SET NULL;
    `;
    console.log("✅ document_chunks.meeting_id / segment_id columns added");

    // Phase 4: lightweight collaboration - share a meeting with another
    // registered user (by email, resolved against `users`), assign action
    // items to them, and notify them in-app. No Clerk Organizations, no
    // outbound email - deliberately minimal per docs/meeting-intelligence-
    // pivot-plan.md §8, Phase 4.
    await sql`
      CREATE TABLE IF NOT EXISTS meeting_collaborators (
        id SERIAL PRIMARY KEY,
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        added_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (meeting_id, user_id)
      );
    `;
    console.log("✅ meeting_collaborators table created");

    await sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
        action_item_id INTEGER REFERENCES action_items(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `;
    console.log("✅ notifications table created");

    console.log("🎉 Meeting intelligence schema setup complete!");
    return { success: true, message: "Meeting intelligence schema created successfully" };
  } catch (error) {
    console.error("❌ Meeting schema setup failed:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error during setup"
    };
  }
}
