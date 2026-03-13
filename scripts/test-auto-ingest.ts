import { generateBlogPostAction } from '../actions/upload-actions';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testAutoIngest() {
    console.log("Mocking Blog Generation Trigger...");

    const mockTranscription = `
This is a test transcript for the VoiceCraftAI platform. 
We are testing to see if this speech text gets automatically transformed into vector embeddings and successfully saved into the RAG store right after the blog posts finishes generating.
NeonDB vector scaling is working fantastic so far! Let's see if this chunk of text appears in the vector store.
  `;

    // Provide a fake userId (make sure the DB accepts it or has a fallback). 
    // Assuming 'clerk_user_123' works for a test post or will just fail the save post step. 
    // Even if the post save fails, we can at least observe if the code reaches the ingestion.
    // We'll mock a real test user ID if one existed, but let's just trace the execution.

    try {
        const result = await generateBlogPostAction({
            transcriptions: { text: mockTranscription },
            userId: "test_user_for_rag_ingest"
        });

        console.log("Result: ", result);
    } catch (e) {
        console.log("Expected redirect or error: ", e);
    }
}

testAutoIngest().catch(console.error);
