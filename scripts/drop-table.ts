import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function dropTable() {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`DROP TABLE IF EXISTS document_chunks;`;
    console.log("Dropped document_chunks table successfully.");
}

dropTable().catch(console.error);
