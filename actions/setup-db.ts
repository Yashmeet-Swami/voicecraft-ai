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
